/**
 * Session event monitoring: fold session/event of DSH into working status and completion notification.
 *
 * It does not determine the notification copy and file position (owned by notify-events and shared/work-status), but
 * only transfers the event to the judgment.
 * @module dsh-pet/src/host/plugin/session-watch
 */
import { GOAL_UPDATE_TOOL, currentTaskFromTodo, goalUpdateAction, reduceWorkStatus } from '../work-status.ts';
import { toolDetailFromEvent } from '../tool-detail.ts';
import {
  agentErrorFrame,
  lastAssistantText,
  isCompletionTurnEnd,
  reduceNotifyFrame,
  sessionIdOf,
  shouldNotifySession,
  withSessionId,
} from '../notify-events.ts';
import type { SessionNotify, ToolCallKey, ToolCallLedger } from './session-notify.ts';
import type { WorkStatusBridge } from './work-status-bridge.ts';
import type { HostSetup } from './setup.ts';
import type { HostContext } from './context.ts';

/** Input for session event listening. */
export type SessionWatchInput = {
  /** host context (the one apply received). */
  ctx: HostContext;
} & Pick<SessionNotify, 'cancelTerminalCleanup'> &
  Pick<SessionNotify, 'lastTodoText'> &
  Pick<SessionNotify, 'lastReplyText'> &
  Pick<SessionNotify, 'notifyActivityTimers'> &
  Pick<WorkStatusBridge, 'publishWorkStatus'> &
  Pick<SessionNotify, 'pushNotifyFrame'> &
  Pick<SessionNotify, 'scheduleCompletionNotify'> &
  Pick<SessionNotify, 'scheduleTerminalCleanup'> &
  Pick<SessionNotify, 'terminalTimers'> &
  Pick<SessionNotify, 'toolsInFlight'> &
  Pick<SessionNotify, 'turnFlags'> &
  Pick<HostSetup, 'workStatus'>;

/** The form of a tool event in the accounting table: call start (with details) or result return (remove an item according to the identifier). */
type ToolPhase =
  | { kind: 'call'; detail: string; callId: ToolCallKey | undefined }
  | { kind: 'result'; callId: ToolCallKey | undefined };

/** Where does the bubble go after accounting. */
type ToolPhaseOutcome = {
  /** The text to be written into the bubble; `undefined` = The text will not be changed this time, `null` = clear fallback to the file copy. */
  task?: string | null;
  /** Is there any operation with description running: When it is true, push the state back to working to prevent the result state from covering the unfinished work. */
  keepWorking: boolean;
};

/** A tool event entry required for accounting. */
type TrackInput = {
  /** Event type, only `tool/call` and `tool/result` will be entered into the accounting table. */
  type: string;
  /** The calling identifier of this event; if missing, the accounting layer will use temporary Symbol to occupy the place. */
  callId: ToolCallKey | undefined;
  /** Detailed copy of `tool/call`; `null` means that there is no displayable description for this call. */
  detail: string | null;
  /** The most recent copy of the conversation is todo, which will fallback to it after clearing. */
  lastTodo: string | null;
};

/**
 * Get the call ID of this tool event.
 *
 * The logo of `tool/call` is in `data.callId` , and `tool/result` is in `data.message.source.callId`
 * (`ToolResultMessage.source` is guaranteed to be included by `ToolMessageSource` ).
 *
 * @returns is a non-empty character string identifier; when `undefined` is missing or the type is incorrect, it is
 * handed over to the accounting layer to use a temporary Symbol placeholder.
 */
function toolCallIdOf(event: unknown): ToolCallKey | undefined {
  const data = (event as { data?: { callId?: unknown; message?: { source?: { callId?: unknown } } } } | null)?.data;
  const raw = data?.message?.source?.callId ?? data?.callId;
  return typeof raw === 'string' && raw !== '' ? raw : undefined;
}

/**
 * Update a session's in-flight call table to figure out what the bubble should display.
 *
 * @param ledger - per-session in-flight call table; this function modifies in-place.
 * @param sessionId - Session ID.
 * @param phase - This is whether the call starts or the result is returned, and the corresponding call identifier.
 * @param lastTodo - todo copy that falls back after clearing.
 * @returns bubble text and whether it is still working.
 */
