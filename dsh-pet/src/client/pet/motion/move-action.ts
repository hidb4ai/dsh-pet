/**
 * Planning for an autonomous movement: selecting actions, calculating direction and distance, and handing it over to
 * the `planMove` of the shared layer to determine reachability. The distance is scaled proportionally according to the
 * pet size (`minDist` / `maxDist` is the pixel under the base width). If it exceeds the boundary, `null` will be
 * returned to let the caller return to the original position. Pure planning: The occupancy determination (whether rAF
 * is running) remains in the caller because that is the ref state.
 * @module dsh-pet/src/client/pet/motion/move-action
 */
import { planMove, type MovePlan } from '../../../shared/motion.ts';
import { PET_REF_WIDTH } from '../../../shared/constants.ts';
import type { MovesConfig } from '../../../shared/types.ts';

/** A movement to be executed: geometric proportion + direction and blank space at the beginning and end (seconds). */
export interface PendingMove extends MovePlan {
  /** 1 = to the right, -1 = to the left. */
  dir: 1 | -1;
  /** How many seconds does the movement start without moving (foot kick). */
  leadSec: number;
  /** How many seconds before the end of the movement does it reach the position (retract the feet). */
  tailSec: number;
}

/** Planning input. */
export interface MoveActionInput {
  /** The moving pool of this pet. */
  moves: MovesConfig;
  /** The action name specified by the menu playback request; the default is random. */
  preferredName?: string;
  /** The current orientation determines the moving direction. */
  facing: 'left' | 'right';
  /** Pet width (px). */
  size: number;
  /** Current pet center (px). */
  center: { x: number; y: number };
  /** Viewport size ( px ). */
  viewport: { width: number; height: number };
  /** Half width of the box. */
  halfW: number;
  /** The left and right pixels (transparent edges) of the body relative to the video box. */
  sideAllow: number;
  /** Random source, default `Math.random`; injected for testing. */
  random?: () => number;
}

/** Planning result: `null` = No action available or the landing point is out of bounds. */
export interface MoveAction {
  /** The name of the movement action to be played. */
  anim: string;
  /** Position to be executed (consumed only when driven by rAF). */
  pending: PendingMove;
}

/**
 * Plan an autonomous movement.
 *
 * @param input - Position pool, orientation, size and viewport.
 * @returns action name and position to be executed; return `null` when unable to move.
 */
export function planMoveAction(input: MoveActionInput): MoveAction | null {
  const actions = input.moves.actions;
  if (actions.length === 0) return null;
  const random = input.random ?? Math.random;
  const chosen = input.preferredName
    ? (actions.find((action) => action.name === input.preferredName) ?? null)
    : actions[Math.floor(random() * actions.length)];
  if (!chosen) return null;
  const params = Object.assign({}, input.moves.default, chosen.params ?? {});
  // The walking direction only looks at the current facing; do not use the turn animation to reverse the direction.
  const dir: 1 | -1 = input.facing === 'right' ? 1 : -1;
  // The moving distance scales with the pet: px at the base size is enlarged according to size / PET_REF_WIDTH.
  const distScale = input.size / PET_REF_WIDTH;
  const plan = planMove({
    cx: input.center.x,
    cy: input.center.y,
    W: input.viewport.width,
    H: input.viewport.height,
    dir,
    minDist: params.minDist * distScale,
    maxDist: params.maxDist * distScale,
    margin: params.margin,
    halfW: input.halfW,
    sideAllow: input.sideAllow,
  });
  if (plan === null) return null;
  return { anim: chosen.name, pending: { ...plan, dir, leadSec: params.leadSec, tailSec: params.tailSec } };
}
