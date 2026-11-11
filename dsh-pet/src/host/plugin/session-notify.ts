/**
 * Determination of session events to system notifications: completion reminder, termination cleanup and activity
 * debouncing.
 *
 * No subscribe event (subscribe is in the assembly layer), no bubble rendering; only pure judgment and timer. The
 * dependency is explicitly passed in by apply (see input type), and the global is not read in the module and no
 * singleton is created.
 * @module dsh-pet/src/host/plugin/session-notify
 */
import { hasBlockingActivity, reduceNotifyFrame, withSessionId, type HostNotifyFrame } from '../notify-events.ts';
import { type WorkStatusTurnContext } from '../work-status.ts';
import type { WorkStatusBridge } from './work-status-bridge.ts';
import type { HostSetup } from './setup.ts';
import type { HostContext } from './context.ts';

/** The key called in transit: `callId` given by the host; when there is no identification, use the temporary `Symbol` placeholder. */
export type ToolCallKey = string | symbol;

/** Accounting table for in-flight calls per session: session ID → (call key → bubble copy). */
export type ToolCallLedger = Map<string, Map<ToolCallKey, string>>;

/** Input for session notifications: assembly-time objects and earlier factories. */
export type SessionNotifyInput = {
  /** host context (the one apply received). */
  ctx: HostContext;
} & Pick<WorkStatusBridge, 'publishWorkStatus'> &
  Pick<HostSetup, 'state'> &
  Pick<HostSetup, 'workStatus'>;

/**
 * Create session notification.
 */
