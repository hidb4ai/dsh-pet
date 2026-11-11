/**
 * Autonomous positioning: After the video is ready, the pet is moved from the starting point to the target proportion
 * according to the playback time, and the root node position is directly written on the way. It is not responsible for
 * which walking action to choose (planMoveAction has been decided), nor is it responsible for the spring and drag of
 * position following - those are the other two drives. The value function and current frame measurement of dependency
 * injection; rAF handle and pending actions are held by this module. After stop, the same instance can be re-planned.
 * Invariant: At most one moving position is running at the same time; when stopping and running, the running frame
 * must be canceled and the queued actions must be cancelled.
 * @module dsh-pet/src/client/pet/motion/walk
 */
import { planMoveAction, type PendingMove } from './move-action.ts';
import type { BoxPoint } from './geometry.ts';
import type { MovesConfig } from '../../../shared/types.ts';

/** The current frame geometry (px) required for movement. */
export interface WalkMetrics {
  /** Pet width. */
  size: number;
  /** Box half width. */
  halfW: number;
  /** Box half height. */
  halfH: number;
  /** There are transparent edges left on the left and right of the body relative to the video box. */
  sideAllow: number;
}

/** Dependence on positioning drivers: all use value functions to avoid capturing snapshots during the rendering period. */
export interface WalkDeps {
  /** Pet root node; `null` means it has not been mounted yet. */
  root(): HTMLDivElement | null;
  /** The viewport coordinates of the current pet center. */
  center(): { x: number; y: number };
  /** When frame geometry. */
  metrics(): WalkMetrics;
  /** The moving pool of this pet. */
  moves(): MovesConfig;
  /** The current orientation determines the moving direction. */
  facing(): 'left' | 'right';
  /** Current viewport size. */
  viewport(): { width: number; height: number };
  /** Is the throw flying? No new moves are initiated during flight. */
  isFlying(): boolean;
  /** Change to walking action and play it once. */
  play(anim: string): void;
  /** Write back the bounding box every frame: the starting point of the throw and the collision of the pet will read it first. */
  setBox(box: BoxPoint): void;
  /** After the movement is completed, it is submitted to the normalization center and handed over to React for rearrangement. */
  commit(center: { rx: number; ry: number }): void;
}

/** Movement driver: one instance per pet. */
export interface Walk {
  /** Is there any queuing action? When the video is ready, it will be decided whether to start or not. */
  hasPending(): boolean;
  /** Start running after the video is ready; return immediately when there are no queued actions. */
  start(el: HTMLVideoElement): void;
  /** Try to initiate a move: `true` is returned when occupied, `false` is returned when unable to move, and the action name is returned successfully. */
  tryMove(preferredName?: string): boolean | string;
  /** Stop and go: Cancel queued actions and cancel running frames. */
  stop(): void;
}

/** Fallback duration (seconds) when metadata is not ready: Take the common duration of the built-in walking asset to avoid division by zero. */
const FALLBACK_DURATION_SEC = 10.09;

/**
 * Create movement driver.
 *
 * @param deps - callback to get position, geometry and write back position.
 * @returns driver that can be called repeatedly.
 */
export function createWalk(deps: WalkDeps): Walk {
  /** rAF is running; `null` = is not running. */
  let frame: number | null = null;
  /** Generation number: +1 for running or stopping, and late frames will be discarded accordingly. */
  let token = 0;
  /** Position planned and waiting for video to be ready. */
  let pending: PendingMove | null = null;

  const hasPending = (): boolean => pending !== null;

  const start = (el: HTMLVideoElement): void => {
    if (pending === null || frame !== null) return;
    const move = pending;
    pending = null;
    const duration = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : FALLBACK_DURATION_SEC;
    const travelWindow = Math.max(0.1, duration - move.leadSec - move.tailSec);
    const own = ++token;
    const step = (): void => {
      if (token !== own) return;
      const t = el.currentTime || 0;
      const { halfW, halfH } = deps.metrics();
      const { width: W, height: H } = deps.viewport();
      let ratioX: number;
      if (t <= move.leadSec) ratioX = move.startRatio;
      else if (t >= duration - move.tailSec) ratioX = move.targetRatio;
      // Interpolate according to the planned landing point instead of dir × distance: When minDist/maxDist is
      // negative, the sign must be retained, otherwise the plan will go to the left, the drive will go to the right,
      // and then jump back to the original direction after walking.
      else ratioX = move.startRatio + (move.targetRatio - move.startRatio) * ((t - move.leadSec) / travelWindow);
      const box = { x: ratioX * W - halfW, y: move.startYRatio * H - halfH };
      const rootEl = deps.root();
      if (rootEl) {
        rootEl.style.left = box.x + 'px';
        rootEl.style.top = box.y + 'px';
        rootEl.style.right = 'auto';
        rootEl.style.bottom = 'auto';
      }
      // Write back the bounding box: After walking a certain distance, both the throwing starting point and the collision rectangle will read it. If you don’t write back, the last drag/flying position will be used.
      deps.setBox(box);
      if (t < duration - move.tailSec) frame = requestAnimationFrame(step);
      else {
        frame = null;
        deps.commit({ rx: move.targetRatio, ry: move.startYRatio });
      }
    };
    frame = requestAnimationFrame(step);
  };

  const tryMove = (preferredName?: string): boolean | string => {
    // true is returned during occupation: the caller knows that the pet is not available and does not need to choose the original action.
    if (frame !== null || pending !== null || deps.isFlying()) return true;
    const metrics = deps.metrics();
    const action = planMoveAction({
      moves: deps.moves(),
      preferredName,
      // The walking direction only looks at the current facing; do not use the turn animation to reverse the direction, facingRef has been synchronized in handleEnded in real time.
      facing: deps.facing(),
      size: metrics.size,
      center: deps.center(),
      viewport: deps.viewport(),
      halfW: metrics.halfW,
      sideAllow: metrics.sideAllow,
    });
    if (action === null) return false;
    pending = action.pending;
    deps.play(action.anim);
    return action.anim;
  };

  const stop = (): void => {
    pending = null;
    token++;
    if (frame !== null) {
      cancelAnimationFrame(frame);
      frame = null;
    }
  };

  return { hasPending, start, stop, tryMove };
}
