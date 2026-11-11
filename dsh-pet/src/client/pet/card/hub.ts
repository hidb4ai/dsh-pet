/**
 * Shared runtime of pet cards: state container, value surface of each driver and cross-concern action. Only declare
 * the contract, do not construct the implementation - the assembly root is spelled out with the frame closure, and all
 * are taken as getter to prevent the driver from reading the old value. Depends on card state, animation chain, bubble
 * single slot and three motion drivers. Invariant: rebind for each rendering; the consumer must not cache the entire
 * hub and can only get the value at the call point.
 * @module dsh-pet/src/client/pet/card/hub
 */
import type { CardStateApi } from './state.ts';
import type { OwnAnimation } from '../animation/animation.ts';
import type { BubbleSlots } from './bubble-slots.ts';
import type { PositionFollow } from '../motion/position-follow.ts';
import type { Animations } from '../../../shared/types.ts';
import type { RuntimePet } from '../types.ts';

/** Based on the name playback request: the same set of semantics as the right-click menu (text types are forced to move to the left, and mobile types will move). */
export type PlayByName = (anim: string, playbackId?: string, keepFacing?: boolean) => void;

/** One word: Choose between text and pictures, and use the bubble default value for the duration. */
export type Speak = (text: string, image?: string, url?: string, duration?: number, anim?: boolean) => void;

/** Card runtime: the one shared across concerns. */
export interface CardHub {
  /** Latest value of resolved configuration. */
  cfg(): RuntimePet;
  /** The animation pool of this pet (same origin as `cfg().animations`, taken out separately to avoid deep retrieval each time). */
  anims(): Animations;
  /** Card status and writing entry point. */
  card: CardStateApi;
  /** Animation chain: source changing, freezing, and receipt are all here. */
  ownAnim: OwnAnimation;
  /** Single slot for three bubbles. */
  bubbles: BubbleSlots;
  /** Position following spring. */
  posFollow: PositionFollow;
  /** Is the pointer pressed (to avoid throwing instructions). */
  isDragging(): boolean;
  /** Stop-and-go position and position following. */
  stopMotion(): void;
  /** Throwing command: angle (degree, 0 is right, counterclockwise is positive) and force multiplier. */
  applyThrow(angleDeg: number, power: number): void;
  /** Try to initiate an autonomous movement: true is returned when occupied, false is returned when unable to move, and the action name is returned successfully. */
  tryWalk(): boolean | string;
  /** Based on name playback request. */
  playByName: PlayByName;
  /** Say something. */
  speak: Speak;
  /** Whether you are sleeping at the moment (including the two transitions of falling asleep/waking up): the automatic source will shut up accordingly, and explicitly wake up to go to the menu or click. */
  sleeping(): boolean;
  /** Is it frozen by the occupied lock at this moment: The semantics of the lock is "giving control to a third party", and the sleeping gate gives way to it. */
  locked(): boolean;
}
