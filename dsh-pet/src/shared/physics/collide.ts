/**
 * Collision between pets: bounding box conversion, overlap determination and primary elastic separation.
 *
 * No multi-body solution is performed, and the rendering is not changed; only the answer is "did the collision occur,
 * and what was the speed after the collision?" Must always hold: only one separation is counted, no iterative solution
 * is performed.
 * @module dsh-pet/src/shared/physics/collide
 */
import { HIT_BOX } from '../constants.ts';
import { PET_BOUNCE_E } from './constants.ts';

/** A pet participating in the collision: position (upper left corner of the bounding box, px) + speed (px/s) + width (px, mass ∝ size ²). */
export interface PetCollider {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
}

/**
 * Body bounding box (HIT_BOX hit box scale converted to viewport pixels): geometry for collision intersection
 * detection.
 * box = the upper left corner of the pet bounding box (left/top of browser root, desktop window position);
 * bottomPad = Stage foot pad height (the amount stage is moved down by translateY).
 */
export const bodyPixelBox = (o: {
  x: number;
  y: number;
  size: number;
  bottomPad: number;
}): { left: number; top: number; right: number; bottom: number } => {
  const h = (o.size * 9) / 16;
  return {
    left: o.x + (HIT_BOX.x0 / 640) * o.size,
    top: o.y + o.bottomPad + (HIT_BOX.y0 / 360) * h,
    right: o.x + (HIT_BOX.x1 / 640) * o.size,
    bottom: o.y + o.bottomPad + (HIT_BOX.y1 / 360) * h,
  };
};

/** Whether two rectangles intersect (collision detection). */
export const rectsOverlap = (
  a: { left: number; top: number; right: number; bottom: number },
  b: { left: number; top: number; right: number; bottom: number },
): boolean => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

/**
 * Flying pet hits another: nearly elastic collision (conservation of momentum + restitution coefficient 0.995), mass ∝
 * size ². Normal = the line connecting the centers of the two bounding boxes, the normal velocity is redistributed
 * according to the one-dimensional momentum formula, and the tangential components are retained (no tangential
 * friction). Return null = The center coincidence cannot determine the normal direction, or the two are separating (to
 * avoid repeated bouncing and jittering of overlapping frames). impactSpeed is the normal relative velocity, used for
 * tactile feedback conversion intensity.
 */
export const collidePet = (
  fly: PetCollider,
  hit: PetCollider,
): { fvx: number; fvy: number; hvx: number; hvy: number; impactSpeed: number } | null => {
  const hf = (fly.size * 9) / 16 / 2;
  const hh = (hit.size * 9) / 16 / 2;
  const cx = hit.x + hit.size / 2 - (fly.x + fly.size / 2);
  const cy = hit.y + hh - (fly.y + hf);
  const dist = Math.hypot(cx, cy);
  if (dist < 1e-6) return null; // Center coincidence: No valid collision normal, skip this frame
  const nx = cx / dist;
  const ny = cy / dist;
  // Projection of relative velocity in the normal direction (collision direction = fly → hit, positive = approaching)
  const vrel = (fly.vx - hit.vx) * nx + (fly.vy - hit.vy) * ny;
  if (vrel <= 0) return null; // Separating: No more playing (to avoid repeated triggering of overlapping frames)
  const e = PET_BOUNCE_E;
  const m1 = fly.size * fly.size;
  const m2 = hit.size * hit.size;
  const v1n = fly.vx * nx + fly.vy * ny;
  const v2n = hit.vx * nx + hit.vy * ny;
  const v1n2 = ((m1 - e * m2) * v1n + (1 + e) * m2 * v2n) / (m1 + m2);
  const v2n2 = ((m2 - e * m1) * v2n + (1 + e) * m1 * v1n) / (m1 + m2);
  // Combination: Tangential component (original velocity − normal component) unchanged + new normal component
  return {
    fvx: fly.vx - v1n * nx + v1n2 * nx,
    fvy: fly.vy - v1n * ny + v1n2 * ny,
    hvx: hit.vx - v2n * nx + v2n2 * nx,
    hvy: hit.vy - v2n * ny + v2n2 * ny,
    impactSpeed: vrel,
  };
};

/**
 * The shortest push-out displacement when two body frames overlap: only geometry, no collision speed.
 *
 * Speed exchange ({@link collidePet}) returns null when the two are separating. It alone will make the two already
 * inserted together go directly through; adding this pure displacement can push them apart.
 *
 * @param a - own body frame.
 * @param b - The opponent's body frame.
 * @returns pushes the displacement of a away from b (each gives half); when there is no overlap, it returns to `null`
 * .
 */
export const overlapPush = (
  a: { left: number; top: number; right: number; bottom: number },
  b: { left: number; top: number; right: number; bottom: number },
): { dx: number; dy: number } | null => {
  const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  if (ox <= 0 || oy <= 0) return null;
  const alongX = ox <= oy;
  const sign = alongX
    ? (a.left + a.right) / 2 >= (b.left + b.right) / 2
      ? 1
      : -1
    : (a.top + a.bottom) / 2 >= (b.top + b.bottom) / 2
      ? 1
      : -1;
  return alongX ? { dx: (sign * ox) / 2, dy: 0 } : { dx: 0, dy: (sign * oy) / 2 };
};

/** Shared collision station slots (register one for each pet; browser side PetMulti is shared with desktop side collision broker). */
export interface PetCollisionSlot {
  /** Pet width (px, mass ∝ size²) */
  size: number;
  /** Stage foot pads (required for bodyPixelBox) */
  bottomPad: number;
  /** The upper left corner of the current bounding box (px); null = not mounted or no position */
  getBox: () => { x: number; y: number } | null;
  /** Current speed (px/s); it is 0 when not in motion */
  getVel: () => { vx: number; vy: number };
  /** Write the **absolute** speed after collision settlement (px/s): The pet will land according to the current mode - change the speed when it is moving, and take off if it is not moving. */
  applyVelocity: (vx: number, vy: number) => void;
}
