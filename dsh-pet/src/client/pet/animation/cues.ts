/**
 * The two judgment results of the animation chain and the pure decision of "what to do after the broadcast is
 * completed".
 *
 * Only answer "Which branch should I enter after this segment is played?", without touching DOM, not reading the
 * clock, and not reporting the receipt - the receipt and pause validation check are processed by the animation chain,
 * and the React status is changed by the component according to the result.
 * @module dsh-pet/src/client/pet/animation/cues
 */
import { isEventAnim, nextWorkStatusAnim, poolIncludes } from '../../../shared/pickers.ts';
import type { Animations } from '../../../shared/types.ts';

/** What to do after broadcasting. */
export type EndedCue =
  | { kind: 'ignore' }
  | { kind: 'work-rotate'; anim: string }
  | { kind: 'work-replay' }
  | { kind: 'event-done' }
  | { kind: 'turn' }
  | { kind: 'interaction-done' }
  | { kind: 'random' };

/** Frozen state flipped. */
export type FreezeCue = { kind: 'frozen' } | { kind: 'resumed' };

/** Input of playback completion judgment. */
export interface EndedInput {
  /** The animation pool for this pet. */
  animations: Animations;
  /** The name of the animation that just ended. */
  current: string;
  /** Current working status; `undefined` means it has not been received yet. */
  workState: string | null | undefined;
}

/** Is the working status in a "non-final state": the stall animation will not be continued in the final state (success / error) or idle. */
const isWorkActive = (state: string | null | undefined): boolean =>
  state !== null && state !== undefined && state !== 'success' && state !== 'error';

/**
 * Decide which branch to enter after broadcasting.
 *
 * @param input - Animation pool, animation just finished and current working status.
 * @returns branch determination; dragging and freezing are blocked by the caller at the front.
 */
export function decideEndedCue(input: EndedInput): EndedCue {
  const { animations, current, workState } = input;
  const isEvent = isEventAnim(animations.events, current);
  if (isEvent && isWorkActive(workState)) {
    // After the multi-candidate slot is played, it is rotated to the next candidate, and the long-term status does not repeat in a single segment.
    const nextWork = nextWorkStatusAnim(animations.events?.workStatus ?? [], current);
    if (nextWork !== null) return { kind: 'work-rotate', anim: nextWork };
    // The same segment is resumed when the single candidate position is unexpectedly ended.
    if (poolIncludes(animations.events?.workStatus ?? [], current)) return { kind: 'work-replay' };
  }
  if (isEvent) return { kind: 'event-done' };
  if (animations.turn.includes(current)) return { kind: 'turn' };
  if (animations.drag.includes(current) || animations.clicks.includes(current)) return { kind: 'interaction-done' };
  return { kind: 'random' };
}
