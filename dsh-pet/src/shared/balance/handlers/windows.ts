/**
 * windows form: percentage of three window usage conventions, bubble text and most urgent window determination.
 *
 * It has nothing to do with the service provider - the full quota of each window and the duration of the rolling
 * window are brought out by the data, and the quota of any service provider is not written down here.
 *
 * @module dsh-pet/src/shared/balance/handlers/windows
 */

import { quotaTone } from '../tone.ts';
import type { BalanceBubbleRow, BalanceView, WindowKey, WindowUsage } from '../types.ts';
import type { ShapeHandler } from './shape.ts';

/**
 * The window display name of the week and month, used for bubble and association box text.
 *
 * The length of the rolling window is the service provider's own business fact (such as 5 hours). If you don't follow
 * this table, see DEFAULT_ROLLING_LABEL.
 */
export const WINDOW_LABELS = {
  weekly: '周',
  monthly: '月',
} as const;

/**
 * The fallback of the rolling window display name, the service provider should bring rollingLabel with the data, and
 * it is used by default.
 *
 * Missing a label will leave a gap in the bubble, and 5 h is the current common value of the two rolling window
 * service providers.
 */
export const DEFAULT_ROLLING_LABEL = '5h';

/** Get the window display name: the rolling window uses the service provider’s self-reported value, and the weekly and monthly fixed tables */
function windowLabel(v: BalanceView, w: WindowKey): string {
  if (w === 'rolling') return v.rollingLabel ?? DEFAULT_ROLLING_LABEL;
  return WINDOW_LABELS[w];
}

/** The full quota of each window is all derived from data. */
function windowQuotas(v: BalanceView): Record<WindowKey, number | undefined> {
  return { rolling: v.rollingCapUsd, weekly: v.weeklyCapUsd, monthly: v.monthlyCapUsd };
}

/**
 * Taking the first critical window, all service providers in the windows state share the same set of judgments.
 *
 * When the full quota is complete, the absolute conventions are used to compare the remaining quota (USD); when there
 * is a window that cannot provide the full quota, it degenerates to the ratio of the used percentage - the two window
 * quotas have different magnitudes, and it is counterintuitive to compare the absolute surplus if one is missing.
 * Windows that do not exist are skipped directly without adding 0.
 *
 * A side effect of absolute conventions is that rolling windows usually report first (the smallest amount). This
 * behavior is deliberately retained and consistent on both ends.
 */
export function urgentWindow(v: BalanceView): WindowUsage | undefined {
  // Only the windows form has the concept of "window": money (account balance) and points (points) have no emergency windows.
  if (v.shape !== 'windows') return undefined;
  const quotas = windowQuotas(v);
  const resets: Record<WindowKey, string | undefined> = {
    rolling: v.rollingResetsAt,
    weekly: v.weeklyResetsAt,
    monthly: v.monthlyResetsAt,
  };
  const present = (['rolling', 'weekly', 'monthly'] as WindowKey[]).filter((w) => v[w] !== undefined);
  if (present.length === 0) return undefined;
  const allQuotas = present.every((w) => {
    const quota = quotas[w];
    return quota !== undefined && quota > 0;
  });

  let best: WindowUsage | undefined;
  for (const w of present) {
    const percent = v[w] ?? 0;
    const quota = quotas[w];
    const cand: WindowUsage = {
      label: windowLabel(v, w),
      percent,
      quotaUsd: quota,
      remainingUsd: allQuotas && quota !== undefined ? (quota * (100 - percent)) / 100 : undefined,
      resetsAt: resets[w],
    };
    if (best === undefined) {
      best = cand;
      continue;
    }
    const moreUrgent = allQuotas ? (cand.remainingUsd ?? 0) < (best.remainingUsd ?? 0) : cand.percent > best.percent;
    if (moreUrgent) best = cand;
  }
  return best;
}

/**
 * Convert the reset time into a relative copy, keeping one decimal place.
 *
 * If it has been four days or more, it will report "N.x days", if it is less than four days it will report "N.x
 * hours"; if the reset point has passed, it will report "reset", if the time is unknown, an empty string will be
 * returned.
 */
export function resetInText(iso?: string): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const delta = t - Date.now();
  if (delta <= 0) return '已重置';
  const hoursF = delta / 3_600_000;
  if (hoursF >= 96) return (Math.round((hoursF / 24) * 10) / 10).toFixed(1) + ' 天';
  return Math.max(0.1, Math.round(hoursF * 10) / 10).toFixed(1) + ' 小时';
}

