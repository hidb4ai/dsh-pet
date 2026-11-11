/**
 * points Form: Used percentage of points or points balance (non-monetary) with bubble copy.
 *
 * The difference from money is only in semantics: the unit is the suffix brought out by the data, and there is no
 * currency symbol; the mathematics is the same, the unit is eliminated in the ratio, and there is no exchange rate
 * issue.
 *
 * @module dsh-pet/src/shared/balance/handlers/points
 */

import type { BalanceBubbleRow, BalanceView } from '../types.ts';
import type { ShapeHandler } from './shape.ts';

/**
 * The same set of "base conversion" mathematics as money, the data comes from points instead of wallets.
 *
 * If there is no benchmark or the benchmark is invalid, undefined will be returned, the state animation will not be
 * played, and the state will not be guessed for the service provider.
 */
function pointsPercent(v: BalanceView): number | undefined {
  const total = Number(v.points?.total);
  const full = Number(v.points?.full);
  if (!Number.isFinite(total) || !Number.isFinite(full) || full <= 0) return undefined;
  return Math.max(0, Math.min(100, 100 - (total / full) * 100));
}

/**
 * One line "Balance 800 points".
 *
 * The unit is the suffix brought out by the data, and does not include currency symbols - $ /¥ That set of judgments
 * only belongs to money; 0 is also displayed as usual, and 0 points are the real readings.
 */
function pointsRows(v: BalanceView): BalanceBubbleRow[] {
  const p = v.points;
  if (!p) return [{ role: 'label', text: '积分数据不可用' }];
  return [{ role: 'label', text: '余额 ' + p.total + ' ' + p.unit }];
}

/** Display rules for the points form: percentages are converted based on points, bubbles only spell numbers and units. */
export const pointsHandler: ShapeHandler = {
  percent: pointsPercent,
  rows: pointsRows,
};
