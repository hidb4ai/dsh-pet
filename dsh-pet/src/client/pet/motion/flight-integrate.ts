/**
 * Frame-by-frame subdivision of points for throwing: one frame is divided into several sub-steps to prevent the entire
 * frame from crossing the landing and rebounding at high speeds.
 *
 * Do not collide with DOM, rAF and pets, only accumulate the state forward by one frame; the number of sub-steps is
 * determined by {@link throwSubsteps} .
 * @module dsh-pet/src/client/pet/motion/flight-integrate
 */
import { throwBounds, throwStep, throwSubsteps, type GravityVector, type ThrowState } from '../../../shared/physics.ts';
import type { PhysicsParams } from '../../../shared/types.ts';

/** The output of one frame of integration: state plus two flags. */
export type FlightStep = ReturnType<typeof throwStep>;

/** Throw bounds: calculated from viewport and pet size. */
export type FlightBounds = ReturnType<typeof throwBounds>;

/**
 * Subdivision integral of one frame.
 *
 * One frame may span hundreds of px. If it is not split, the landing and rebound frames will be skipped, and the
 * landing squeeze and landing determination will be missed.
 *
 * @param state - Flight status at the starting point of this frame.
 * @param dt - Duration of this frame (seconds).
 * @param bounds - Collision boundary.
 * @param physics - Physical parameters.
 * @param gravity - Gravity of this frame; default is vertically downward.
 * @returns The status of the end point of this frame, including whether it touches the edge and whether it is settled.
 */
export function integrateFlight(
  state: ThrowState,
  dt: number,
  bounds: FlightBounds,
  physics: PhysicsParams,
  gravity?: GravityVector,
): FlightStep {
  const substeps = throwSubsteps(state.vx, state.vy, dt);
  let res = throwStep(state, dt / substeps, bounds, physics, gravity);
  /** Only the heaviest impact in the sub-step is retained: one frame of shock is enough. */
  let hit = res.hit;
  for (let i = 1; i < substeps && !res.atRest; i++) {
    res = throwStep(res, dt / substeps, bounds, physics, gravity);
    if (res.hit !== null && (hit === null || res.hit.speed > hit.speed)) hit = res.hit;
  }
  return { ...res, hit };
}
