/**
 * money form: used percentage of account amount and bubble text.
 *
 * The amounts of different currencies cannot be added, but the ratio is dimensionless, so no exchange rate is needed -
 * each currency calculates the remaining ratio based on its own basis and then adds it.
 *
 * @module dsh-pet/src/shared/balance/handlers/money
 */

import type { BalanceBubbleRow, BalanceView } from '../types.ts';
import type { ShapeHandler } from './shape.ts';

/**
 * Each currency calculates the remaining proportion based on its own basis, and then adds it up and converts it into a
 * used percentage.
 *
 * Currencies without a benchmark will be skipped and no one will be guessed for it; if there is no currency with a
 * benchmark, undefined will be returned and the state animation will not be played.
 */
function moneyPercent(v: BalanceView): number | undefined {
  let remaining = 0;
  let based = 0;
  for (const w of v.wallets ?? []) {
    const total = Number(w.total);
    const full = Number(w.fullBalance);
    if (!Number.isFinite(total) || !Number.isFinite(full) || full <= 0) continue;
    remaining += total / full; // A negative number (overdraft) will lower the remaining amount, and eventually it will be stuck to "used up"
    based++;
  }
  if (based === 0) return undefined;
  return Math.max(0, Math.min(100, 100 - remaining * 100));
}

/**
 * One line "Balance (Peak/Trough) ¥ x.xx".
 *
 * Only the currencies with total non-0 are displayed: negative numbers should be displayed (overdrafts are real money
 * owed), and those with exactly 0 do not take up space; CNY takes priority, separated by "/" with the symbol
 * concatenate; when all are 0, fallback ¥0.00, otherwise the bubble will have an empty line. The stall decoration is
 * only available to service providers that provide this pricing rule. If not, the brackets will not be added.
 */
function moneyRows(v: BalanceView): BalanceBubbleRow[] {
  const visible = (v.wallets ?? [])
    .filter((w) => Number(w.total) !== 0)
    .sort((a, b) => (a.currency === 'CNY' ? 0 : 1) - (b.currency === 'CNY' ? 0 : 1));
  const amount =
    visible.length > 0 ? visible.map((w) => (w.currency === 'USD' ? '$' : '¥') + w.total).join('/') : '¥0.00';
  if (!v.tier) return [{ role: 'label', text: '余额 ' + amount }];
  return [
    { role: 'label', text: '余额（' },
    { role: 'tier', tier: v.tier, text: v.tier === 'peak' ? '峰' : '谷' },
    { role: 'label', text: '）' + amount },
  ];
}

/** Display rules for the money form: The percentage is converted based on the currency, and a business bubble is obtained. */
export const moneyHandler: ShapeHandler = {
  percent: moneyPercent,
  rows: moneyRows,
};
