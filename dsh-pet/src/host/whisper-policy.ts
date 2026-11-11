/**
 * The scheduling conclusion of automatic whisper: whether the "pet self-switch" and "standalone mode AI ready"
 * synthesis are enabled, the cycle only takes the pet configuration. It is not responsible for timing and generation;
 * the only source of the cycle is `eventsRefreshSec.whisper` on the host side.
 * @module dsh-pet/src/host/whisper-policy
 */

export interface StandaloneWhisperPolicy {
  /** Is the standalone mode service ready (fully configured and not paused). */
  isReady(): boolean;
}

/**
 * Automatic whisper scheduling conclusion: enabled + actual period.
 *
 * In standalone mode, AI is required to be ready; in DSH host mode, only the switch and cycle of the pet
 * configuration itself are viewed.
 */
export function automaticWhisperSchedule(
  policy: StandaloneWhisperPolicy | undefined,
  petEnabled: boolean,
  configuredPeriodSec: number,
): { enabled: boolean; periodSec: number } {
  if (!policy) return { enabled: petEnabled, periodSec: configuredPeriodSec };
  return { enabled: petEnabled && policy.isReady(), periodSec: configuredPeriodSec };
}