/** Take the maximum value of the three windows. When there is only a monthly window, it is itself. */
function windowsPercent(v: BalanceView): number | undefined {
  return Math.max(v.rolling ?? 0, v.weekly ?? 0, v.monthly ?? 0);
}

/** Convert the three types of returns of resetInText into one prompt: empty string = unknown time, 'reset' = the point has been passed, and the rest = countdown. */
function resetPhrase(reset: string): string {
  if (reset === '') return '重置时间未知';
  return reset === '已重置' ? reset : reset + '重置';
}

/** Two lines: used percentage of most urgent window and reset countdown */
function windowsRows(v: BalanceView): BalanceBubbleRow[] {
  const w = urgentWindow(v);
  if (!w) return [{ role: 'label', text: '额度数据不可用' }];
  const reset = resetInText(w.resetsAt);
  return [
    { role: 'label', text: w.label + '额度已用 ' + Math.round(w.percent) + '%' },
    { role: 'sub', text: resetPhrase(reset) },
  ];
}

/**
 * Each existing window in the expanded state has one line: window name, progress bar, used percentage and reset
 * countdown.
 *
 * Only existing windows are listed. rolling and weekly default to indicate that the service provider does not have
 * this window. No zeros are added and no empty bars are drawn.
 */
function windowsDetail(v: BalanceView): BalanceBubbleRow[] {
  const resets: Record<WindowKey, string | undefined> = {
    rolling: v.rollingResetsAt,
    weekly: v.weeklyResetsAt,
    monthly: v.monthlyResetsAt,
  };
  const rows: BalanceBubbleRow[] = [];
  for (const w of ['rolling', 'weekly', 'monthly'] as WindowKey[]) {
    const percent = v[w];
    if (percent === undefined) continue;
    // The same set of reset text as the collapsed state, and both ends are rendered as they are.
    const reset = resetInText(resets[w]);
    const usedText = Math.round(percent) + '%';
    const resetText = resetPhrase(reset);
    rows.push({
      role: 'quota',
      text: windowLabel(v, w) + ' ' + usedText + ' ' + resetText,
      label: windowLabel(v, w),
      percent,
      tone: quotaTone(percent),
      usedText,
      resetText,
    });
  }
  return rows.length > 0 ? rows : windowsRows(v);
}

/** Compact count: 1.2 B / 96.0 M / 478.3 K, rounded to the nearest 1000. Fixed one decimal place - the width of three numbers on the same page is stable and does not jump with the value. */
function compactCount(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(Math.round(n));
}

/**
 * The third page: Cumulative usage in this period. One row of `usage` carries the entire card, and the two ends are
 * arranged into three rows and two columns - "Token / total amount", "input / output", "number of requests in this
 * period / cost", the total amount is the only big character.
 *
 * When the service provider does not provide this data, it returns undefined, which is determined by the number of
 * pages. The bubble has only two pages; half of the given number will not be spelled in.
 */
function windowsUsage(v: BalanceView): BalanceBubbleRow[] | undefined {
  const u = v.usage;
  if (!u) return undefined;
  const total = compactCount(u.totalTokens);
  const input = compactCount(u.inputTokens) + ' 入';
  const output = compactCount(u.outputTokens) + ' 出';
  const period = '本期 ' + u.requests + ' 次';
  const spend = '$' + u.spentUsd.toFixed(2);
  // The proportion bar uses the real proportion: the input usually accounts for the absolute majority, it is a fact that the bar looks almost monochrome, and the minimum width is not enlarged.
  const sum = u.inputTokens + u.outputTokens;
  const inputPercent = sum > 0 ? (u.inputTokens / sum) * 100 : undefined;
  return [
    {
      role: 'usage',
      text: 'Token ' + total + ' · ' + input + ' / ' + output + ' · ' + period + ' · ' + spend,
      title: 'Token',
      total,
      input,
      output,
      period,
      spend,
      inputPercent,
    },
  ];
}

/** The display rules of windows form: the percentage is the largest among the three windows, the expanded state is one line per window, and one page is added when the amount is available. */
export const windowsHandler: ShapeHandler = {
  percent: windowsPercent,
  rows: windowsRows,
  detail: windowsDetail,
  usage: windowsUsage,
};
