/**
 * Working status linkage (host side, self-contained, not import src/shared).
 *
 * session/event, which is responsible for monitoring DSH, compresses the session events into "current active working
 * status" and aggregates them according to the session. The caller writes sections.workStatus. After polling / state
 * at both ends, counter changes the rendering. Only aggregate and deduplicate are used: there is no change in status,
 * no new output is generated (signature comparison prevents screen refresh), and no model is called. Relies on session
 * events and the turn context maintained by the caller; it is not responsible for the stall copy and animation, which
 * are on the consumer side at both ends. Always true: the state sequence is strictly consistent with the
 * animations.events.workStatus array index, and no intermediate insertion is performed. See API.md and openapi.yaml
 * for contracts.
 *
 * @module dsh-pet/src/host/work-status
 */

/** Working status state (array index = events.workStatus state; the order is consistent with shared/work-status.ts). */
export const HOST_WORK_STATUS_STATES = ['thinking', 'working', 'result', 'waiting', 'success', 'error'] as const;
export type HostWorkStatusState = (typeof HOST_WORK_STATUS_STATES)[number];

/**
 * Reason for end of round → Gear: completed → success, error system (error / max-tokens / timeout) → error, blocked →
 * waiting; the rest (aborted, etc.) → null, by caller Clean up the session and return it to idle - the remaining
 * previous state will cause the round to be stuck at working forever after it is interrupted.
 */
function turnEndState(kind: string): HostWorkStatusState | null {
  if (kind === 'completed') return 'success';
  if (kind === 'error' || kind === 'max-tokens' || kind === 'timeout') return 'error';
  if (kind === 'blocked') return 'waiting';
  return null;
}

/** ask_user_question Tool name: The model is waiting for user multiple-choice answers → classified as waiting (waiting for confirmation) instead of ordinary work. */
const USER_QUESTION_TOOL = 'ask_user_question';

/** update_goal tool name: target tool, action = complete/blocked = This round is the cleanup round of the target task. */
export const GOAL_UPDATE_TOOL = 'update_goal';

/** The turn level mark of this turn (goal continuation wheel determination; does not participate in the display and is maintained by the caller). */
export interface WorkStatusTurnContext {
  /** Whether this round is an automatic target continuation round (set when user/message source.kind ===' goal ', cleared when turn/start). */
  goalRound?: boolean;
  /** Has update_goal cleanup been called this round (' complete ' | ' blocked '; undefined/null = not cleanup). */
  closing?: 'complete' | 'blocked' | null;
}

/** Parse arguments (original JSON character string) of update_goal → cleanup action; parsing failure/non-cleanup action returns null. */
export function goalUpdateAction(args: string): 'complete' | 'blocked' | null {
  try {
    const o = JSON.parse(args) as { action?: unknown } | null;
    const action = String(o?.action ?? '');
    if (action === 'complete' || action === 'blocked') return action;
  } catch {
    /* Invalid JSON: treated as not cleanup */
  }
  return null;
}

/**
 * The final judgment of turn/end completed: non-goal round directly success; the middle round of the automatic
 * continuation round → result (completion of this round does not mean the completion of the entire task, no
 * celebration); cleanup round complete → success, blocked → error (Goal blocked, honest expression of frustration
 * rather than celebration).
 */
export function completedState(turn: WorkStatusTurnContext | undefined): HostWorkStatusState {
  if (!turn?.goalRound) return 'success';
  if (turn.closing === 'blocked') return 'error';
  if (turn.closing === 'complete') return 'success';
  return 'result';
}

/**
 * Compressing working status from session events; no change/don't care returns null. turn is the current round context
 * (goal continuation round determination), which only affects the final semantics of turn/end completed.
 */
