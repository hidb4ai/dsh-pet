/**
 * Working status linkage: state constant and snapshot analysis. The host side has a self-contained implementation (DSH
 * single file loading constraint, host is not import in this directory), which is responsible for monitoring DSH
 * session events, aggregating synthesis snapshots and writing sections.workStatus into / state; this module only has
 * state constants and leaf parsing. The bubble copy is not in the code: the browser side directly reads the configured
 * events.workStatusTexts. Pure functions have no side effects and do not depend on React / DOM.
 * @module dsh-pet/src/shared/work-status
 */

/** Working status state (corresponding to animations.events.workStatus array index, the order is the state, do not insert new state in the middle). */
export const WORK_STATUS_STATES = ['thinking', 'working', 'result', 'waiting', 'success', 'error'] as const;
export type WorkStatusState = (typeof WORK_STATUS_STATES)[number];

/** Gear → workStatus array index (strictly consistent with the order of events.workStatus). */
export const WORK_STATUS_INDEX: Record<WorkStatusState, number> = {
  thinking: 0, // turn/start → Thinking
  working: 1, // tool/call → Work
  result: 2, // tool/result → Organize
  waiting: 3, // approval/asked → Wait
  success: 4, // turn/end completed → Complete
  error: 5, // turn/end error/max-tokens → Error
};

/**
 * Working status snapshot (= data of sections.workStatus in / state, isomorphic with the host side). No ts: "Has it
 * changed?" is borne by counter of the leaf; text is not here - the bubble copy is read and configured by the client,
 * and the host is not generated.
 */
export interface WorkStatusSnapshot {
  state: WorkStatusState | null; // null = Idle
  task: string | null; // Current task details (provided by todo/write, available at null)
  /** The session to which the current display entry belongs; idle/external slot/old version host will not appear if this field is missing, so bubble cannot be clicked. */
  sessionId?: string | null;
}

/** Snapshot analysis: Unknown state → normalize to null (idle); invalid shape → null, consumer skips this shot. */
export function toWorkStatus(raw: unknown): WorkStatusSnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { state?: unknown; task?: unknown; sessionId?: unknown };
  const state: WorkStatusState | null =
    r.state === null || (typeof r.state === 'string' && (WORK_STATUS_STATES as readonly string[]).includes(r.state))
      ? (r.state as WorkStatusState | null)
      : null;
  const sessionId =
    typeof r.sessionId === 'string' && r.sessionId !== '' && r.sessionId !== 'unknown' ? r.sessionId : null;
  return { state, task: typeof r.task === 'string' ? r.task : null, sessionId };
}
