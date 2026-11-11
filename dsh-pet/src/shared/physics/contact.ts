/**
 * Contact surface solution: Decompose the velocity after impact according to the normal and tangential directions of
 * the contact surface, normal rebound and tangential friction.
 *
 * The normal direction is uniformly agreed to be "pointing to the side away from the contact surface", so the four
 * edges share the same set of formulas; only the speed is calculated, and the position clamping is still responsible
 * for throw.ts.
 */
import type { PhysicsParams } from '../types.ts';
import { REST_NORMAL, REST_NORMAL_EPS, REST_TANGENT } from './constants.ts';

/** Axis aligned contact surface. */
export type ContactEdge = 'left' | 'right' | 'ceiling' | 'floor';

/** The unit normal direction of each contact surface (nx, ny), facing the passable side. */
export const CONTACT_NORMALS: Readonly<Record<ContactEdge, { readonly nx: number; readonly ny: number }>> = {
  left: { nx: 1, ny: 0 },
  right: { nx: -1, ny: 0 },
  ceiling: { nx: 0, ny: 1 },
  floor: { nx: 0, ny: -1 },
};

/** The result of a contact solution: exit velocity (px/s) and normal/tangential components, the latter two are used by the caller to determine stationary. */
export interface ContactResult {
  readonly vx: number;
  readonly vy: number;
  /** Outgoing normal velocity (px/s, ≥ 0, outward along the normal direction). */
  readonly normalSpeed: number;
  /** Outgoing tangential velocity (px/s, signed, along the tangential direction). */
  readonly tangentSpeed: number;
}

/**
 * Find the velocity after a contact: the normal direction rebounds according to the recovery coefficient, and when it
 * is lower than the threshold, it sticks to zero; the tangential direction only attenuates according to friction.
 *
 * @param speed - Velocity after impact (px/s), the normal component is determined by the contact surface, which does
 * not need to be vertical or horizontal.
 * @param edge - The edge hit.
 * @param physics - Coefficient of restitution and tangential friction.
 * @param dt - The duration of this step (s), according to which the attenuation is converted by friction.
 * @returns exit velocity; normal/tangential components provide {@link isRestingOnContacts} to determine stationary.
 */
export const resolveContact = (
  speed: { readonly vx: number; readonly vy: number },
  edge: ContactEdge,
  physics: PhysicsParams,
  dt: number,
): ContactResult => {
  const { nx, ny } = CONTACT_NORMALS[edge];
  const tx = -ny;
  const ty = nx;
  const vn = speed.vx * nx + speed.vy * ny;
  const vt = speed.vx * tx + speed.vy * ty;
  // If the normal velocity is lower than the threshold, it will be reset to zero: otherwise, when gravity continues to press on the same surface, it will be bounced back every frame, which will appear as veneer jitter.
  const normalSpeed = Math.abs(vn) < REST_NORMAL ? 0 : Math.abs(vn) * physics.restitution;
  // The tangential direction only attenuates and does not change direction: when it hits the wall, it is vy, and when it hits the ground or hits the top, it is vx.
  const tangentSpeed = vt * Math.max(0, 1 - physics.groundFriction * dt);
  return {
    vx: normalSpeed * nx + tangentSpeed * tx,
    vy: normalSpeed * ny + tangentSpeed * ty,
    normalSpeed,
    tangentSpeed,
  };
};

/**
 * Whether the contacts at this step are all stationary: the normal velocity of each contact surface ≈ 0 and the
 * tangential velocity is lower than the threshold.
 *
 * @param edges - The edges touched in this step; an empty array means no faces were touched.
 * @param speed - Find the speed after contact (px/s).
 * @returns When all contact surfaces are in contact and the tangential speed is low, it is `true` .
 */
export const isRestingOnContacts = (
  edges: readonly ContactEdge[],
  speed: { readonly vx: number; readonly vy: number },
): boolean => {
  if (edges.length === 0) return false;
  return edges.every((edge) => {
    const { nx, ny } = CONTACT_NORMALS[edge];
    const normal = Math.abs(speed.vx * nx + speed.vy * ny);
    const tangent = Math.abs(speed.vx * -ny + speed.vy * nx);
    return normal < REST_NORMAL_EPS && tangent < REST_TANGENT;
  });
};
