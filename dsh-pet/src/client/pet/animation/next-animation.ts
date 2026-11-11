/**
 * The decision of "next self-broadcast animation": fold the dice roll results and movement attempts into "which
 * animation to cut and what category to count in the log". Just decide what to do, no ref, no setState - the caller is
 * responsible for actually cutting the animation and advancing the generation number. The caller will try to move the
 * position first: if it is occupied, do not replay it, and if it cannot move, return to the original position.
 * @module dsh-pet/src/client/pet/animation/next-animation
 */
import { pick, pickCategoryAction, type RollKind } from '../../../shared/pickers.ts';
import type { Animations } from '../../../shared/types.ts';

/** The decision result of a self-broadcast. */
export interface NextAnimation {
  /** Categories for logging and debugging: `IDLE` / `TURN` / `MOVES` or id for classification actions. */
  kind: string;
  /** The name of the animation to be cut; when the position is occupied, it is `null`. */
  anim: string | null;
  /** Do you really want `setAnim`: The moving position will not be switched - the moving position has already been switched. If you switch it again, you will restart the run and change the source, interrupting that step. */
  play: boolean;
}

/** Decision input. */
export interface NextAnimationInput {
  /** The category obtained by rolling the dice. */
  kind: RollKind;
  /** The animation pool for this pet. */
  animations: Animations;
  /** Orientation: The classification action where the mirror image will be reversed should be skipped when facing = right. */
  facing: 'left' | 'right';
  /** The name of the animation currently being played is used for "Don't draw yourself continuously". */
  current: string;
  /** The result of the movement attempt is only meaningful when `kind === 'move'`: action name = successful, `true` = occupied, `false` = unable to move. */
  move?: string | true | false;
}

/**
 * Determine the next self-broadcast animation.
 *
 * @param input - Roll category, animation pool and positioning results.
 * @returns category, the name of the animation to be cut, and "whether it needs to be cut this time."
 */
export function decideNextAnimation(input: NextAnimationInput): NextAnimation {
  const { kind, animations, facing, current, move } = input;
  if (kind === 'idle') return { kind: 'IDLE', anim: pick(animations.idle, current), play: true };
  if (kind === 'turn') return { kind: 'TURN', anim: pick(animations.turn, current), play: true };
  if (kind === 'move' && move !== false && move !== undefined) {
    // Occupied (true) is not replayed; success means the action name has been cut for that move, only used for logs.
    return { kind: 'MOVES', anim: typeof move === 'string' ? move : null, play: false };
  }
  const action = pickCategoryAction(animations.categories, animations.idle, facing, current);
  return { kind: action.id, anim: action.name, play: true };
}
