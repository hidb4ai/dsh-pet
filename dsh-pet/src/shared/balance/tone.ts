/**
 * Progress bar color matching state: There is only one threshold value and it is shared by both ends.
 *
 * The purpose of being independent into leaf modules is to avoid circular dependencies - handlers /* requires
 * quotaTone, and view.ts needs to be distributed to handlers.
 *
 * @module dsh-pet/src/shared/balance/tone
 */

/** Progress bar color matching state: normal when below 70%, warning between 70% and 90%, critical when 90% and above. */
export type QuotaTone = 'ok' | 'warn' | 'crit';

export const QUOTA_WARN_PERCENT = 70;
export const QUOTA_CRIT_PERCENT = 90;

/** Get the color matching state based on the used percentage. */
export function quotaTone(percent: number): QuotaTone {
  if (percent >= QUOTA_CRIT_PERCENT) return 'crit';
  if (percent >= QUOTA_WARN_PERCENT) return 'warn';
  return 'ok';
}
