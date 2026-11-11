/**
 * DeepSeek Business conventions shared by the two routes: state benchmark and peak-to-valley pricing.
 *
 * It is not responsible for data acquisition and does not belong to the display layer - the display layer only
 * recognizes the states and benchmarks brought out in the data. The two routes (official API Key and DSH accounts) must
 * use the same set of benchmarks, otherwise the bubble states will be inconsistent.
 *
 * @module dsh-pet/src/host/balance/deepseek-common
 */
import type { PricingTier } from './types.ts';

/**
 * Balance tier basis (by currency): Balance ≥ This value is considered unconsumed, and the used percentage is
 * converted accordingly. CNY 20 / USD 5 is a reference for sufficient balance (the minimum recharge for DeepSeek is 10
 * yuan); different currencies cannot be converted.
 */
export const DEEPSEEK_FULL_BALANCE: Record<string, string> = { CNY: '20', USD: '5' };

/** Get the level benchmark of a certain currency; if there is no benchmark, it returns undefined and does not guess one for it. */
export function deepseekFullBalance(currency: string): string | undefined {
  return DEEPSEEK_FULL_BALANCE[currency];
}

/**
 * DeepSeek Peak-to-valley pricing (Beijing time): 9:00–12:00 and 14:00–18:00 on weekdays are peak hours, and the rest
 * are idle; weekend pricing is based on off-peak pricing (starting from 2026-08-23). It is calculated and brought out
 * with the data at the moment of fetching, so the display layer does not need to know any pricing rules.
 */
export function deepseekPricingTier(now: Date = new Date()): PricingTier {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    weekday: 'short',
    hour: '2-digit',
    hourCycle: 'h23', // Avoid midnight being formatted as 24:00.
  }).formatToParts(now);
  const pick = (type: Intl.DateTimeFormatPartTypes): string | undefined => parts.find((p) => p.type === type)?.value;
  const weekday = pick('weekday');
  const hour = Number(pick('hour'));
  if (weekday === 'Sat' || weekday === 'Sun') return 'idle';
  return (hour >= 9 && hour < 12) || (hour >= 14 && hour < 18) ? 'peak' : 'idle';
}