export function reduceWorkStatus(
  event: {
    type?: string;
    data?: Record<string, unknown> & { reason?: { kind?: string } };
  },
  turn?: WorkStatusTurnContext,
): HostWorkStatusState | null {
  switch (event?.type) {
    case 'turn/start':
      return 'thinking';
    case 'tool/call': {
      // Tool for asking users questions (multiple choice pop-up window) = waiting for users to reply, not ordinary work
      if (String(event?.data?.name ?? '') === USER_QUESTION_TOOL) return 'waiting';
      return 'working';
    }
    case 'tool/result':
      return 'result';
    case 'approval/asked':
      return 'waiting';
    case 'turn/end': {
      // completed → success, error system → error, blocked → waiting; the rest (aborted, etc.) → null = Clear the session and return it to idle
      const reason = turnEndState(String(event?.data?.reason?.kind ?? ''));
      // Does the completion of this round mean that the entire task is completed and handed over to completedState (goal does not celebrate the middle round of the continuation round)
      if (reason === 'success') return completedState(turn);
      return reason;
    }
    default:
      return null; // todo/write, etc.: no animation (details will be handled separately by the caller)
  }
}

/**
 * The upper limit of the length of the task details copy (in terms of code points, truncation and ellipses will be
 * added if it exceeds truncation): the maximum width of the bubble is only 0.5 × pet width (default size 462 is about
 * 231 px, font size 21 px is about 11 Chinese characters per line), and the original text of the list often contains
 * several digits, and if it is not truncated, the bubble will be Spread into several rows and cover pets. The
 * truncation is placed at host, and the two ends are naturally consistent.
 */
export const TASK_TEXT_MAX = 40;

/**
 * in_progress/pending item text of todo/write → Task details; null = List is fully completed.
 *
 * Take the last in_progress instead of the first one: agent. We often mark the new step as in_progress but forget to
 * mark the previous step as completed. Taking the first one will always stop at the earliest step. When there are no
 * items in progress, fallback to the first pending (what to do next).
 */
export function currentTaskFromTodo(event: {
  data?: { todos?: Array<{ status?: string; content?: string }> };
}): string | null {
  const todos = Array.isArray(event?.data?.todos) ? event.data.todos : [];
  let current: { status?: string; content?: string } | undefined;
  for (const t of todos) {
    if (t?.status === 'in_progress') current = t;
  }
  if (!current) current = todos.find((t) => t?.status === 'pending');
  const content = String(current?.content ?? '').trim();
  if (!content) return null;
  // Cut by code point to avoid cutting proxy pairs (emoji, etc.) into half characters
  const points = Array.from(content);
  return points.length > TASK_TEXT_MAX ? `${points.slice(0, TASK_TEXT_MAX).join('')}…` : content;
}

/** Working status snapshot (= data of sections.workStatus in / state): state is the main status; task is the details of todo (can be null). */
export interface WorkStatusSnapshot {
  state: HostWorkStatusState | null; // null = No session activity yet (idle)
  task: string | null; // Current task details (provided by todo/write, available at null)
  /** The session to which the current display entry belongs; when it is idle or in an external slot (`api`), it is null. The client determines whether the bubble can be clicked accordingly. */
  sessionId: string | null;
  ts: number; // The timestamp of the latest change (the polling side detects changes based on this)
}

/** Aggregate entries per session. */
export interface SessionWorkEntry {
  /** The current state of this session. */
  state: HostWorkStatusState;
  /** The serial number of the most recent event in this session. When in the same state, press it to get the latest one. */
  seq: number;
  /** Task details copy; null = There is no checklist for this session. */
  task: string | null;
  /** The session to which this entry belongs; `pickDisplayed` only traverses values, so you can only know which one is displayed with it. */
  sessionId: string;
}

/**
 * Display priority: waiting > error > working > thinking > result > success. result is higher than success: the
 * in-progress transition state of any session will not be overridden by the completed state elsewhere to prevent
 * midway celebrations; the latest update of the same file will be given priority.
 */
export const WORK_STATUS_PRIORITY: Record<HostWorkStatusState, number> = {
  waiting: 60,
  error: 50,
  working: 40,
  thinking: 30,
  result: 25,
  success: 20,
};

