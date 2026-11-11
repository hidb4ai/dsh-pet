/**
 * System notification frame generation for host side (self-contained, no import src/shared - DSH single file load
 * constraints).
 *
 * Monitor the DSH host event (turn/end, approval/asked, tool/call, and `agent/error` of `session/event` ), generate a
 * frame with the same contract as shared/notify.ts and write it into sections.notify of S, and then the browser will
 * polling / state and then pop up toast (same family as the rest of the leaves: single slot, last-come
 * override-first-come). Not responsible for deduplicate and display. It must always be true: before pushing the frame,
 * it must pass through two gates - session gate (subagent and deep delegation are not sent) and activity gate (also
 * "conversation completed" is not sent when running); if the criterion is not obtained, it will be released. It is
 * better to play one more than to invalidate the entire notification. See API.md and openapi.yaml for contracts.
 * @module dsh-pet/src/host/notify-events
 */

/** Notification frame (same shape as NotifyFrame of shared/notify.ts; host side self-contained definition to avoid cross-end import). */
export interface HostNotifyFrame {
  type: string;
  [key: string]: unknown;
}

/** All fields related to this judgment in the session parameters (the first actual parameter `ctx.on('session/event')`) are read loosely. */
interface NotifySessionLike {
  id?: unknown;
  header?: { id?: unknown; origin?: unknown; delegationDepth?: unknown } | null;
}

/**
 * Should the event of this conversation become a notification?
 *
 * Subagents (`origin === 'subagent'`) and deeper delegations (`delegationDepth > 0`) are not sent: what you are
 * waiting for is the parent dialogue, not the completion of a certain path of subagents (in actual testing, 3
 * subagents will pop up 3 "Conversation Completed" messages in a row). The criterion must be `origin` , and
 * `parentSession` must not be used - the semantics of the latter is "Which conversation does fork come from". Ordinary
 * fork also carries it, and using it to judge the sub-agent will mute the main conversation together (the archive
 * access of official dsh-subagent is the same set of criteria). The criterion is not available (session / header is
 * missing or has the wrong shape) → Release: Host Changing the field shape should not invalidate the entire
 * notification.
 */
export function shouldNotifySession(session: unknown): boolean {
  const header = (session as NotifySessionLike | null)?.header;
  if (!header || typeof header !== 'object') return true;
  if (header.origin === 'subagent') return false;
  const depth = header.delegationDepth;
  if (typeof depth === 'number' && Number.isFinite(depth) && depth > 0) return false;
  return true;
}

/**
 * Session id (the timer of the activity gate uses it as the key): `header.id` takes priority, and the fallback top
 * level `id` cannot be obtained using 'unknown' (the same as the method on the index.ts work-status side).
 */
export function sessionIdOf(session: unknown): string {
  const s = session as { id?: unknown; header?: { id?: unknown } | null } | null;
  return String(s?.header?.id ?? s?.id ?? 'unknown');
}

/**
 * Attach session id to the notification frame - when the notification is clicked, the web page jumps to that session
 * (client `uiWorkspace.openSession` ) accordingly.
 *
 * The fallback value `'unknown'` is not a real session and cannot be used to jump: only the real id is written into
 * the frame. If it cannot be retrieved, it will be returned as is. Clicking will degenerate into "only calling the
 * window back to the foreground". `'unknown'` is still the Map key of the activity gate timer and must be present.
 */
export function withSessionId(frame: HostNotifyFrame, sessionId: string): HostNotifyFrame {
  return sessionId === 'unknown' ? frame : { ...frame, sessionId };
}

/**
 * Is this event "conversation completed" - activity gate only blocks it.
 *
 * Only recognize `turn/end` + `reason.kind === 'completed'` : Generation failure/output truncation means "something
 * really happened". Permission application and user selection are waiting for someone to operate, and they should not
 * be silent because there is still life running.
 */
export function isCompletionTurnEnd(event: unknown): boolean {
  const e = event as { type?: unknown; data?: { reason?: { kind?: unknown } } } | null;
  return e?.type === 'turn/end' && e.data?.reason?.kind === 'completed';
}

/**
 * activity gate: Is there any running activity in this session? The input parameter is the answer of host
 * `workspace/session-activity` waterfall (array of entries of each family).
 *
 * Only look at `job` (background tasks), `subagent` (running subagents and Agent Teams team members, members are
 * recorded in this family by blood), `schedule` (active scheduled reminders). Deliberately not looking at `turn` :
 * what triggers this frame is the end of the conversation round, and `turn` reads `status` of live Agent. At that
 * time, it itself is still running, and it will block every "conversation completion" by itself. Wrong shape / empty /
 * not an array / unknown family → release: host Adding a family or changing fields should not invalidate the entire
 * notification.
 */
