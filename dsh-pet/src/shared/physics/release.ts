/**
 * Estimation of initial velocity of throwing: convert a series of pointer samples into starting hand speed, and give
 * the strength corresponding to the draw distance of the slingshot.
 *
 * No integration is performed and the position is not changed; the output is only used as the initial value of
 * throwStep. This must always be true: sampling intervals outside the window are considered loose, and concatenate
 * speeds across the window are not allowed.
 * @module dsh-pet/src/shared/physics/release
 */ import { type PhysicsParams } from '../types.ts';
import type { DragSample } from './throw.ts';
import {
  ACCEL_GAIN_MAX,
  ACCEL_REF,
  DEAD_ZONE_SPEED,
  DEFAULT_PHYSICS,
  DEFAULT_THROW_POWER,
  MIN_SPAN_MS,
  PEAK_WEIGHT,
  RELEASE_STALE_MS,
  RELEASE_WINDOW_MS,
  SEG_MIN_DT_MS,
  SLINGSHOT_REF_RATIO,
  THROW_SPEED_ANCHOR,
  TRAIL_KEEP_MS,
} from './constants.ts';
import { softClampSpeed } from './spring.ts';

/** Eliminate old samples outside the retention window; samples are appended by time, so you only need to cut from scratch. */
export const trimTrail = (trail: DragSample[], now: number): DragSample[] => {
  const cutoff = now - TRAIL_KEEP_MS;
  let i = 0;
  while (i < trail.length && trail[i].t < cutoff) i++;
  return i === 0 ? trail : trail.slice(i);
};

/**
 * Throwing instruction (POST /throw of angle + power) → initial velocity (vx, vy), px/s. angle unit degree, 0 = right
 * and counterclockwise is positive - the screen y is downward, so vy is negative (throw it upward and write 90, not
 * 270). Initial velocity = power × THROW_SPEED_ANCHOR. Beyond the existing soft upper limit, any power is
 * monotonically distinguishable and does not exceed MAX_THROW_SPEED. Both ends share this function to ensure that the
 * initial velocity conversion of the interface throw is strictly consistent.
 */
export const throwVelocity = (angleDeg: number, power: number): { vx: number; vy: number } => {
  const speed = softClampSpeed(power * THROW_SPEED_ANCHOR);
  const rad = (angleDeg * Math.PI) / 180;
  return { vx: Math.cos(rad) * speed, vy: -Math.sin(rad) * speed };
};

/** The reference draw distance of "double strength" (px) scales with the size of the pet - small pets do not have to be dragged the same distance to explode. */
export const slingshotRefDist = (size: number): number => (size > 0 ? size * SLINGSHOT_REF_RATIO : 0);

/** Draw length → Strength magnification (px / reference draw length): linear, monotonic, no clamping; 0 draw length = 0 strength. */
export const slingshotPower = (dist: number, size: number): number => {
  const ref = slingshotRefDist(size);
  if (!(ref > 0) || !(dist > 0) || !Number.isFinite(dist)) return 0;
  return dist / ref;
};

/** Pull vector (starting point → release point, screen coordinates, y downward) → ejection angle (degrees): The bounce is in the opposite direction of the pull, and the angle agreement is the same as throwVelocity. */
export const pullAngle = (pullX: number, pullY: number): number => (Math.atan2(pullY, -pullX) * 180) / Math.PI;

/** Slingshot initial velocity: The angle convention is the same as the force anchor point throwVelocity, but there is no soft upper limit (any power is monotonically distinguishable). */
export const slingshotVelocity = (
  angleDeg: number,
  power: number,
  throwPower: number = DEFAULT_THROW_POWER,
): { vx: number; vy: number } => {
  const speed = THROW_SPEED_ANCHOR * Math.max(0, power) * Math.max(0, throwPower);
  // 0 velocity is given directly to 0 (instead of -0 calculated as cos/sin): the speed in the leaves must be compared with ordinary numbers
  if (speed === 0) return { vx: 0, vy: 0 };
  const rad = (angleDeg * Math.PI) / 180;
  return { vx: Math.cos(rad) * speed, vy: -Math.sin(rad) * speed };
};

/**
 * Estimating the initial release velocity (vx, vy), px/s from the drag trajectory. The direction takes the
 * displacement of the first and end points of the window (anti-shake); the size = the end point average and the window
 * peak value are weighted by PEAK_WEIGHT. When the end section is still accelerating, press ACCEL_REF to give the gain
 * (up to ACCEL_GAIN_MAX), and then pass the soft clamp speed. After the soft clamp speed is multiplied by
 * physics.throwPower as a whole, the initial velocity and dead zone determination are linearly scaled together. Return
 * null = gentle release (the trajectory is empty/stayed too long/the window is too short/the peak value is lower than
 * the dead zone), the caller is not thrown.
 */
export const estimateReleaseVelocity = (
  trail: DragSample[],
  now: number,
  physics: PhysicsParams = DEFAULT_PHYSICS,
): { vx: number; vy: number } | null => {
  if (trail.length === 0) return null;
  const last = trail[trail.length - 1];
  if (now - last.t > RELEASE_STALE_MS) return null;
  const win = trail.filter((s) => now - s.t <= RELEASE_WINDOW_MS);
  if (win.length < 2) return null;
  const t0 = win[0].t;
  const x0 = win[0].x;
  const y0 = win[0].y;
  const t1 = win[win.length - 1].t;
  const x1 = win[win.length - 1].x;
  const y1 = win[win.length - 1].y;
  const spanMs = t1 - t0;
  if (spanMs < MIN_SPAN_MS) return null;
  const baseVx = ((x1 - x0) / spanMs) * 1000;
  const baseVy = ((y1 - y0) / spanMs) * 1000;
  const baseSpeed = Math.hypot(baseVx, baseVy);
  if (baseSpeed < 1e-6) return null; // Almost pure jitter in the window: there is no reliable direction, and the processing is put down in place. Segmented
  // speed (over-density sampling is merged forward, dt lower limit SEG_MIN_DT_MS)
  const segSpeeds: { speed: number; tEnd: number }[] = [];
  let px = x0;
  let py = y0;
  let pt = t0;
  for (const s of win.slice(1)) {
    const dt = s.t - pt;
    if (dt >= SEG_MIN_DT_MS) {
      segSpeeds.push({ speed: (Math.hypot(s.x - px, s.y - py) / dt) * 1000, tEnd: s.t });
      px = s.x;
      py = s.y;
      pt = s.t;
    }
  }
  const peakSpeed = segSpeeds.length ? Math.max(...segSpeeds.map((v) => v.speed)) : baseSpeed;
  // Terminal acceleration: The slope of the peak velocity at the end relative to the first stage. The initial velocity is amplified by the swing that is still accelerating.
  let accel = 0;
  if (segSpeeds.length >= 2) {
    const lastSeg = segSpeeds[segSpeeds.length - 1];
    const firstSeg = segSpeeds[0];
    accel = (lastSeg.speed - firstSeg.speed) / Math.max((lastSeg.tEnd - firstSeg.tEnd) / 1000, MIN_SPAN_MS / 1000);
  }
  const speedBeforeClamp =
    ((1 - PEAK_WEIGHT) * baseSpeed + PEAK_WEIGHT * peakSpeed) *
    (1 + Math.min(Math.max(accel, 0) / ACCEL_REF, 1) * ACCEL_GAIN_MAX);
  const speed = softClampSpeed(speedBeforeClamp) * physics.throwPower;
  if (speed < DEAD_ZONE_SPEED) return null;
  return { vx: (baseVx / baseSpeed) * speed, vy: (baseVy / baseSpeed) * speed };
};