/** Display entry: the one with the highest priority among all sessions (with the same priority, seq is greater); if there is no session, undefined is returned. */
export function pickDisplayed(entries: Iterable<SessionWorkEntry>): SessionWorkEntry | undefined {
  let best: SessionWorkEntry | undefined;
  for (const entry of entries) {
    if (
      !best ||
      WORK_STATUS_PRIORITY[entry.state] > WORK_STATUS_PRIORITY[best.state] ||
      (WORK_STATUS_PRIORITY[entry.state] === WORK_STATUS_PRIORITY[best.state] && entry.seq > best.seq)
    ) {
      best = entry;
    }
  }
  return best;
}

/**
 * Working status aggregate (pure logic, single testable): Maintain state / task by session, and only expose one
 * display snapshot to the outside world.
 *
 * task must be hung on the session entry: if it is hung as a global single value, there will be no lifecycle
 * independent of todo/write. Once written once, all session activities will be displayed all the time, and even the
 * workStatusTexts file text in the configuration will be permanently blocked. After the entry is inserted, the copy
 * and its session live and die together: when the entry is cleared, a new round of turn/start occurs, and there are no
 * more ongoing items in the list, the copy will disappear. When displayed, state and task are taken from the same best
 * session, so the status of the A session and the copy of the B session will not appear.
 */
export class WorkStatusStore {
  // Class fields are always declare + constructor assignment: Class fields with initializers will be downgraded under
  // target es2020, and the downgraded products will be import, undeclared @oxc - project/runtime helper - directly
  // ERR_MODULE_NOT_FOUND when the host loads the plugin tree, and the entire profile Can't get up
  // (scripts/prepack-check.js item 8 guard this).
  declare private readonly sessions: Map<string, SessionWorkEntry>;
  declare private readonly snap: WorkStatusSnapshot;

  constructor() {
    this.sessions = new Map();
    this.snap = { state: null, task: null, sessionId: null, ts: 0 };
  }

  /** Whether there are currently active entries for this conversation (deciding whether todo/write is still worth updating its copy). */
  has(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  /** The current state of this session (no entry/cleared return undefined). */
  stateOf(sessionId: string): HostWorkStatusState | undefined {
    return this.sessions.get(sessionId)?.state;
  }

  /** Current task details of this session (no entry returns null). */
  taskOf(sessionId: string): string | null {
    return this.sessions.get(sessionId)?.task ?? null;
  }

  /** Write session status (retain the existing task of the session); if the status is the same and seq is not updated, do not write and return false (anti-swipe screen). */
  setState(sessionId: string, state: HostWorkStatusState, seq = 0): boolean {
    const prev = this.sessions.get(sessionId);
    if (prev?.state === state && prev.seq >= seq) return false;
    this.sessions.set(sessionId, { state, seq, task: prev?.task ?? null, sessionId });
    this.refresh();
    return true;
  }

  /** Write the task details of the session (null = clear); the session has no active entries → not moving (it will not be displayed). */
  setTask(sessionId: string, task: string | null): boolean {
    const prev = this.sessions.get(sessionId);
    if (!prev || prev.task === task) return false;
    this.sessions.set(sessionId, { ...prev, task });
    this.refresh();
    return true;
  }

  /** Clear a session (end of round/expiration of final state): Its task will disappear together and will not remain in subsequent activities. */
  clear(sessionId: string): boolean {
    if (!this.sessions.delete(sessionId)) return false;
    this.refresh();
    return true;
  }

  /** Display snapshot (object reference is stable, for direct serialization by / work-status). */
  snapshot(): WorkStatusSnapshot {
    return this.snap;
  }

  /** Recalculation display: state / task / sessionId only updates ts after any change (the polling side is triggered accordingly, and both ends are refreshed by it). */
  private refresh(): void {
    const best = pickDisplayed(this.sessions.values());
    const nextState = best?.state ?? null;
    const nextTask = best?.task ?? null;
    const nextSession = best?.sessionId ?? null;
    if (nextState === this.snap.state && nextTask === this.snap.task && nextSession === this.snap.sessionId) return;
    this.snap.state = nextState;
    this.snap.task = nextTask;
    this.snap.sessionId = nextSession;
    this.snap.ts = Date.now();
  }
}