function trackToolPhase(
  ledger: ToolCallLedger,
  sessionId: string,
  phase: ToolPhase,
  lastTodo: string | null,
): ToolPhaseOutcome {
  if (phase.kind === 'call') {
    let pending = ledger.get(sessionId);
    if (!pending) ledger.set(sessionId, (pending = new Map()));
    pending.set(phase.callId ?? Symbol(), phase.detail);
    return { task: phase.detail, keepWorking: true };
  }
  const pending = ledger.get(sessionId);
  // The result of missing identification is that only one anonymous entry is released: do not guess which named call it is, it is better to remember one less than to delete someone else's by mistake.
  const key = phase.callId ?? [...(pending?.keys() ?? [])].find((id) => typeof id === 'symbol');
  if (key !== undefined) pending?.delete(key);
  const remaining = [...(pending?.values() ?? [])];
  if (pending?.size === 0) ledger.delete(sessionId);
  const active = remaining.pop();
  if (active !== undefined) return { task: active, keepWorking: true };
  return { task: lastTodo, keepWorking: false };
}

/**
 * Drop a tool event into the accounting table.
 *
 * @param ledger - per-session in-flight call table; this function modifies in-place.
 * @param sessionId - Session ID.
 * @param input - event type, call identifier and detail copy.
 * @returns accounting result; when there is no displayable details and it is not a result event, `undefined` is
 * returned (bubble does not change the copy because of it).
 */
function trackToolEvent(ledger: ToolCallLedger, sessionId: string, input: TrackInput): ToolPhaseOutcome | undefined {
  if (input.detail !== null) {
    return trackToolPhase(
      ledger,
      sessionId,
      { kind: 'call', detail: input.detail, callId: input.callId },
      input.lastTodo,
    );
  }
  if (input.type === 'tool/result') {
    return trackToolPhase(ledger, sessionId, { kind: 'result', callId: input.callId }, input.lastTodo);
  }
  return undefined;
}

