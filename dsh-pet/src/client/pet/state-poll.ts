/**
 * `/state` 's self-scheduling polling: request → distribute → request again immediately, and hang when the host does
 * not change. In the first shot, a normal request without since is used to find out whether the host supports long
 * polling (`counter` is supported if it exists), and then since is used to suspend and wait. Failure or old host backs
 * off for an interval to avoid becoming busy; unmount is judged by `isAlive` , and the loop exits on its own.
 * @module dsh-pet/src/client/pet/state-poll
 */
import type { PollState } from '../../shared/state.ts';

/** poller dependency. */
export interface StatePollDeps {
  /** Pull once status; `timeoutMs` has been determined according to host capability, `undefined` represents a normal request. */
  fetch: (options?: { since: number; timeoutMs: number }) => Promise<PollState | null>;
  /** Distribute leaves after getting a valid snapshot. */
  onState: (state: PollState) => void;
  /** Long polling hang time (ms). */
  waitMs: number;
  /** Backoff interval when failed or old host (ms). */
  fallbackMs: number;
  /** Whether the component is still mounted; when false, the loop exits immediately. */
  isAlive: () => boolean;
}

/** A wait that does not know resolve: simply give up this beat, use a timer instead of busy waiting. */
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Start self-scheduling polling (caller is not await: it runs all the way to `isAlive()` and returns to false).
 *
 * @param deps - Pull, dispatch and tempo parameters.
 * @returns has no return value; it will naturally cleanup after the loop ends.
 */
export async function runStatePoll(deps: StatePollDeps): Promise<void> {
  /** Does the host support long polling: if the first shot contains counter, it supports it. */
  let longPoll = false;
  /** The counter obtained last time is the since of long polling. */
  let since: number | undefined;
  while (deps.isAlive()) {
    let state: PollState | null = null;
    try {
      state = await deps.fetch(longPoll && since !== undefined ? { since, timeoutMs: deps.waitMs } : undefined);
    } catch {
      /* Light polling fails silently, try again next tick. */
    }
    if (!deps.isAlive()) return;
    if (state !== null) {
      longPoll = typeof state.counter === 'number';
      if (longPoll && typeof state.counter === 'number') since = state.counter;
      deps.onState(state);
    }
    // If long polling hits or first pulls, the request will be made again immediately; if it fails or the old host fails, it will back off by an interval.
    if (state === null || !longPoll) await sleep(deps.fallbackMs);
  }
}
