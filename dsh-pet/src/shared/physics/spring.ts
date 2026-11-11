/**
 * Following hand spring and speed limit: Turn the pointer displacement into a smooth following hand speed.
 *
 * The clock is not read and the status is not written; dt is passed in by the caller frame by frame. This must always
 * be true: dt needs to be smaller than MAX_STEP_DT, otherwise the step is too large.
 * @module dsh-pet/src/shared/physics/spring
 */
import { DEFAULT_THROW_POWER, MAX_THROW_SPEED, SPRING_C, SPRING_K } from './constants.ts';

/**
 * Over-damped spring single-axis speed step: caller followed by x += v * dt.
 * power = total strength (K/C multiplied together: the system shape remains unchanged, the convergence speed is p
 * times faster, that is, it is more consistent or looser).
 */
export const springStep = (
  v: number,
  x: number,
  target: number,
  dt: number,
  power: number = DEFAULT_THROW_POWER,
): number => v + ((target - x) * SPRING_K - v * SPRING_C) * power * dt;

/**
 * Soft clamp speed: cap ×(1- e ^(- s/cap )), monotonic and distinguishable at any speed, asymptotically not exceeding
 * cap. The throwing command has the same speed limit as dragging and throwing, and the feel is the same.
 */
export const softClampSpeed = (speed: number): number => {
  if (speed <= 0) return 0;
  return MAX_THROW_SPEED * (1 - Math.exp(-speed / MAX_THROW_SPEED));
};
