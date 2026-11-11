/**
 * Determination of "whether to pop up a text explanation" when the balance is unavailable.
 *
 * The judgment itself is stateless: it only compares the incoming lastKey, and the caller is responsible for saving
 * the returned key. Both ends (browser overlay and desktop shell) must use the same judgment, and writing one copy
 * each will inevitably drift.
 *
 * @module dsh-pet/src/shared/balance/notice
 */

import type { BalanceNoticeDecision, BalanceState } from './types.ts';

/**
 * Determine whether the bubble is played this time, and give the reason key for next comparison.
 *
 * Explicit requests (`/balance` command, desktop "View Balance" menu) will always pop up: the user should get a reply
 * when asking, including "not supported"; automatic polling will only pop up once when the reason (including service
 * provider) changes, and the first detection counts as a change, otherwise the same sentence will pop up every 30
 * minutes.
 *
 * @param state - Current balance status; read-only, this function does not modify it.
 * @param lastKey - The reason for the last prompt key, null means it has not been prompted yet.
 * @param explicit - Whether triggered by an explicit user request.
 * Whether @returns is bombed, and the key to be saved this time (the status of ok is null).
 */
export function decideBalanceNotice(
  state: BalanceState,
  lastKey: string | null,
  explicit: boolean,
): BalanceNoticeDecision {
  if (state.ok) return { show: false, key: null };
  const key = state.reason + ':' + state.provider;
  return { show: explicit || key !== lastKey, key };
}
