/**
 * Exposed exits for drag-and-throw physics: constants, springs, squeeze, throw, and collision.
 *
 * Only re-export, no logic; sub-modules are separated according to the reason of change./physics/. It must always be
 * true: the browser side and the desktop Helper consume the same implementation, and the feel cannot be forked.
 * @module dsh-pet/src/shared/physics
 */
export {
  ACCEL_GAIN_MAX,
  ACCEL_REF,
  DEAD_ZONE_SPEED,
  DEFAULT_PHYSICS,
  DEFAULT_THROW_POWER,
  GRAVITY,
  GROUND_FRICTION,
  MAX_STEP_DT,
  MAX_THROW_SPEED,
  MIN_SPAN_MS,
  PEAK_WEIGHT,
  PET_BOUNCE_E,
  RELEASE_STALE_MS,
  RELEASE_WINDOW_MS,
  RESTITUTION,
  REST_NORMAL,
  REST_NORMAL_EPS,
  REST_TANGENT,
  SEG_MIN_DT_MS,
  SLINGSHOT_REF_RATIO,
  SPRING_C,
  SPRING_K,
  SQ_DURATION_MS,
  SQ_HARD_SPEED,
  SQ_MAX_SQUASH,
  SQ_SOFT_SPEED,
  SQ_SQUASH,
  SUBSTEP_MAX,
  SUBSTEP_PX,
  THROW_SPEED_ANCHOR,
  TRAIL_KEEP_MS,
} from './physics/constants.ts';
export { landingSquash, squashScale } from './physics/squash.ts';
export {
  screenOfBox,
  throwBounds,
  throwBoundsIn,
  throwSpace,
  throwStep,
  throwStepRegion,
  throwSubsteps,
} from './physics/throw.ts';
export type { DragSample, GravityVector, ThrowBounds, ThrowSpace, ThrowState } from './physics/throw.ts';
export type { ContactEdge } from './physics/contact.ts';
export {
  estimateReleaseVelocity,
  pullAngle,
  slingshotPower,
  slingshotRefDist,
  slingshotVelocity,
  throwVelocity,
  trimTrail,
} from './physics/release.ts';
export { softClampSpeed, springStep } from './physics/spring.ts';
export { bodyPixelBox, collidePet, overlapPush, rectsOverlap } from './physics/collide.ts';
export type { PetCollider, PetCollisionSlot } from './physics/collide.ts';
