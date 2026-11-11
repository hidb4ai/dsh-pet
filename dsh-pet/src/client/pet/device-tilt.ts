/**
 * Mobile phone somatosensory input: gyroscope tilt and shake, converted into gravity vector and initial velocity in
 * the physical world.
 *
 * The conversion is separated from the subscribe: the conversion pure function can be tested individually, and
 * subscribe only touches the browser API. The sensor is only available in the security context (HTTPS / localhost) -
 * the two event types under HTTP do not exist at all, and subscribe is directly idle.
 * @module dsh-pet/src/client/pet/device-tilt
 */
import type { GravityVector } from '../../shared/physics.ts';

/** Tilt dead zone (degree): If it is less than it, it is considered as not tilting, so as to prevent the pet from sliding when the phone is originally tilted. */
export const TILT_DEAD_ZONE_DEG = 2;

/** Shake trigger threshold (m/s², excluding gravity): below it, it does not count as a shake. */
export const SHAKE_THRESHOLD = 18;

/** Shake the deduplicate window (ms): one shake only gives one impulse. */
export const SHAKE_COOLDOWN_MS = 300;

/** Shake benchmark: starting from 3600 px/s, increasing linearly with acceleration, capping at 4800. */
const SHAKE_BASE_SPEED = 3600;
const SHAKE_GAIN = 160;
const SHAKE_MAX_BONUS = 4800;

/** The plane component of an attitude sample (degrees). */
export interface TiltSample {
  /** Fore and aft tilt: 0 when lying flat, positive when tilting toward yourself. */
  readonly beta: number;
  /** Left and right tilt: 0 when lying flat, positive when tilting to the right. */
  readonly gamma: number;
}

/** Shake impulse (px/s). */
export interface ShakeVector {
  readonly vx: number;
  readonly vy: number;
}

/** Screen orientation angle (0/90/180/270): The tilt axis needs to be changed when the screen is horizontal. */
const screenAngleDeg = (): number => {
  if (typeof screen === 'undefined' || !screen.orientation) return 0;
  return screen.orientation.angle || 0;
};

/** Fold the angle difference to the nearest equivalent angle to avoid direction reversal when jumping from 179° to -179°. */
const nearestDelta = (delta: number, period: number): number => {
  const half = period / 2;
  return ((((delta + half) % period) + period) % period) - half;
};

/**
 * Tilt → Gravity vector: According to the trigonometric function projection, the component of the tilt angle θ is
 * `gravity × sin(θ)` .
 *
 * @param sample - Current attitude.
 * @param baseline - Neutral posture recorded when somatosensory is turned on.
 * @param gravity - The gravity in the configuration, as the full value when tilted to vertical (px/s²).
 * @param screenAngle - Screen orientation angle (degrees); rotate the device axis to the screen axis in landscape
 * orientation.
 * @returns The gravity component in the screen coordinate system; it is 0 when in the dead zone.
 */
export function tiltGravity(
  sample: TiltSample,
  baseline: TiltSample,
  gravity: number,
  screenAngle: number = screenAngleDeg(),
): GravityVector {
  const dBeta = nearestDelta(sample.beta - baseline.beta, 360);
  const dGamma = nearestDelta(sample.gamma - baseline.gamma, 180);
  if (Math.abs(dBeta) < TILT_DEAD_ZONE_DEG && Math.abs(dGamma) < TILT_DEAD_ZONE_DEG) return { gx: 0, gy: 0 };
  if (!Number.isFinite(gravity) || gravity <= 0) return { gx: 0, gy: 0 };
  const rad = Math.PI / 180;
  const ax = gravity * Math.sin(dGamma * rad);
  const ay = gravity * Math.sin(dBeta * rad);
  switch (((screenAngle % 360) + 360) % 360) {
    case 90:
      return { gx: ay, gy: -ax };
    case 180:
      return { gx: -ax, gy: -ay };
    case 270:
      return { gx: -ay, gy: ax };
    default:
      return { gx: ax, gy: ay };
  }
}

/**
 * Shake → Initial velocity: The direction is the shaking direction (horizontal/vertical acceleration of screen
 * coordinates), and the strength is based on the base × `throwPower` .
 *
 * @param ax - lateral acceleration (m/s²); may include gravity, which is what conventions for {@link SHAKE_THRESHOLD}
 * are.
 * @param ay - Longitudinal acceleration (m/s²).
 * @param az - Vertical acceleration (m/s ²): Participates in threshold determination - only it can make "pure front
 * and back shaking" enough to shake once.
 * @param throwPower - the total velocity multiplier in the configuration; `1` is the base velocity.
 * @returns initial velocity; `null` is returned when the acceleration is insufficient than the threshold or both
 * horizontal and vertical directions are 0 (direction is unavailable).
 */