export function hasBlockingActivity(activity: unknown): boolean {
  if (!Array.isArray(activity)) return false;
  for (const item of activity) {
    const kind = (item as { kind?: unknown } | null)?.kind;
    if (kind === 'job' || kind === 'subagent' || kind === 'schedule') return true;
  }
  return false;
}

/** The cache limit of the beginning of the reply in the session state: only used for one toast, leaving it too long is meaningless. */
const MAX_REPLY_TEXT = 200;

/**
 * Take the last text from a `assistant/message` event, flatten the white space and truncate it.
 *
 * Only the last `{ type: 'text' }` block in `data.message.content[]` is recognized: The reasoning block and the tool
 * block are not for users to see, and sneaking in will only push the internal process to the lock screen. If it cannot
 * be obtained or the shape is wrong, null will be returned (released instead of reporting an error).
 */
export function lastAssistantText(event: { type?: string; data?: Record<string, unknown> }): string | null {
  if (event?.type !== 'assistant/message') return null;
  const content = (event.data as { message?: { content?: unknown } } | undefined)?.message?.content;
  if (!Array.isArray(content)) return null;
  for (let i = content.length - 1; i >= 0; i -= 1) {
    const block = content[i] as { type?: unknown; text?: unknown } | null;
    if (block?.type !== 'text' || typeof block.text !== 'string') continue;
    const text = block.text.replace(/\s+/g, ' ').trim();
    if (text === '') continue;
    return text.length > MAX_REPLY_TEXT ? text.slice(0, MAX_REPLY_TEXT) : text;
  }
  return null;
}

/** turn/end reason.kind → notification category; unbounced branches return null (consistent with shared/notify.ts filtering). */
export function turnEndNotifyKind(kind: string | undefined): 'completed' | 'error' | 'max-tokens' | null {
  if (kind === 'completed') return 'completed';
  if (kind === 'error' || kind === 'max-tokens') return kind;
  // aborted (user/parent agent cancellation), interrupted (crash recovery), blocked (waiting for confirmation), etc. do not pop up
  return null;
}

/** ask_user_question tool name (same origin as work-status.ts; the model is waiting for user reply when this tool is triggered). */
const USER_QUESTION_TOOL = 'ask_user_question';

/** Parsing arguments (JSON character string) → questions array of tool/call; parsing failed or is not an array → null. */
export function parseToolQuestions(args: unknown): Array<{ question?: string }> | null {
  if (typeof args !== 'string') return null;
  try {
    const parsed = JSON.parse(args) as { questions?: unknown } | null;
    const questions = parsed?.questions;
    if (!Array.isArray(questions)) return null;
    return questions as Array<{ question?: string }>;
  } catch {
    return null;
  }
}

/**
 * Compress a session/event sub-event into a notification frame; do not care or filtered events return null. The frame
 * shape is exactly what frameToToast expects from shared/notify.ts (zero changes to browser-side mapping). data is
 * received as loosely as Record (reason of approval/asked is a character string, turn/end is an object), and each
 * internal value is safe.
 *
 * @param event - Session sub-event.
 * @param replyText - The beginning of the last reply of this round; only framed when completed, this field is not
 * written by default.
 */
export function reduceNotifyFrame(
  event: { type?: string; data?: Record<string, unknown> },
  replyText?: string,
): HostNotifyFrame | null {
  if (!event?.type) return null;
  switch (event.type) {
    case 'turn/end': {
      const reason = event.data?.reason as { kind?: string; error?: { message?: string } } | undefined;
      const kind = turnEndNotifyKind(reason?.kind);
      if (!kind) return null;
      return {
        type: 'session/event',
        event: {
          type: 'turn/end',
          // Take away the beginning of the last reply when completed: the notification body can therefore display the content instead of just the status.
          data: kind === 'completed' && replyText ? { reason, text: replyText } : { reason },
        },
      };
    }
    case 'approval/asked': {
      const data = event.data ?? {};
      return {
        type: 'approval/requested',
        ...(typeof data.toolName === 'string' && data.toolName ? { toolName: data.toolName } : {}),
        ...(typeof data.reason === 'string' && data.reason ? { reason: data.reason } : {}),
      };
    }
    case 'tool/call': {
      if (String(event.data?.name ?? '') !== USER_QUESTION_TOOL) return null;
      const questions = parseToolQuestions(event.data?.arguments);
      if (!questions || questions.length === 0) return null;
      return { type: 'question/requested', questions };
    }
    default:
      return null;
  }
}

/**
 * agent/error (failure without round position) → host/agent-error frame (consistent with shared expected message
 * field). Its payload is only { turn , step , error }, without a session identifier, and cannot pass the session gate
 * - the generation of the subagent will still fail; to cure it, the host must bring the session into the payload.
 */
export function agentErrorFrame(error: unknown): HostNotifyFrame {
  const message = typeof error === 'string' ? error : error instanceof Error ? error.message : String(error ?? '');
  return { type: 'host/agent-error', message };
}
