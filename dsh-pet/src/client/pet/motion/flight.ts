/**
 * Throwing flight: gravity integration, edge rebound, landing friction and pet collision. Only the DOM position is
 * changed during flight, and the normalization center is submitted after settling. It is not responsible for the
 * starting point and initial velocity (the drag release, throwing command, and being hit to take off are determined
 * separately), nor is it responsible for the landing and squeezing animation itself. Dependency injection value
 * function; rAF handle and motion state are held by this module and survive across renderings. Invariant: first
 * integrate each frame, then calculate the collision, and finally write DOM; the absolute speed after the collision
 * write-only is calculated, and then settle on which frame commitFinal.
 * @module dsh-pet/src/client/pet/motion/flight
 */
import { throwBounds, type GravityVector, type PetCollisionSlot, type ThrowState } from '../../../shared/physics.ts';
import { integrateFlight } from './flight-integrate.ts';
import { createPetCollision, type PetCollisionResolver } from './pet-collision.ts';
import type { BoxPoint, Center, Viewport } from './geometry.ts';
import type { PhysicsParams } from '../../../shared/types.ts';

/** Current frame geometry required for flight (px). */
export interface FlightMetrics {
  /** Pet width. */
  size: number;
  /** Box half width. */
  halfW: number;
  /** Box half height. */
  halfH: number;
  /** There are transparent edges left on the left and right of the body relative to the video box. */
  sideAllow: number;
  /** The stage foot is raised: the body frame used for collision moves up according to it. */
  bottomPad: number;
}

/** Impact in this frame: which side (or pet) it hit and the speed before the collision. */
export interface FlightImpact {
  /** Collision object; `pet` = Collision with another pet. */
  kind: 'left' | 'right' | 'ceiling' | 'floor' | 'pet';
  /** Absolute value of normal velocity before impact (px/s). */
  speed: number;
}

/** Flight driver dependencies: all use value functions to avoid capturing snapshots during rendering. */
export interface FlightDeps {
  /** Pet root node; `null` means it has not been mounted yet. */
  root(): HTMLDivElement | null;
  /** When frame geometry. */
  metrics(): FlightMetrics;
  /** Current viewport size. */
  viewport(): Viewport;
  /** The physical parameters of this pet. */
  physics(): PhysicsParams;
  /** Collision between pets. */
  arena(): { slots: Record<string, PetCollisionSlot> };
  /** This pet id: used to jump over itself during collision. */
  petId: string;
  /** Current bounding box position. */
  box(): BoxPoint | null;
  /** Write back the bounding box position (called every frame). */
  setBox(box: BoxPoint): void;
  /** Each frame writes back to the unified center: press it to rearrange the position when refreshing or re-rendering, and the React state cannot be used (it will be a beat slower). */
  commitLive(center: Center): void;
  /** After settling, submit it to the normalization center and hand it over to React cleanup. */
  commitFinal(center: Center): void;
  /** Landing squeeze: The input parameter is the vertical speed (impact speed) before landing in this frame. */
  onLanding(impactVy: number): void;
  /** An impact occurs in this frame (collision with an edge or a pet): used for tactile feedback; a maximum of one callback is allowed in one frame, and the heaviest one in this frame is taken. */
  onImpact?(impact: FlightImpact): void;
  /** Gravity vector in somatosensory mode; the default is physics.gravity vertically downward. Read only in resident mode. */
  gravity?(): GravityVector;
}

/** Flight driver: one instance per pet. */
export interface Flight {
  /**
   * Take off from the given upper left corner and initial velocity (throwing mode: constant gravity and vertical
   * downwards, settling on the ground at low speed).
   *
   * @param px - left edge of the bounding box ( px ).
   * @param py - the upper edge of the bounding box ( px ).
   * @param vx - Horizontal muzzle velocity (px/s).
   * @param vy - vertical initial velocity (px/s).
   */
  start(px: number, py: number, vx: number, vy: number): void;
  /** Somatosensory resident mode: Starting from the current position, the initial velocity is zero, and the gravity is taken frame by frame {@link FlightDeps.gravity}; there is no side effect when it is resident. */
  startHeld(): void;
  /**
   * Rewrite current speed: collision settlement gives absolute speed, not increment.
   *
   * @param vx - horizontal speed (px/s).
   * @param vy - Vertical speed (px/s).
   */
  setVelocity(vx: number, vy: number): void;
  /**
   * Superimpose an impulse (shake it); ignore it when running - whether to take off and in what mode to take off are
   * determined by the caller.
   *
   * @param dvx - Transverse impulse (px/s).
   * @param dvy - Longitudinal impulse (px/s).
   */
  impulse(dvx: number, dvy: number): void;
  /** Grounded: Cancel the running frame and clear the motion status. */
  stop(): void;
  /** Whether it is running (both throwing and standing count). */
  isFlying(): boolean;
  /** Whether it is in somatosensory resident mode. */
  isHeld(): boolean;
  /** The speed of the latest frame; it is 0 when not running. */
  velocity(): { vx: number; vy: number };
}

/** The upper speed limit of resident mode (px/s): The sensor gravity will continue to accelerate, leaving a hard ceiling fallback. */
const MAX_HELD_SPEED = 6000;

/**
 * Build a flight driver.
 *
 * @param deps - Get geometry, write position and landing callback.
 * @returns driver that can be called repeatedly.
 */
