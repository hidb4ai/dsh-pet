/**
 * Drag spring following: The bounding box catches up with the pointer target through damping, smoothing out the
 * high-frequency jitter of pointer events. It is not responsible for the pointer status and release settlement: the
 * target is updated every frame by the drag module, here we just chase the box. Depends on the spring step of
 * shared/physics; the frame handle and speed are held by this module, and can be re-aimed after stop. Invariant: At
 * most one follower is running at the same time; aiming and stop-and-go will cause late frames to be discarded.
 * @module dsh-pet/src/client/pet/motion/drag-follow
 */
import { springStep } from '../../../shared/physics.ts';
import type { BoxPoint } from './geometry.ts';

/** The ability to take the current frame every time the driver starts: take a snapshot when starting, and drag the inner box and spring parameters unchanged. */
export interface DragFollowDeps {
  /** When frame capability snapshot. */
  card(): {
    /** Current bounding box position. */
    box(): BoxPoint | null;
    /** Write back the bounding box position (called every frame). */
    setBox(box: BoxPoint): void;
    /** The physical parameters of this pet are only the spring stiffness. */
    physics: { throwPower: number };
  };
}

/** Spring follower driver: one instance per pet. */
export interface DragFollow {
  /** Set the target for this shot (the upper left corner of the bounding box). */
  aim(target: BoxPoint): void;
  /** Start running; return immediately when already running. */
  start(rootEl: HTMLDivElement): void;
  /** Stop following and clear the target and remaining speed. */
  stop(): void;
}

/**
 * Create a follower drive.
 *
 * @param deps - Read and write bounding boxes and get spring stiffness.
 * @returns Repeatable aiming driver.
 */
export function createDragFollow(deps: DragFollowDeps): DragFollow {
  /** rAF is running; `null` = not chasing. */
  let frame: number | null = null;
  /** Generation number: start or stop +1, late frames are discarded accordingly. */
  let token = 0;
  /** Chasing target; `null` = No target. */
  let target: BoxPoint | null = null;
  /** The speed of the previous frame (px/s) accumulates over-damping feel across frames. */
  let velocity = { vx: 0, vy: 0 };
  /** The time of the previous frame (ms). */
  let last = 0;

  const stop = (): void => {
    token++;
    if (frame !== null) {
      cancelAnimationFrame(frame);
      frame = null;
    }
    target = null;
    velocity = { vx: 0, vy: 0 };
  };

  const aim = (next: BoxPoint): void => {
    target = next;
  };

  const start = (rootEl: HTMLDivElement): void => {
    if (frame !== null) return;
    const current = deps.card();
    const spring = current.physics.throwPower;
    const own = ++token;
    last = performance.now();
    const step = (): void => {
      if (token !== own) return;
      const goal = target;
      if (!goal) {
        frame = null;
        return;
      }
      const now = performance.now();
      const dt = Math.min((now - last) / 1000, 1 / 30);
      last = now;
      const box = current.box() ?? { x: 0, y: 0 };
      let x = box.x;
      let y = box.y;
      velocity.vx = springStep(velocity.vx, x, goal.x, dt, spring);
      velocity.vy = springStep(velocity.vy, y, goal.y, dt, spring);
      x += velocity.vx * dt;
      y += velocity.vy * dt;
      current.setBox({ x, y });
      rootEl.style.left = x + 'px';
      rootEl.style.top = y + 'px';
      rootEl.style.right = 'auto';
      rootEl.style.bottom = 'auto';
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
  };

  return { aim, start, stop };
}
