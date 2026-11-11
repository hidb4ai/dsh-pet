/**
 * Working status linkage: Flatten the activity status in store at intervals of 5 s and write it into the polling
 * snapshot.
 *
 * Does not listen to session events (belongs to the session listener) and does not render bubbles. Dependencies are
 * explicitly passed in by apply (see input type), and the module does not read globals or create singletons.
 * @module dsh-pet/src/host/plugin/work-status-bridge
 */
import type { HostSetup } from './setup.ts';

/** Input to the working status bridge: polling snapshot, working status store, and sentinel session id used to determine "external slot". */
export type WorkStatusBridgeInput = Pick<HostSetup, 'state' | 'workStatus' | 'EXTERNAL_WORK_SESSION'>;

/**
 * Create a working status bridge.
 */
export function createWorkStatusBridge(deps: WorkStatusBridgeInput) {
  const { state, workStatus, EXTERNAL_WORK_SESSION } = deps;
  // The working status snapshot is written to S: it is written only when the content has really changed (counter is
  // advanced each time it is written, and the front end replays the state animation accordingly). Only press "working →
  // result that is less than WORK_STATE_GAP_MS from the last write" - the tool will cut back and forth more than ten
  // times in seconds, and the front end will replay the clip from frame 0 every time it cuts; the reverse direction is
  // not pressed (being late to start the work is worse than changing the film one more time), and the final state is
  // not pressed.
  const WORK_STATE_GAP_MS = 5000;

  let publishedWork = '\u0000';

  let publishedState: string | null = null;

  let publishedWorkAt = 0;

  let workFlushTimer: ReturnType<typeof setTimeout> | null = null;

  const publishWorkStatus = (): void => {
    const snap = workStatus.snapshot();
    // Conversations are also considered content: if the same file and copywriter change the conversation, the page must know, otherwise clicking bubble will jump to the previous conversation.
    const key = String(snap.state) + '\u0000' + String(snap.task) + '\u0000' + String(snap.sessionId ?? '');
    if (key === publishedWork) return;
    // Jitter judgment: only press the direction working → result (only changing the copy in the same file does not
    // count as jitter, write immediately as usual; in the opposite direction, result → working, write immediately)
    const busyFlip = publishedState === 'working' && snap.state === 'result';
    const wait = WORK_STATE_GAP_MS - (Date.now() - publishedWorkAt);
    if (busyFlip && wait > 0) {
      // Do not write the entire article (press the file and copy together): take the latest snapshot and rewrite it
      // when the point is reached (do not cache snap here - the period may have changed again)
      workFlushTimer ??= setTimeout(() => {
        workFlushTimer = null;
        publishWorkStatus();
      }, wait);
      return;
    }
    if (workFlushTimer !== null) {
      clearTimeout(workFlushTimer);
      workFlushTimer = null;
    }
    publishedWork = key;
    publishedState = snap.state;
    publishedWorkAt = Date.now();
    // The external slot (`api`) is not a real DSH session: it is written as null here so that the client will not make the bubble an entry point that does not respond.
    const sessionId = snap.sessionId === null || snap.sessionId === EXTERNAL_WORK_SESSION ? null : snap.sessionId;
    state.writeSection('workStatus', { state: snap.state, task: snap.task, sessionId });
  };

  /** Stop the pending rewrite timer (called when the plugin is unmounted). */
  const stopWorkStatusFlush = (): void => {
    if (workFlushTimer !== null) {
      clearTimeout(workFlushTimer);
      workFlushTimer = null;
    }
  };
  return { publishWorkStatus, stopWorkStatusFlush };
}
/** The output of the working status bridge (for downstream factories on demand Pick). */
export type WorkStatusBridge = ReturnType<typeof createWorkStatusBridge>;
