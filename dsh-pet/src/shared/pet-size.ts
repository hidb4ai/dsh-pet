/**
 * Analysis of the actual rendering width of pets: synthesize the frame width (px) using "pixel limit + character
 * screen percentage".
 *
 * The percentage refers to how much the character occupies the screen width, and stage is a 16:9 frame with 0.3125
 * transparent edges on both sides, so the conversion must be divided by the proportion of the character occupying the
 * frame ({@link BODY_WIDTH_RATIO}). Pure function, does not read DOM.
 * @module dsh-pet/src/shared/pet-size
 */
import { HIT_BOX } from './constants.ts';

/** The ratio of the width of the character body to the width of the picture frame; inversely deduced from the hit box (240/640), do not write another copy of 0.375 elsewhere. */
const BODY_WIDTH_RATIO = (HIT_BOX.x1 - HIT_BOX.x0) / 640;

/** Percent lower limit (%): less than it means nothing is written. There is no upper limit - filling in 150 means "the character is wider than the screen", and `size` determines the final size of the frame. */
export const SIZE_PERCENT_MIN = 1;

/** Default value: Characters occupy 20% of the screen width - the small screen does not blur the face, but the wide screen is still clamped by the upper limit of the `size` frame. */
export const SIZE_PERCENT_DEFAULT = 20;

/**
 * Is the percentage available? It must be a finite number and not less than the lower limit.
 *
 * @param value - the original value in the configuration, may be undefined.
 * When @returns is available, true and the type is narrowed to number; `undefined` , character string, `NaN` , `< 1`
 * are all false.
 */
export function isValidSizePercent(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= SIZE_PERCENT_MIN;
}

/**
 * Get the width used for this mount.
 *
 * @param sizePx - The width of the frame in the configuration, and also the upper limit of the percentage (take it if
 * the frame calculated by the percentage exceeds it).
 * @param sizePercent - the percentage of the screen width occupied by the character; the default is
 * {@link SIZE_PERCENT_DEFAULT} .
 * @param viewportWidthPx - The viewport width at the time of calling (CSS pixels); a non-positive number means it
 * cannot be obtained, and it will fallback directly to `sizePx` .
 * @returns The actual rendered frame width, unit px.
 */
export function resolvePetSizePx(sizePx: number, sizePercent: number | undefined, viewportWidthPx: number): number {
  const percent = sizePercent ?? SIZE_PERCENT_DEFAULT;
  if (!isValidSizePercent(percent)) return sizePx;
  if (!Number.isFinite(viewportWidthPx) || viewportWidthPx <= 0) return sizePx;
  const bodyWidthPx = (viewportWidthPx * percent) / 100;
  return Math.min(sizePx, bodyWidthPx / BODY_WIDTH_RATIO);
}