export function createFlight(deps: FlightDeps): Flight {
  /** rAF is running; `null` = is not running. */
  let frame: number | null = null;
  /** Generation number: +1 for takeoff or grounding, late frames are discarded accordingly. */
  let token = 0;
  /** Status of the latest frame; `null` = not running. It is the same object as `current` within the frame. Changing the speed means changing the input at the next moment. */
  let state: ThrowState | null = null;

  /** Whether to use somatosensory resident mode: gravity is provided by {@link FlightDeps.gravity} frame by frame, and silent timing is used instead. */
  let held = false;
  /** Silent duration in resident mode (ms): accumulated when the gravity is zero and the speed is low, and the frame stops at that point. */
  let quietMs = 0;

  /** Collision settlement: The rules are in pet-collision, where only the collision is converted into a tactile callback. */
  const resolveCollisions: PetCollisionResolver = createPetCollision({
    arena: deps.arena,
    petId: deps.petId,
    onPetImpact: (speed) => deps.onImpact?.({ kind: 'pet', speed }),
  });

  const stop = (): void => {
    token++;
    if (frame !== null) {
      cancelAnimationFrame(frame);
      frame = null;
    }
    state = null;
    held = false;
    quietMs = 0;
  };

  const start = (px: number, py: number, vx: number, vy: number): void => {
    held = false;
    run(px, py, vx, vy);
  };

  /** Somatosensory resident mode: no muzzle velocity, gravity is provided by {@link FlightDeps.gravity} frame by frame; there is no side effect when in resident mode. */
  const startHeld = (): void => {
    if (frame !== null && held) return;
    const el = deps.root();
    const box = deps.box() ?? (el ? { x: el.getBoundingClientRect().left, y: el.getBoundingClientRect().top } : null);
    if (box === null) return;
    held = true;
    run(box.x, box.y, 0, 0);
  };

  /**
   * Rewrite current speed: collision settlement gives absolute speed, not increment.
   *
   * @param vx - horizontal speed (px/s).
   * @param vy - Vertical speed (px/s).
   */
  const setVelocity = (vx: number, vy: number): void => {
    if (state === null) return;
    state.vx = vx;
    state.vy = vy;
  };

  /**
   * Superimpose an impulse (shake it): only effective when running - press throw to take off when not running.
   *
   * @param dvx - Transverse impulse (px/s).
   * @param dvy - Longitudinal impulse (px/s).
   */
  const impulse = (dvx: number, dvy: number): void => {
    if (state === null) return;
    state.vx += dvx;
    state.vy += dvy;
  };

  const run = (px: number, py: number, vx: number, vy: number): void => {
    const metrics = deps.metrics();
    const viewport = deps.viewport();
    const physics = deps.physics();
    const bounds = throwBounds({
      W: viewport.width,
      H: viewport.height,
      size: metrics.size,
      sideAllow: metrics.sideAllow,
    });
    const own = ++token;
    quietMs = 0;
    let current: ThrowState = { x: px, y: py, vx, vy };
    let last = performance.now();
    let prevGrounded = false; // The landing squeeze only triggers once at the transition frame from air to ground.
    const rootEl = deps.root();

    /** Write back the position of this frame: DOM, bounding box and normalized center (the latter is rearranged according to it when re-rendering). */
    const commitPose = (at: ThrowState): Center => {
      if (rootEl) {
        rootEl.style.left = at.x + 'px';
        rootEl.style.top = at.y + 'px';
        rootEl.style.right = 'auto';
        rootEl.style.bottom = 'auto';
      }
      deps.setBox({ x: at.x, y: at.y });
      const center = { rx: (at.x + metrics.halfW) / viewport.width, ry: (at.y + metrics.halfH) / viewport.height };
      deps.commitLive(center);
      return center;
    };

    const step = (): void => {
      if (token !== own) return;
      const now = performance.now();
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
      last = now;
      const fallingVy = current.vy; // The vertical speed before integration in this frame, that is, the landing impact speed.
      const gravity = held ? deps.gravity?.() : undefined;
      const res = integrateFlight(current, dt, bounds, physics, gravity);
      if (res.hit !== null) deps.onImpact?.({ kind: res.hit.edge, speed: res.hit.speed });
      const integrated: ThrowState = { x: res.x, y: res.y, vx: res.vx, vy: res.vy };
      current = integrated;
      if (physics.petCollision) current = resolveCollisions(current, metrics);
      // After being hit, the frame judgment is no longer settled: the points result no longer represents the current position.
      const disturbed = current !== integrated;
      if (held) {
        const speed = Math.hypot(current.vx, current.vy);
        if (speed > MAX_HELD_SPEED) {
          const k = MAX_HELD_SPEED / speed;
          current = { ...current, vx: current.vx * k, vy: current.vy * k };
        }
      }
      state = current;
      const center = commitPose(current);
      // Landing Squeeze: Triggered only at the transition frame from air to ground, the strength depends on the impact speed.
      const grounded = current.y >= bounds.maxY - 1;
      if (res.bounced && grounded && !prevGrounded) deps.onLanding(fallingVy);
      prevGrounded = grounded;
      if (held) {
        // There is no fixed ground in the resident mode: when the gravity is zero and the speed is low, silence will accumulate and the frame will freeze at a certain point.
        const g = gravity ?? { gx: 0, gy: physics.gravity };
        const isStill = Math.hypot(g.gx, g.gy) < 1 && Math.hypot(current.vx, current.vy) < 20;
        quietMs = isStill ? quietMs + dt * 1000 : 0;
        if (quietMs >= 300) {
          deps.commitFinal(center);
          stop();
          return;
        }
      } else if (res.atRest && !disturbed) {
        deps.commitFinal(center);
        stop();
        return;
      }
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
  };

  return {
    impulse,
    isFlying: () => frame !== null,
    isHeld: () => held,
    setVelocity,
    start,
    startHeld,
    stop,
    velocity: () => (frame !== null && state !== null ? { vx: state.vx, vy: state.vy } : { vx: 0, vy: 0 }),
  };
}
