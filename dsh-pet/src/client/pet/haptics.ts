/**
 * Impact tactile feedback: Change the impact speed to a single pulse vibration.
 *
 * Only the browser side - Vibration API does not exist in iOS or the desktop side, the caller does not need to branch
 * for this. A collision only causes one shock: bouncing close to the ground will report the same landing for multiple
 * consecutive frames, which is swallowed up by the "similar impact cooling window".
 * @module dsh-pet/src/client/pet/haptics
 */

/** Cooling window for similar impacts (ms): Repeated hits within the window will only shock once. */
export const HAPTIC_COOLDOWN_MS = 120;

/** No vibration below this impact speed (px/s): There should be no feedback when touching lightly or when stationary. */
export const HAPTIC_MIN_SPEED = 150;

/** Feel anchor point: The same set of speed thresholds as the landing squeeze - soft impact is the shortest and hard smashing is the longest. */
const SOFT_SPEED = 300;
const HARD_SPEED = 1500;
const SHORT_PULSE_MS = 10;
const LONG_PULSE_MS = 28;

/** Collision type, the value is consistent with the edge name on the physical side, plus pets colliding with each other. */
export type ImpactKind = 'left' | 'right' | 'ceiling' | 'floor' | 'pet';

/**
 * Impact speed → single vibration duration.
 *
 * @param speed - Normal velocity before impact (px/s).
 * @returns duration (ms); return to `null` when the earthquake should not occur.
 */
export function pulseMsFor(speed: number): number | null {
  if (!Number.isFinite(speed) || speed < HAPTIC_MIN_SPEED) return null;
  const t = Math.min(1, Math.max(0, (speed - SOFT_SPEED) / (HARD_SPEED - SOFT_SPEED)));
  return Math.round(SHORT_PULSE_MS + (LONG_PULSE_MS - SHORT_PULSE_MS) * t);
}

/** Tactile feedback entry point: Adjust once per impact. */
export interface Haptics {
  /** Depending on the type and speed of the impact, determine whether or not to shock and for how long. */
  hit(kind: ImpactKind, speed: number): void;
}

/** Create tactile feedback; dependencies can be injected to facilitate assertion in Node without touching the real hardware. */
export function createHaptics(deps?: {
  vibrate?: (ms: number) => void;
  now?: () => number;
  enabled?: () => boolean;
}): Haptics {
  const vibrate = deps?.vibrate ?? hardwareVibrate;
  const now = deps?.now ?? (() => performance.now());
  const enabled = deps?.enabled ?? (() => true);
  /** The last time of shock for each type of impact; `undefined` = Not yet. */
  const lastAt = new Map<ImpactKind, number>();
  return {
    hit(kind: ImpactKind, speed: number): void {
      if (!enabled()) return;
      const ms = pulseMsFor(speed);
      if (ms === null) return;
      const at = now();
      const prev = lastAt.get(kind);
      if (prev !== undefined && at - prev < HAPTIC_COOLDOWN_MS) return;
      lastAt.set(kind, at);
      vibrate(ms);
    },
  };
}

/** Real hardware: None API, page invisible or WebView silently skipped when error is thrown - Haptics is not a critical path. */
function hardwareVibrate(ms: number): void {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
  if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
  try {
    navigator.vibrate(ms);
  } catch {
    // Some WebView require the host to declare the VIBRATE permission. If it is not declared, it will be thrown; just ignore it.
  }
}
