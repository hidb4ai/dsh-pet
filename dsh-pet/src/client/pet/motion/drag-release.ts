/**
 * Settlement after letting go: Determine whether the drag is put down on the spot, thrown or slingshot, and the
 * initial velocity of take-off is given. Do not write DOM and do not read the clock: the bounding box, trajectory and
 * time are all passed in by the caller, which facilitates single testing and both ends share the same conventions.
 * Rely on shared/physics's muzzle velocity estimation and slingshot conversion. Invariant: The slingshot only depends
 * on the draw distance (it has nothing to do with hand speed); when it is not a slingshot, the trajectory cannot
 * estimate the speed, so just put it down on the spot.
 * @module dsh-pet/src/client/pet/motion/drag-release
 */
import {
  estimateReleaseVelocity,
  pullAngle,
  slingshotPower,
  slingshotVelocity,
  type DragSample,
} from '../../../shared/physics.ts';
import type { BoxPoint } from './geometry.ts';
import type { PhysicsParams } from '../../../shared/types.ts';

/** Input of release settlement. */
export interface ReleaseInput {
  /** The upper left corner of the bounding box when letting go (take the real-time value of the spring follower, not the pointer target). */
  box: BoxPoint;
  /** The center of the pet when pressed ( px ), the starting point of the slingshot pull vector. */
  anchor: { x: number; y: number };
  /** Box half width and half height (px). */
  half: { w: number; h: number };
  /** Pet width (px), the slingshot reference draw length is scaled according to it. */
  size: number;
  /** Is it a slingshot this time (the pressing interval is short enough). */
  sling: boolean;
  /** Pointer trajectory sampling. */
  trail: readonly DragSample[];
  /** Release time (ms). */
  now: number;
  /** The physical parameters of this pet. */
  physics: PhysicsParams;
}

/** Where to go if you let go. */
export type ReleaseDecision =
  | { kind: 'sling'; dist: number; power: number; velocity: { vx: number; vy: number } }
  | { kind: 'throw'; velocity: { vx: number; vy: number } }
  | { kind: 'place' };

/**
 * Decide how to let go after letting go.
 *
 * @param input - Bounding box, pressed point, trajectory and physical parameters.
 * @returns slingshot (including draw length and strength, easy to log), throw it or put it down on the spot.
 */
export function decideRelease(input: ReleaseInput): ReleaseDecision {
  if (input.sling) {
    // The strength is determined by the pulling distance (regardless of hand speed), and the direction is opposite to the pulling direction; the pulling vector is calculated using the actual center of the pet.
    const pullX = input.box.x + input.half.w - input.anchor.x;
    const pullY = input.box.y + input.half.h - input.anchor.y;
    const dist = Math.hypot(pullX, pullY);
    const power = slingshotPower(dist, input.size);
    return {
      kind: 'sling',
      dist,
      power,
      velocity: slingshotVelocity(pullAngle(pullX, pullY), power, input.physics.throwPower),
    };
  }
  const velocity = estimateReleaseVelocity(input.trail as DragSample[], input.now, input.physics);
  return velocity ? { kind: 'throw', velocity } : { kind: 'place' };
}
