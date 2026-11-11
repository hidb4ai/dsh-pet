/**
 * Client exit in polling state: Leave the latest beat for the same page plugin to read through the Cordis service.
 * Only references are stored, no comparison is made, and no status changes are distributed: the comparison is in
 * shared/state and the distribution is in pet/multi. This module does not have a second criterion. Page-level
 * singleton, not shared between tabs; `/state` was `null` before the first shot.
 * @module dsh-pet/src/client/state-service
 */
import type { PollState } from '../shared/state.ts';

/** The status of the latest shot; `null` = This page has not been pulled yet. */
let latest: PollState | null = null;

/** Subscriber: Notified once for every beat. */
const listeners = new Set<(state: PollState) => void>();

/**
 * Record the status of the latest beat (the only call point is the distribution entry point of pet/multi).
 *
 * Notify subscribers one by one and tell their own mistakes: the callback of a certain panel is thrown, and this beat
 * cannot be continued to be distributed - polling is the entry point for full-page pet rendering. An error on the
 * consumer side should not make everyone stop at the old screen.
 *
 * @param state - The polling status just pulled; the whole package is replaced, no deep copy - each tick is originally
 * a new object.
 */
export function setStateSnapshot(state: PollState): void {
  latest = state;
  for (const listener of listeners) {
    try {
      listener(state);
    } catch (error) {
      console.error('[dsh-pet] State subscriber callback failed; polling will continue:', error);
    }
  }
}

/** Read the status of the latest shot; this page is `null` when `/state` has not come back. */
export function getStateSnapshot(): PollState | null {
  return latest;
}

/**
 * subscribe for each subsequent beat (the current beat is not reissued: the caller decides whether to read it first).
 *
 * @param listener - Called when a new beat is received.
 * @returns unsubscribe function.
 */
export function subscribeStateSnapshot(listener: (state: PollState) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * clear snapshot and subscribe; for testing, let each use case start from a page without status.
 * @internal only resets the global singleton for testing and does not promise to the outside world.
 */
export function resetStateSnapshot(): void {
  latest = null;
  listeners.clear();
}
