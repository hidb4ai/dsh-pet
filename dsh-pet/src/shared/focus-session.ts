/**
 * Analysis of jump session instructions: Narrow data of `sections.focusSession` into "the jump" or "skip".
 *
 * This is a one-time signal, and two criteria are indispensable: `ts` must be newer than the local water level
 * (otherwise the same item will jump repeatedly), and it cannot be too old (when the page is opened after a long time,
 * it should not be dragged away by an outdated click).
 * @module dsh-pet/src/shared/focus-session
 */

/** Replay window (ms): Old signals that exceed this duration will no longer be supplemented. */
export const FOCUS_REPLAY_WINDOW_MS = 10_000;

/** The execution jump: target session and its write time. */
export interface FocusCue {
  /** Target session id. */
  readonly sessionId: string;
  /** Write time (milliseconds) as the water level for the next weight determination. */
  readonly ts: number;
}

/**
 * Parsing a hop session signal.
 *
 * @param raw - `data` for leaves; returns null if the shape is invalid.
 * @param now - the current moment (ms); injected by caller for easy testing.
 * @param lastTs - the largest `ts` that has been processed locally; anything less than or equal to it will be skipped.
 * @returns The jump that should be executed; null when it should not jump.
 */
export function readFocusSession(raw: unknown, now: number, lastTs: number): FocusCue | null {
  if (!raw || typeof raw !== 'object') return null;
  const { sessionId, ts } = raw as { sessionId?: unknown; ts?: unknown };
  if (typeof sessionId !== 'string' || sessionId === '') return null;
  if (typeof ts !== 'number' || !Number.isFinite(ts)) return null;
  // The same signal is only processed once: the first pull and fill jump of the page and the subsequent increment read are the same ts.
  if (ts <= lastTs) return null;
  if (now - ts > FOCUS_REPLAY_WINDOW_MS) return null;
  return { sessionId, ts };
}
