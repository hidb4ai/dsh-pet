/**
 * Falling crush: The instantaneous flattening ratio is calculated based on the impact speed.
 *
 * No collision detection, no position change; just answer "How much should it be squashed at this time". It must
 * always be true: the return value falls within [ SQ_MAX_SQUASH , 0.8]. If it exceeds, it is considered that the
 * caller has miscalculated the speed.
 * @module dsh-pet/src/shared/physics/squash
 */
import { SQ_HARD_SPEED, SQ_MAX_SQUASH, SQ_SOFT_SPEED, SQ_SQUASH } from './constants.ts';

/** Landing impact speed → Pressure amplitude (the greater the speed, the harder the press), the result is used as the squash parameter of startSquash. */
export const landingSquash = (impactSpeed: number): number => {
  const t = Math.min(Math.max((Math.abs(impactSpeed) - SQ_SOFT_SPEED) / (SQ_HARD_SPEED - SQ_SOFT_SPEED), 0), 1);
  return Math.min(0.8, 1 - t * (1 - SQ_MAX_SQUASH));
};

/**
 * Q elastic extrusion curve: u ∈[0,1] progress → scaleY. Pressure section (0~0.45) ease-in compression, rebound
 * section (0.45~1) easeOutBack brings back about 4% overshoot, and both ends share the same curve.
 */
export const squashScale = (u: number, squash: number = SQ_SQUASH): number => {
  if (u < 0.45) {
    const p = u / 0.45;
    return 1 - (1 - squash) * p * p;
  }
  const p = (u - 0.45) / 0.55;
  // Standard overshoot coefficient of easeOutBack
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const f = 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2);
  return Math.min(1.12, squash + (1 - squash) * Math.max(f, 0));
};
