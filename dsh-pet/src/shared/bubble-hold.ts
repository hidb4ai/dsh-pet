/**
 * The timing of closing the speech bubble: suspend the timing during synthesis, and leave a short tail after the
 * broadcast. Pure state machine: only gives "how many milliseconds to wait next time", and the timer and rendering are
 * held by both ends. Not sure whether this sentence should be pronounced or not - that's the validation check for
 * {@link module:dsh-pet/src/shared/voice} .
 * @module dsh-pet/src/shared/bubble-hold
 */
import type { VoiceUtteranceEvent } from './voice.ts';

/** Staying for so long after the broadcast is completed (or failed), so that people can read the last word (ms). */
export const BUBBLE_HOLD_TAIL_MS = 1_500;

/**
 * How long can the bubble be hung up to in one sentence (ms).
 *
 * The conventions are "synthesis timeout + the longest speech that can be pronounced after truncation + tail" and
 * leave a margin: exceeding it means that the speech line has been broken, and the bubble cannot die with it.
 */
export const BUBBLE_HOLD_MAX_MS = 50_000;

/** Collapse the planned event; `seq` is the broadcast sequence number, which is used to discard the late "previous sentence has been broadcast". */
export type BubbleHoldEvent =
  | { readonly kind: 'show'; readonly durationMs: number }
  | { readonly kind: 'hold'; readonly seq: number }
  | { readonly kind: 'release'; readonly seq: number }
  | { readonly kind: 'hide' }
  | { readonly kind: 'clear' };

/**
 * Convert the start/end of a broadcast into the suspension/cleanup of bubble.
 *
 * Both ends use this share: the subscriber gets `start` / `end` of voice, while the state machine only recognizes
 * `hold` / `release` . If you turn it less than once, it will fail silently - the event cannot reach `hold` , and the
 * bubble will be closed according to the length of `show` itself; the desktop side is pure JS, and there will be no
 * error of any type if the error shape is transmitted, so this link can only rely on sharing the same implementation
 * to ensure that both ends do not drift.
 *
 * @param event - The start or end event of the broadcast.
 * @returns corresponds to the collapsing planned event.
 */
export function utteranceToHold(event: VoiceUtteranceEvent): BubbleHoldEvent {
  return { kind: event.kind === 'start' ? 'hold' : 'release', seq: event.seq };
}

/** Timing status of bubble; `delayMs` is null, which means there is no automatic closing and waiting for the next event. */
export interface BubbleHoldState {
  readonly on: boolean;
  /** Waiting broadcast sequence number; null = Not waiting for voice. */
  readonly holdSeq: number | null;
  /** How long to wait for the next automatic folding (ms); null = No timer is designed. */
  readonly delayMs: number | null;
}

/** The initial value of the collapsed state; both ends start from here. */
export const BUBBLE_HOLD_IDLE: BubbleHoldState = { on: false, delayMs: null, holdSeq: null };

/**
 * Push one step further.
 *
 * When the bubble is not lit, `hold` and `release` are ignored: that means there is no bubble to hang in this sentence
 * (`duration: 0` or has been cleared), and letting them light up the bubble will create an extra bubble out of thin
 * air.
 *
 * @param state - Current status.
 * @param event - What happened this time.
 * @returns New state; returns the same reference when nothing happens, and the caller skips the reorder timer
 * accordingly.
 */
export function reduceBubbleHold(state: BubbleHoldState, event: BubbleHoldEvent): BubbleHoldState {
  if (event.kind === 'show') return { delayMs: Math.max(0, event.durationMs), holdSeq: null, on: true };
  if (event.kind === 'clear') return BUBBLE_HOLD_IDLE;
  if (event.kind === 'hide') return state.on ? BUBBLE_HOLD_IDLE : state;
  if (!state.on) return state;
  if (event.kind === 'hold') {
    if (state.holdSeq === event.seq) return state; // Duplicate notification with the same sentence: Do not reset the upper limit
    return { delayMs: BUBBLE_HOLD_MAX_MS, holdSeq: event.seq, on: true };
  }
  // release only recognizes the current sentence: the late cleanup in the previous sentence cannot end the wait in this sentence early.
  if (state.holdSeq !== event.seq) return state;
  return { delayMs: BUBBLE_HOLD_TAIL_MS, holdSeq: null, on: true };
}
