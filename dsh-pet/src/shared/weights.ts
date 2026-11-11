/**
 * Pure calculation of action frequency weight: derivation of clamping and "random action" proportions. The browser
 * settings page and the standalone mode settings page share the same rules to avoid counting them twice on both sides.
 * @module dsh-pet/src/shared/weights
 */
import type { Weights } from './types.ts';

/** Three editable weight fields; random actions are margins and are not configured separately. */
export const WEIGHT_KEYS = ['idle', 'turn', 'move'] as const;

/** The upper limit of the total weight (percentage): the sum of the three items cannot exceed it, otherwise the random action will be a negative number. */
export const WEIGHTS_TOTAL = 100;

/** Built-in default value: consistent with animationWeights of assets/config.jsonc; placeholder when configuration is missing or not ready. */
export const DEFAULT_WEIGHTS: Weights = { idle: 10, turn: 5, move: 5 };

/**
 * Rounding and clamping; non-finite numbers are processed according to the upper limit, and no bad status is written
 * when dirty values appear in the input box.
 *
 * @param value - the value to be normalized.
 * @param min - Lower limit.
 * @param max - upper limit.
 * @returns is the integer after clamping.
 */
const clampInt = (value: number, min: number, max: number): number => {
  const rounded = Math.round(value);
  if (!Number.isFinite(rounded)) return min;
  // Bad handwritten configuration may make the upper limit lower than the lower limit (the total of the three items has exceeded 100): when the lower limit is clamped, a negative number will never be generated.
  const upper = Math.max(min, max);
  return Math.min(Math.max(rounded, min), upper);
};

/**
 * The proportion of random actions: the total upper limit minus the sum of the three items, with a minimum of 0.
 *
 * @param weights - The current three weights.
 * @returns An integer from 0 to 100; if a handwritten value is too large, it will be treated as 0.
 */
export function actionPercent(weights: Weights): number {
  return Math.max(0, WEIGHTS_TOTAL - weights.idle - weights.turn - weights.move);
}

/**
 * Change one weight: leave the other two items unchanged and reach the upper limit of "leaving 0 for random actions".
 *
 * @param weights - The current three weights.
 * @param key - the field to be changed.
 * @param value - target value; decimal rounding, out-of-bounds clipping.
 * @returns New weight object (no modification of input parameters).
 */
export function withWeight(weights: Weights, key: keyof Weights, value: number): Weights {
  const others = weights.idle + weights.turn + weights.move - weights[key];
  return { ...weights, [key]: clampInt(value, 0, WEIGHTS_TOTAL - others) };
}

/**
 * Parse weights from untrusted input: only use all three items if they are non-negative finite numbers.
 *
 * @param raw - `animationWeights` in finished configuration.
 * @returns parsed weight; missing fields, non-numeric or negative numbers return `undefined` , caller retains the
 * current value of the form.
 */
export function parseWeights(raw: unknown): Weights | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const record = raw as Record<string, unknown>;
  const idle = Number(record.idle);
  const turn = Number(record.turn);
  const move = Number(record.move);
  if ([idle, turn, move].some((value) => !Number.isFinite(value) || value < 0)) return undefined;
  return { idle, turn, move };
}
