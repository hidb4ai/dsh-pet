/**
 * Physics default parameters: spring, gravity, throwing limit and squeeze state.
 *
 * Only default values are provided; the physics segment of the resolved configuration shall prevail during
 * runtime. It must always be true: it must be consistent with the physics segment of config.jsonc in the package. If
 * you change one part, you must synchronize the other part.
 * @module dsh-pet/src/shared/physics/constants
 */
import { type PhysicsParams } from '../types.ts';

/** Drag spring stiffness: The larger the drag spring stiffness, the tighter the heel. */
export const SPRING_K = 200;

/** Drag spring damping: ζ = c /(2√ k ) ≈ 1.06, over-damped, not overshoot. */
export const SPRING_C = 30;

/** Drag trajectory retention window (ms): Only the most recent segment is retained for muzzle velocity estimation. */
export const TRAIL_KEEP_MS = 200;

/** Muzzle velocity estimation window (ms). */
export const RELEASE_WINDOW_MS = 150;

/** If you pause beyond it before letting go, you will let it go gently (without residual speed), even if you have shaken it before. */
export const RELEASE_STALE_MS = 150;

/** The window is too short and cannot be estimated (ms). */
export const MIN_SPAN_MS = 20;

/** Minimum dt (ms) for segmented speed: High return rate mouse events can be as low as 1 ms, too small dt will amplify jitter into false peaks. */
export const SEG_MIN_DT_MS = 8;

/** If the speed is lower than this, it will not be thrown (put it down in place), px/s. */
export const DEAD_ZONE_SPEED = 500;

/** Soft upper limit of throwing speed (px/s): cap ×(1- e ^(- s/cap)), any strength is still monotonically distinguishable, and the asymptotically does not exceed cap. */
export const MAX_THROW_SPEED = 3600;

/** Initial velocity = endpoint mean × (1- w ) + window peak × w, to compensate for the underestimation that the displacement is concentrated in a small section of the window during fast swing. */
export const PEAK_WEIGHT = 0.5;

/** Reference acceleration (px/s²): When the final acceleration reaches it, the gain is full. */
export const ACCEL_REF = 8000;

/** Acceleration gain upper limit: the swing that is still accelerating is amplified by up to 60%. */
export const ACCEL_GAIN_MAX = 0.6;

// Throwing physics default value: consistent with the physics segment of the built-in config. The final configuration shall prevail during runtime.
/** Throwing gravity (px/s²). */
export const GRAVITY = 1400;

/** Edge recovery coefficient: approximately 78% of the speed is retained for each rebound. */
export const RESTITUTION = 0.78;

/** Tangential friction on the contact surface (/s): The velocity attenuation rate along the direction of the contact surface after hitting a wall, landing, or hitting the top; 0 = all sides are like ice. */
export const GROUND_FRICTION = 2.5;

/** Default parameters for throwing physics (consistent with built-in configuration; only used as fallback when configuration is missing). */
export const DEFAULT_PHYSICS: PhysicsParams = {
  gravity: GRAVITY,
  restitution: RESTITUTION,
  groundFriction: GROUND_FRICTION,
  ceilingBounce: true,
  throwPower: 1,
  petCollision: true,
  hapticEnabled: true,
  tiltGravity: true,
  shakeThrow: true,
};

/** The default amount of total strength (throwPower =1 is the current situation). */
export const DEFAULT_THROW_POWER = 1;

/** If the normal velocity of the contact surface is lower than it will stick to it (px/s): Otherwise, when gravity continues to press on the same surface, it will be bounced every frame, which will appear as surface jitter. */
export const REST_NORMAL = 40;

/** The contact surface tangential velocity is lower than it thinks it is at rest (px/s). */
export const REST_TANGENT = 15;

/** Tolerance for judging normal velocity at rest (px/s): much stricter than {@link REST_NORMAL}, only used to confirm "already stuck". */
export const REST_NORMAL_EPS = 1;

/** Single step maximum dt (s): prevent giant frame jump after background tab lag recovery. */
export const MAX_STEP_DT = 0.05;

/** Pressure range: Press the height to 55%. */
export const SQ_SQUASH = 0.55;

/** Extrusion duration (ms). */
export const SQ_DURATION_MS = 220;

/** Landing impact speed standard: if it is lower than this, it will fall lightly (press the limit range). */
export const SQ_SOFT_SPEED = 300;

/** The upper limit of landing impact speed: if it reaches or exceeds this, it will be hit hard (maximum downward pressure is reached). */
export const SQ_HARD_SPEED = 1500;

/**
 * The maximum downward pressure amplitude when landing (consistent with clicking); the lower limit of light fall is
 * 0.8 - gravity 1400 px/s², typical landing speed under recovery 0.78 is 400~1500 px/s. If the mapping is too
 * conservative, the landing Q bounce of the conventional throw will not be obvious, so the bottom limit is left.
 */
export const SQ_MAX_SQUASH = 0.55;

/** The strength anchor point of the throwing command: power = 1.0 corresponds to 1200 px/s before the soft clamp speed (the actual initial velocity is suppressed to about 1021 px/s). */
export const THROW_SPEED_ANCHOR = 1200;

/**
 * Slingshot (double-click and hold down for the second time): strength = draw distance, regardless of hand speed. The
 * draw distance is only responsible for changing to the initial speed, and then it will still go throwStep /
 * throwStepRegion. Gravity, rebound, friction, and Q bullets will not change. Direction = the opposite direction of
 * pulling; there is no upper limit on the strength - the soft clamp speed is set for hand speed shaking, and it must
 * be possible to distinguish between pulling farther and farther. The scale has the same origin as throwVelocity:
 * power = 1 corresponds to THROW_SPEED_ANCHOR, and is multiplied by the same physics.throwPower. The reference draw
 * distance of "double strength" = pet width × SLINGSHOT_REF_RATIO.
 */
export const SLINGSHOT_REF_RATIO = 0.6;

// Points breakdown: There is no speed limit for the slingshot. It relies on splitting steps to ensure that the landing and rebound within one frame are not skipped. It is not a strength limit.
/** The maximum displacement allowed in a single step (px): If the displacement of a frame exceeds it, it is divided into multi-step integration. */
export const SUBSTEP_PX = 8;

/** How many steps can a single frame be split into at most (fallback: don’t drag a frame into hundreds of integrations at extreme speeds). */
export const SUBSTEP_MAX = 64;

/** Multi-pet collision recovery coefficient: energy loss about 0.5% (e = 0.995, close to perfect elasticity). */
export const PET_BOUNCE_E = 0.995;
