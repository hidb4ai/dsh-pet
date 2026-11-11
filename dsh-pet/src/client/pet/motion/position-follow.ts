/**
 * Position following: Turn the position command (normalized center) into a positioning animation - instant one frame
 * in place, line linear tweening, spring over-damping following. All three modes only interpolate in pixel space:
 * interpolation according to the normalized ratio will distort the diagonal line, and will also make the speed
 * inconsistent under different viewports. Only run one at a time: the new command cancels the old one, the generation
 * number causes the late frame to discard itself; the whole frame gives way when the user presses the pet (interaction
 * priority).
 * @module dsh-pet/src/client/pet/motion/position-follow
 */
import { springStep } from '../../../shared/physics.ts';
import type { PositionMode } from '../../../shared/state.ts';
import { centerToBox, type BoxPoint, type Center, type HalfSize, type Viewport } from './geometry.ts';

/** Dependence on position following: all use value functions to avoid capturing snapshots during rendering. */
export interface PositionFollowDeps {
  /** Pet root node; `null` means it has not been mounted yet. */
  root: () => HTMLDivElement | null;
  /** Current bounding box position (px); `null` = Not in position yet. */
  box: () => BoxPoint | null;
  /** Write back the bounding box position (called every frame). */
  setBox: (box: BoxPoint) => void;
  /** After placement, submit to the normalization center and hand it over to React for rearrangement. */
  commit: (center: Center) => void;
  /** Current viewport size. */
  viewport: () => Viewport;
  /** Half width and half height of the box. */
  half: () => HalfSize;
  /** Spring stiffness (take `physics.throwPower` of resolved configuration). */
  spring: () => number;
  /** Whether the user is pressing the pet: when pressing, the whole shot is discarded. */
  isDragging: () => boolean;
  /** Stop flying and moving before taking over. */
  takeOver: () => void;
}

/** Position following driver: one instance per pet. */
export interface PositionFollow {
  /**
   * Execute a position command.
   *
   * @param rx - The horizontal scale of the target center relative to the viewport.
   * @param ry - The vertical ratio of the target center relative to the viewport.
   * @param mode - Positioning method.
   * @param duration - `line` mode duration (ms); `<= 0` is regarded as instant.
   */
  apply: (rx: number, ry: number, mode: PositionMode, duration: number) => void;
  /** Give up the follow-up in progress (used for positioning or new takeover). */
  stop: () => void;
}

/**
 * Create position following driver.
 *
 * @param deps - Get position, write position and take over callback.
 * @returns driver that can be called repeatedly.
 */
export function createPositionFollow(deps: PositionFollowDeps): PositionFollow {
  /** rAF in progress; `null` = running without following. */
  let frame: number | null = null;
  /** Generation number: +1 for each start or stop, and late frames will be discarded accordingly. */
  let token = 0;

  const stop = (): void => {
    token += 1;
    if (frame !== null) {
      cancelAnimationFrame(frame);
      frame = null;
    }
  };

  /** The writing bounding box is shared with four style, spring and straight lines. */
  const paint = (el: HTMLDivElement, x: number, y: number): void => {
    deps.setBox({ x, y });
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    el.style.right = 'auto';
    el.style.bottom = 'auto';
  };

  const apply = (rx: number, ry: number, mode: PositionMode, duration: number): void => {
    if (deps.isDragging()) return;
    // Take over explicitly first: stop flying and moving, and stop the last following while moving.
    deps.takeOver();
    const target = centerToBox({ rx, ry }, deps.viewport(), deps.half());
    const el = deps.root();
    if (!el || mode === 'instant' || (mode === 'line' && duration <= 0)) {
      deps.setBox(target);
      deps.commit({ rx, ry });
      return;
    }
    const current = token + 1;
    token = current;
    if (frame !== null) cancelAnimationFrame(frame);
    if (mode === 'line') {
      if (duration <= 0) return; // It has been blocked above, and only the type is narrowed here.
      const from = deps.box() ?? target;
      const t0 = performance.now();
      const step = (): void => {
        if (token !== current) return;
        const p = Math.min((performance.now() - t0) / duration, 1);
        if (p >= 1) {
          // Accurate positioning, leaving no residual deviation at the end point.
          paint(el, target.x, target.y);
          frame = null;
          deps.commit({ rx, ry });
          return;
        }
        paint(el, from.x + (target.x - from.x) * p, from.y + (target.y - from.y) * p);
        frame = requestAnimationFrame(step);
      };
      frame = requestAnimationFrame(step);
      return;
    }
    // spring: Over-damping spring follows, no travel time, and relies on convergence to determine its own cleanup.
    let last = performance.now();
    const vel = { vx: 0, vy: 0 };
    const step = (): void => {
      if (token !== current) return;
      const now = performance.now();
      const dt = Math.min((now - last) / 1000, 1 / 30);
      last = now;
      let x = deps.box()?.x ?? target.x;
      let y = deps.box()?.y ?? target.y;
      vel.vx = springStep(vel.vx, x, target.x, dt, deps.spring());
      vel.vy = springStep(vel.vy, y, target.y, dt, deps.spring());
      x += vel.vx * dt;
      y += vel.vy * dt;
      paint(el, x, y);
      // Convergence judgment: Accurately position and submit when close enough and slow enough.
      if (
        Math.abs(target.x - x) < 0.5 &&
        Math.abs(target.y - y) < 0.5 &&
        Math.abs(vel.vx) < 1 &&
        Math.abs(vel.vy) < 1
      ) {
        paint(el, target.x, target.y);
        frame = null;
        deps.commit({ rx, ry });
        return;
      }
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
  };

  return { apply, stop };
}