export function createSessionNotify(deps: SessionNotifyInput) {
  const { ctx, publishWorkStatus, state, workStatus } = deps;
  // System notification frame: host monitors the DSH host event to generate a notification frame (the frame contract
  // is consistent with shared/notify.ts), writes sections.notify of S, and the browser polls / state and then pops up
  // toast. Single slot (last-come, first-come): there is no meaning in playing multiple slots within 1 second, so
  // there is no seq/incremental frame queue.
  const pushNotifyFrame = (frame: HostNotifyFrame): void => {
    state.writeSection('notify', frame);
  };

  const turnFlags = new Map<string, WorkStatusTurnContext>();

  /** The final state (success/error) display window timer: clear the session entry after about 60 s, and the stale completion state will no longer appear. */
  const terminalTimers = new Map<string, ReturnType<typeof setTimeout>>();

  const TERMINAL_KEEP_MS = 60 * 1000;

  /**
   * The latest todo copy in each session: The bubble must be "returned" to it after the tool is finished running.
   * Without this cache, writing `tool/result` to null can only fallback to the general file copy, and the list
   * progress the user just saw will be erased.
   */
  const lastTodoText = new Map<string, string | null>();

  /**
   * The last paragraph of reply text in each conversation: it relies on it to complete the text of the notification.
   * Dequeue the activity gate timer when it is taken - the activity gate will delay it
   * 1.5 s, but the text will not change during the period of confirmation; leave it in the timer and then delete it.
   * If it is returned early when it is "determined to be alive", it will become a long-term residue.
   */
  const lastReplyText = new Map<string, string>();

  /**
   * Details of in-transit calls for each session: the key is the call identifier (use temporary `Symbol` when the
   * identifier is missing), and the value is the bubble copy. As a result, only one of the events is deleted, so the
   * parallel calls will not override each other. The fallback todo text is only completed after all are
   * deleted.
   */
  const toolsInFlight: ToolCallLedger = new Map();

  /** Cancel the pending final state cleanup of a session: the session has returned to a non-final state. After the cleanup is completed, it will neither be cleaned nor rearranged. Keeping it will only mislead. */
  const cancelTerminalCleanup = (sessionId: string): void => {
    const t = terminalTimers.get(sessionId);
    if (t === undefined) return;
    clearTimeout(t);
    terminalTimers.delete(sessionId);
  };

  /** Schedule a final state cleanup timer (one per session, skip if already scheduled) */
  const scheduleTerminalCleanup = (sessionId: string): void => {
    if (terminalTimers.has(sessionId)) return;
    const t = setTimeout(() => {
      terminalTimers.delete(sessionId);
      const sessionState = workStatus.stateOf(sessionId);
      if (sessionState === 'success' || sessionState === 'error') {
        workStatus.clear(sessionId); // The entry disappears together with its task details copy and does not remain in subsequent activities.
        turnFlags.delete(sessionId);
        lastTodoText.delete(sessionId); // All sessions are gone, and the two caches recorded by sessions are also cleared together (to prevent leakage)
        toolsInFlight.delete(sessionId);
        publishWorkStatus(); // Write S after clearing: otherwise the front end will always hang with the stale completion status
      }
    }, TERMINAL_KEEP_MS);
    terminalTimers.set(sessionId, t);
  };

  // Notification activity gate (issue #114): "Conversation Completed" is suspended first, and then it is confirmed
  // that the session is indeed dead and then played again (any of the running subagents/team members, background
  // tasks, and active reminders is not empty → discard this frame). Unable to synchronize the query:
  // `workspace/session-activity` reads the status of the live Agent, and turn/end is added to the finally of the turn
  // body - at the moment of synchronization, it is still running. Writing according to "If it is not empty, it will
  // not play" will swallow up the notification. The criterion is not available (the host has no combination of
  // workspace, the fake ctx does not have waterfall, and the error is thrown) → all are allowed, and it is better to
  // play one more.
  const NOTIFY_ACTIVITY_DELAY_MS = 1500;

  /** One pending timer per session (continuous cleanup in the same session only retains the last one: last-come overrides first-come, same semantics as single-slot frame) */
  const notifyActivityTimers = new Map<string, ReturnType<typeof setTimeout>>();

  /** waterfall only uses the signature itself: DSH does not export the request/response type of this event, which is loosely stated here (consistent with the current situation that ctx is also any) */
  type Waterfall = (name: string, request: unknown, next: () => Promise<unknown[]>) => Promise<unknown>;

  /** Is this session still running? If the criterion is unavailable, false = Release */
  const sessionHasRunningWork = async (sessionId: string): Promise<boolean> => {
    const waterfall = (ctx as { waterfall?: Waterfall }).waterfall;
    if (typeof waterfall !== 'function') return false;
    try {
      const activity = await waterfall.call(ctx, 'workspace/session-activity', { sessionId }, () =>
        Promise.resolve([]),
      );
      return hasBlockingActivity(activity);
    } catch {
      return false; // Query failure does not block notification (same policy as "release when criterion is unavailable")
    }
  };

  /** Schedule an activity gate timer: push this frame only when the point is confirmed to be idle. */
  const scheduleCompletionNotify = (sessionId: string, event: unknown): void => {
    // Dequeue as soon as you take it: assistant/message of the same round has arrived, and the text will not change.
    const replyText = lastReplyText.get(sessionId);
    lastReplyText.delete(sessionId);
    const prev = notifyActivityTimers.get(sessionId);
    if (prev !== undefined) clearTimeout(prev);
    notifyActivityTimers.set(
      sessionId,
      setTimeout(() => {
        notifyActivityTimers.delete(sessionId);
        void (async () => {
          if (await sessionHasRunningWork(sessionId)) return; // There is still work: wait for the real cleanup round before playing again
          const frame = reduceNotifyFrame(event as Parameters<typeof reduceNotifyFrame>[0], replyText);
          // This delay path (activity gate, etc. 1.5 s, push "Conversation Completed" after confirming that it is not alive) is most commonly clicked, and it also requires session id
          if (frame) pushNotifyFrame(withSessionId(frame, sessionId));
        })();
      }, NOTIFY_ACTIVITY_DELAY_MS),
    );
  };
  return {
    pushNotifyFrame,
    turnFlags,
    terminalTimers,
    lastTodoText,
    lastReplyText,
    toolsInFlight,
    cancelTerminalCleanup,
    scheduleTerminalCleanup,
    notifyActivityTimers,
    scheduleCompletionNotify,
  };
}
/** Output of session notification (Pick for downstream factories on demand). */
export type SessionNotify = ReturnType<typeof createSessionNotify>;