export function shakeImpulse(ax: number, ay: number, az: number, throwPower: number): ShakeVector | null {
  const mag = Math.hypot(ax, ay, az);
  if (!Number.isFinite(mag) || mag < SHAKE_THRESHOLD) return null;
  const lateral = Math.hypot(ax, ay);
  if (lateral < 1e-6) return null;
  const speed = (SHAKE_BASE_SPEED + Math.min(SHAKE_MAX_BONUS, mag * SHAKE_GAIN)) * Math.max(0, throwPower);
  return { vx: (ax / lateral) * speed, vy: (ay / lateral) * speed };
}

/** Whether the environment has sensor API: These two global types do not exist under HTTP, and cannot be judged by whether the event arrives. */
export function canReadMotionSensors(): boolean {
  return typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceMotionEvent !== 'undefined';
}

/** The type of sensor to be applied for authorization this time: only ask about the event that is actually used. */
export interface MotionSensorKinds {
  /** Tilt (deviceorientation). */
  readonly tilt: boolean;
  /** Shake it (devicemotion). */
  readonly shake: boolean;
}

/**
 * Request sensor permission (required for iOS 13+ and must be called in user gesture); only apply for the type to be
 * used this time.
 *
 * @param kinds - Type that requires authorization; when both are turned off, no questions asked, just resolve `true` .
 * @returns When all applications are successful (or the environment does not require authorization in the first
 * place), it is `true` ; any one is rejected, or the event type does not exist in this context.
 * (Non-security context, neither global type under HTTP) is `false` .
 */
export async function requestMotionPermission(kinds: MotionSensorKinds): Promise<boolean> {
  const ask = async (ctor: unknown): Promise<boolean> => {
    if (ctor === undefined) return false;
    const fn = (ctor as { requestPermission?: () => Promise<string> }).requestPermission;
    if (typeof fn !== 'function') return true; // Android/Desktop does not have this API, it is regarded as authorized
    try {
      return (await fn.call(ctor)) === 'granted';
    } catch {
      return false;
    }
  };
  const granted: boolean[] = [];
  if (kinds.tilt) granted.push(await ask(globalThis.DeviceOrientationEvent));
  if (kinds.shake) granted.push(await ask(globalThis.DeviceMotionEvent));
  return granted.every(Boolean);
}

/**
 * subscribe gesture sampling.
 *
 * @param onSample - callback for each frame; skipped when beta/gamma (some devices) is missing in the event.
 * @returns unsubscribe.
 */
export function subscribeTilt(onSample: (sample: TiltSample) => void): () => void {
  if (typeof window === 'undefined' || typeof DeviceOrientationEvent === 'undefined') return () => {};
  const handler = (e: DeviceOrientationEvent): void => {
    if (e.beta === null || e.gamma === null) return;
    onSample({ beta: e.beta, gamma: e.gamma });
  };
  window.addEventListener('deviceorientation', handler, true);
  return () => window.removeEventListener('deviceorientation', handler, true);
}

/**
 * subscribe shake: only do threshold and deduplicate in this module, what the caller gets is the acceleration that is
 * "really counted as a shake".
 *
 * Some models do not give `acceleration` (only the one with gravity), so press `accelerationIncludingGravity`
 * fallback; the two sources share the same threshold, and it is still about 9.8 m/s² with gravity, which is still
 * lower than the threshold.
 *
 * @param onShake - Callback three-axis acceleration (m/s²) when triggered.
 * @param now - clock; test injection.
 * @returns unsubscribe.
 */
export function subscribeShake(
  onShake: (ax: number, ay: number, az: number) => void,
  now: () => number = () => performance.now(),
): () => void {
  if (typeof window === 'undefined' || typeof DeviceMotionEvent === 'undefined') return () => {};
  let lastAt = 0;
  const handler = (e: DeviceMotionEvent): void => {
    const a = e.acceleration;
    const raw = a && (a.x !== null || a.y !== null || a.z !== null) ? a : e.accelerationIncludingGravity;
    if (!raw) return;
    const ax = raw.x ?? 0;
    const ay = raw.y ?? 0;
    const az = raw.z ?? 0;
    if (Math.hypot(ax, ay, az) < SHAKE_THRESHOLD) return;
    const at = now();
    if (at - lastAt < SHAKE_COOLDOWN_MS) return;
    lastAt = at;
    onShake(ax, ay, az);
  };
  window.addEventListener('devicemotion', handler, true);
  return () => window.removeEventListener('devicemotion', handler, true);
}
