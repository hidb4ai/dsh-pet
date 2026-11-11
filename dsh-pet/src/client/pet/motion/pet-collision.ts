/**
 * Settlement of pets colliding with each other: elastically separate yourself from the one you collided with in the
 * station every frame.
 *
 * I am not responsible for points, gravity and DOM writing. I only answer "Where should I be and what speed should I
 * be after settlement?" Invariant: The speed is calculated once, both sides write absolute speeds, and never
 * superimpose incrementally - the overlap will last for several frames. Superposition will cause the same pair of
 * collisions to repeatedly inject momentum every frame, and the speed will increase exponentially by frame.
 * @module dsh-pet/src/client/pet/motion/pet-collision
 */
import {
  bodyPixelBox,
  collidePet,
  overlapPush,
  rectsOverlap,
  type PetCollisionSlot,
  type ThrowState,
} from '../../../shared/physics.ts';

/** Current frame geometry required for settlement. */
export interface CollisionMetrics {
  /** Pet width ( px , mass ∝ size² ). */
  size: number;
  /** The stage foot is raised: the body frame moves up according to it. */
  bottomPad: number;
}

/** Settlement dependency. */
export interface PetCollisionDeps {
  /** Collision site. */
  arena(): { slots: Record<string, PetCollisionSlot> };
  /** This pet id: jumps over itself. */
  petId: string;
  /** Colliding into other pets: The input parameter is the normal relative velocity (px/s), which is used to convert the intensity of tactile feedback. */
  onPetImpact(speed: number): void;
}

/** Settlement function: The input parameter is the state after integration in this frame, and the state after settlement is returned. */
export type PetCollisionResolver = (state: ThrowState, metrics: CollisionMetrics) => ThrowState;

/**
 * Push the overlap away: {@link overlapPush} What is given is "each gives half", here is the whole paragraph - if the
 * opponent is also running, it will push again from its own side in the next frame, and push once on each side to
 * separate them.
 *
 * @param state - Current status.
 * @param push - half displacement; `null` = no overlap.
 * @returns The state after pushing away (the speed does not change).
 */
const separate = (state: ThrowState, push: { dx: number; dy: number } | null): ThrowState =>
  push === null ? state : { ...state, x: state.x + push.dx * 2, y: state.y + push.dy * 2 };

/**
 * Build a collision settler.
 *
 * @param deps - station, self id and impact callback.
 * @returns The settlement function can settle at most one pair in one frame; if there is no collision, the input
 * parameters will be returned as they are.
 */
export function createPetCollision(deps: PetCollisionDeps): PetCollisionResolver {
  return (state, metrics) => {
    const slots = deps.arena().slots;
    const myBody = bodyPixelBox({ x: state.x, y: state.y, size: metrics.size, bottomPad: metrics.bottomPad });
    for (const slotId of Object.keys(slots)) {
      if (slotId === deps.petId) continue;
      const slot = slots[slotId];
      const otherBox = slot.getBox();
      if (!otherBox) continue;
      const otherBody = bodyPixelBox({ x: otherBox.x, y: otherBox.y, size: slot.size, bottomPad: slot.bottomPad });
      if (!rectsOverlap(myBody, otherBody)) continue;
      const separated = separate(state, overlapPush(myBody, otherBody));
      const vel = slot.getVel();
      const hit = collidePet(
        { x: state.x, y: state.y, vx: state.vx, vy: state.vy, size: metrics.size },
        { x: otherBox.x, y: otherBox.y, vx: vel.vx, vy: vel.vy, size: slot.size },
      );
      // When separating (those frames after overlapping), only the position is pushed and the speed is not changed. Otherwise, the same pair of collisions will be repeatedly injected with momentum.
      if (hit === null) return separated;
      deps.onPetImpact(hit.impactSpeed);
      slot.applyVelocity(hit.hvx, hit.hvy);
      return { ...separated, vx: hit.fvx, vy: hit.fvy };
    }
    return state;
  };
}
