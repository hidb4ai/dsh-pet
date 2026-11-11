/**
 * Late binding slot of card assembly root: animation chain, motion driver and floating layer action are created
 * sequentially, but they need to take values from each other. Only fill in card-runtime; consumers read it in the
 * callback after rendering, but not during rendering. Not responsible for the state: here are all driver instances and
 * call entry points, and the responsive state belongs to card-state.
 * @module dsh-pet/src/client/pet/card/live
 */
import type { OwnAnimation } from '../animation/animation.ts';
import type { AnimationFlow } from './animation-flow.ts';
import type { Drag } from '../motion/drag.ts';
import type { Flight } from '../motion/flight.ts';
import type { PositionFollow } from '../motion/position-follow.ts';
import type { SquashDriver } from '../motion/squash.ts';
import type { Walk } from '../motion/walk.ts';

/** Assembling root-bound drivers and services: the party created first is called back by the party created later. */
export interface CardLive {
  /** Animation chain: Created before the motion driver, the callback needs to read the movement, dragging and squeezing. */
  ownAnim: OwnAnimation;
  /** Movement. */
  walk: Walk;
  /** Throwing flight. */
  flight: Flight;
  /** Position following. */
  posFollow: PositionFollow;
  /** Pointer dragging. */
  drag: Drag;
  /** Q elastic extrusion. */
  squash: SquashDriver;
  /** Animation flow: Created after command processing, dragging and local unfreezing need to restore states through it. */
  flow: AnimationFlow | null;
  /** Viewport coordinates of the current pet center (including corner fallback). */
  center: () => { x: number; y: number };
  /** Stop-and-go position and position following. */
  stopMove: () => void;
  /** Place the hover tip next to the cursor. */
  placeTip: (x: number, y: number) => void;
  /** Whether the floating prompt is currently lit. */
  tipOn: () => boolean;
  /** Local unfreeze and release host lock. */
  releaseLock: () => void;
}