/** register session event monitoring; the returned cleanup function is collected by ctx.effect. */
export function registerSessionWatch(deps: SessionWatchInput): void {
  const {
    ctx,
    cancelTerminalCleanup,
    lastTodoText,
    lastReplyText,
    notifyActivityTimers,
    publishWorkStatus,
    pushNotifyFrame,
    scheduleCompletionNotify,
    scheduleTerminalCleanup,
    terminalTimers,
    toolsInFlight,
    turnFlags,
    workStatus,
  } = deps;
  // Working status linkage: monitor DSH session event → aggregate current active status (WorkStatusStore → display
  // snapshot). Consume turn/start, user/message (goal continuation wheel determination), tool/call, tool/result,
  // approval/asked, turn/end, todo/write (only the task details copy is updated, and the state is not changed). Pure
  // listening does not call the model.
  ctx.effect(() => {
    const dispose = ctx.on('session/event', (session: unknown, event: unknown) => {
      const type = (event as { type?: string } | null)?.type;
      if (!type) return;
      const sessionId = String(
        (session as { id?: unknown; header?: { id?: unknown } } | null)?.header?.id ??
          (session as { id?: unknown } | null)?.id ??
          'unknown',
      );
      if (type === 'todo/write') {
        // The task details copy is write-only the entry of this session (state/task has the same origin, it is
        // impossible to cross the session). The session has no active entries (idle/cleared) → inactive: will not be
        // displayed, and writing in will only become a ghost copy. When there is no more in_progress/pending in the
        // list, it returns to null and bubble falls back to the file copy.
        const text = currentTaskFromTodo(event as { data?: { todos?: Array<{ status?: string; content?: string }> } });
        // Unconditional cache update: it is required to restore the bubble after the tool runs (see the wiring of tool/call below)
        lastTodoText.set(sessionId, text);
        // The bubble is not covered while the tool is executing: "Modify index.ts" is a better explanation of what is happening at the moment than the sentence in the list
        if ((toolsInFlight.get(sessionId)?.size ?? 0) > 0) return;
        if (workStatus.has(sessionId)) {
          workStatus.setTask(sessionId, text);
          publishWorkStatus(); // Changes in the task copy must also be written as S (the bubble content is updated based on this)
        }
        return;
      }
      if (type === 'user/message') {
        // Target continuation wheel determination: The message of the automatic wheel contains source.kind ===' goal '
        // (round >0). This round is an automatic continuation wheel. Its turn/end completed is only "this round is
        // completed", not the entire task is completed.
        const source = (event as { data?: { source?: { kind?: string } } })?.data?.source;
        if (source?.kind === 'goal') {
          const flags = turnFlags.get(sessionId) ?? { goalRound: false, closing: null };
          flags.goalRound = true;
          turnFlags.set(sessionId, flags);
        }
        return; // user/message does not drive state animation
      }
      if (type === 'turn/start') {
        turnFlags.set(sessionId, { goalRound: false, closing: null }); // New round: clear turn level mark. A new round also starts a new task context: clear the task details copy (issue
        // #59) left in the previous round, otherwise it will always hang. Cost: goal continues to run this type of multiple
        // rounds of tasks. At the beginning of each round, the state copy will fallback for a moment until the todo list is
        // written again in this round (usually within the first few steps).
        workStatus.setTask(sessionId, null);
        lastTodoText.delete(sessionId); // The previous round of list text should not be "restored" when the next round of tools is finished.
        toolsInFlight.delete(sessionId); // If there were tools in the last round that did not wait until tool/result (interrupted), don’t delay this round.
        publishWorkStatus(); // Even if you clear the last round of task copy, you still need to write S
      }
      if (
        type === 'tool/call' &&
        String((event as { data?: { name?: unknown } })?.data?.name ?? '') === GOAL_UPDATE_TOOL
      ) {
        // update_goal complete/blocked = This round is the cleanup round of the target, and completed is the true completion
        const action = goalUpdateAction(String((event as { data?: { arguments?: unknown } })?.data?.arguments ?? ''));
        if (action) {
          const flags = turnFlags.get(sessionId) ?? { goalRound: false, closing: null };
          flags.closing = action;
          turnFlags.set(sessionId, flags);
        }
      }
      let next = reduceWorkStatus(
        event as { type?: string; data?: Record<string, unknown> & { reason?: { kind?: string } } },
        turnFlags.get(sessionId),
      );
      if (!next) {
        // null of turn/end (aborted / unknown kind) = The session round has ended: clear the session status, let the
        // display return to idle or fall to other active sessions, to prevent the round from being permanently stuck
        // in the previous state after being interrupted; null of other events are "don't care" and ignored.
        if (type === 'turn/end') {
          turnFlags.delete(sessionId);
          cancelTerminalCleanup(sessionId); // All entries must be cleared. Don’t leave a timer with nothing to do after the timer expires.
          lastTodoText.delete(sessionId); // The two caches recorded by session disappear together with the session (prevention of leakage)
          toolsInFlight.delete(sessionId);
          workStatus.clear(sessionId); // The entry disappears together with the task details copy (clear will be recalculated internally for display)
          publishWorkStatus(); // The round is interrupted → returns to idle: the front end closes the resident bubble accordingly
        }
        return;
      }
      const seq = Number((event as { seq?: unknown }).seq ?? 0);
      // Tool details (specific descriptions such as "Modify index.ts"): much more useful than general file copy,
      // workStatusEnabled's pet directly uses it as bubble text. It must be written after setState: setTask requires
      // that the session entry already exists, and the entry is created by setState - if the order is reversed, this
      // sentence will be silently discarded (no error is reported, the most difficult to check).
      const detail =
        type === 'tool/call' ? toolDetailFromEvent(event as { data?: { name?: unknown; arguments?: unknown } }) : null;
      const outcome = trackToolEvent(toolsInFlight, sessionId, {
        type,
        callId: toolCallIdOf(event),
        detail,
        lastTodo: lastTodoText.get(sessionId) ?? null,
      });
      // Press the file back to working before the operation is completed: the result file and the "still executing" copy will be contradictory if they appear at the same time.
      if (outcome?.keepWorking) next = 'working';
      const changed = workStatus.setState(sessionId, next, seq);
      if (outcome?.task !== undefined) workStatus.setTask(sessionId, outcome.task);
      publishWorkStatus(); // The state or copy has changed → write S (it will short-circuit itself when the content has not changed, and no
      // redundant writing will occur) No repeated updates in the same session and the same state (anti-swipe): The writing
      // has been settled, and this is only responsible for skipping the rearrangement of the final state cleanup
      if (!changed) return;
      // The final state is only displayed for a short window and then automatically cleaned up: the stale completion
      // state no longer floats (part of Bug 3, incidentally alleviating the residue of Bug 2). Returning to a
      // non-final state cancels the pending cleanup - otherwise the session will be in a non-final state by the time
      // it reaches the point where it is neither cleared nor rearranged, and the entries (together with the old task
      // copy) will remain permanently.
      if (next === 'success' || next === 'error') scheduleTerminalCleanup(sessionId);
      else cancelTerminalCleanup(sessionId);
    });
    return () => {
      dispose();
      for (const t of terminalTimers.values()) clearTimeout(t);
      terminalTimers.clear();
    };
  }, 'dsh-pet: work-status session events');

  // System notification: Monitoring the DSH host event generates a notification frame and enqueues it. The browser
  // polling / state reads and then pops up toast (the frame contract is consistent with shared/notify.ts). Event
  // source: turn/end, approval/asked, tool/call (ask_user_question), agent/error. Two gates: conversation gate
  // (subagent/delegation is not issued) + activity gate (only blocks "conversation completion", delays confirmation
  // and then restarts). Pure monitoring does not call the model; notification is a web-side capability and is not
  // consumed in desktop mode.
  ctx.effect(() => {
    const sessionDispose = ctx.on(
      'session/event',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- session/event has no public payload type; immediately narrow it with shouldNotifySession / reduceNotifyFrame.
      (session: any, event: any) => {
        // Session gate (issue #82): Subagent/delegated session does not send notification - you are waiting for the
        // parent conversation, not for a certain subagent to finish running. The criterion is header.origin (not
        // parentSession, which will mute the main dialogue of ordinary fork). When the criterion is unavailable, it
        // will be released and the notification will never be muted as a whole. See shouldNotifySession of
        // notify-events.ts for details.
        if (!shouldNotifySession(session)) return;
        // Retain only the latest assistant text for the completion notification. Missing text leaves the body empty
        // without preventing the notification.
        if (event?.type === 'assistant/message') {
          const text = lastAssistantText(event as { type?: string; data?: Record<string, unknown> });
          if (text) lastReplyText.set(sessionIdOf(session), text);
        }
        // Activity gate (issue #114): delay completion notifications until the session has no remaining activity. A
        // lead's turn ending does not mean the team has finished while members are still running.
        // Generation failures, truncated output, permission requests and user choices bypass this gate; see
        // isCompletionTurnEnd in notify-events.ts.
        if (isCompletionTurnEnd(event)) {
          scheduleCompletionNotify(sessionIdOf(session), event);
          return;
        }
        // The non-completed cleanup (error/output truncation/abortion) does not need this text, so it should be cleared together so as not to leave it until the next completion.
        if (event?.type === 'turn/end') lastReplyText.delete(sessionIdOf(session));
        const frame = reduceNotifyFrame(event as Parameters<typeof reduceNotifyFrame>[0]);
        // "Which session this notification was sent from" is included in the frame: when clicked, the webpage jumps to that session accordingly (see withSessionId)
        if (frame) pushNotifyFrame(withSessionId(frame, sessionIdOf(session)));
      },
    );
    // agent/error (agent-loop dispatch.emit): Generation without round position failed; new in 0.1.5, low version DSH
    // does not have this event = one less notification (turn/end error branch has covered most failure scenarios), no
    // error is reported. Neither door can control it: the payload is only { turn , step , error }, without a session
    // identifier, and there is no way to determine the source.
    const errorDispose = ctx.on(
      'agent/error',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- agent/error has no public payload type and older DSH versions may omit error; read payload?.error defensively.
      (payload: any) => {
        pushNotifyFrame(agentErrorFrame(payload?.error));
      },
    );
    return () => {
      // Clear the timer to be checked when unmounting: otherwise the plugin has been unmounted, and S will be written again when the time comes.
      for (const t of notifyActivityTimers.values()) clearTimeout(t);
      notifyActivityTimers.clear();
      sessionDispose();
      errorDispose();
    };
  }, 'dsh-pet: notify frames');
}
