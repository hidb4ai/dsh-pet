/**
 * Gear percentage entry point and state index: the driving basis for pet animation.
 *
 * The percentage conventions are assigned to the respective handler according to the form (windows takes the largest
 * of the three windows, money and points are converted according to the benchmark), here only the entry point is
 * retained and the state segmentation has nothing to do with the service provider.
 *
 * @module dsh-pet/src/shared/balance/percent
 */

import { HANDLERS } from './handlers/index.ts';
import type { BalanceView } from './types.ts';

/**
 * Get the used percentage (0 = not consumed, 100 = exhausted); return undefined for a form that cannot provide
 * percentage semantics, and do not guess one for the service provider.
 *
 * See each handler for specific conventions: windows takes the largest of the three windows, money is converted
 * according to each currency's own benchmark and then superimposed (no exchange rate is required), points is converted
 * according to the ratio within the same unit.
 */
export function balancePercent(v: BalanceView): number | undefined {
  return HANDLERS[v.shape].percent(v);
}

/**
 * The state index corresponding to the used percentage: 20% first state, only 100% is the highest state 5.
 *
 * The index corresponds to the balance state animation in the resolved configuration one-to-one.
 */
export function balanceEventIndex(p: number): number {
  if (p === 100) return 5;
  const i = Math.floor(p / 20);
  return i < 5 ? i : 4;
}
