/**
 * bubble collapses the behavior contract of the state machine (src/shared/bubble-hold.ts).
 *
 * Covers suspension, cleanup, the late last sentence and the ignored branch when not lit, as well as the translation
 * of voice events to these two steps; the timer itself is accepted by both ends.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  BUBBLE_HOLD_IDLE,
  BUBBLE_HOLD_MAX_MS,
  BUBBLE_HOLD_TAIL_MS,
  reduceBubbleHold,
  utteranceToHold,
  type BubbleHoldEvent,
  type BubbleHoldState,
} from './bubble-hold.ts';

/** The lit state, used as the starting point for most use cases. */
function shown(durationMs = 10_000): BubbleHoldState {
  return reduceBubbleHold(BUBBLE_HOLD_IDLE, { durationMs, kind: 'show' });
}

describe('reduceBubbleHold——Light up and put away', () => {
  test('show: Light up and time according to the given duration', () => {
    assert.deepEqual(shown(), { delayMs: 10_000, holdSeq: null, on: true });
  });

  test('The duration of show is invalid: clipped to 0 instead of a negative number', () => {
    assert.equal(shown(-5).delayMs, 0);
  });

  test('hide: Click to close and stop timing.', () => {
    assert.equal(reduceBubbleHold(shown(), { kind: 'hide' }), BUBBLE_HOLD_IDLE);
  });

  test('hide for the unlit state: return the same reference as is', () => {
    assert.equal(reduceBubbleHold(BUBBLE_HOLD_IDLE, { kind: 'hide' }), BUBBLE_HOLD_IDLE);
  });

  test('clear: No matter what you were waiting for before, always return to the initial value', () => {
    const held = reduceBubbleHold(shown(), { kind: 'hold', seq: 1 });
    assert.equal(reduceBubbleHold(held, { kind: 'clear' }), BUBBLE_HOLD_IDLE);
  });
});

describe('reduceBubbleHold —— Suspend and cleanup following voice', () => {
  test('hold: Suspend timing, change the upper limit of waiting', () => {
    assert.deepEqual(reduceBubbleHold(shown(), { kind: 'hold', seq: 1 }), {
      delayMs: BUBBLE_HOLD_MAX_MS,
      holdSeq: 1,
      on: true,
    });
  });

  test('hold: Repeated notifications in the same sentence do not reset the upper limit', () => {
    const held = reduceBubbleHold(shown(), { kind: 'hold', seq: 1 });
    assert.equal(reduceBubbleHold(held, { kind: 'hold', seq: 1 }), held);
  });

  test('release: After this sentence is broadcast, change it to leave a tail', () => {
    const held = reduceBubbleHold(shown(), { kind: 'hold', seq: 1 });
    assert.deepEqual(reduceBubbleHold(held, { kind: 'release', seq: 1 }), {
      delayMs: BUBBLE_HOLD_TAIL_MS,
      holdSeq: null,
      on: true,
    });
  });

  test('release: The late cleanup in the previous sentence (serial number does not match) does not take effect', () => {
    const held = reduceBubbleHold(shown(), { kind: 'hold', seq: 2 });
    assert.equal(reduceBubbleHold(held, { kind: 'release', seq: 1 }), held);
  });

  test('hold / release when not lit: Ignore, never light the bubble out of thin air', () => {
    assert.equal(reduceBubbleHold(BUBBLE_HOLD_IDLE, { kind: 'hold', seq: 1 }), BUBBLE_HOLD_IDLE);
    assert.equal(reduceBubbleHold(BUBBLE_HOLD_IDLE, { kind: 'release', seq: 1 }), BUBBLE_HOLD_IDLE);
  });

  test('show will clear the suspension of the previous sentence: the new bubble will be timed according to its own duration again.', () => {
    const held = reduceBubbleHold(shown(), { kind: 'hold', seq: 1 });
    assert.deepEqual(reduceBubbleHold(held, { durationMs: 3_000, kind: 'show' }), {
      delayMs: 3_000,
      holdSeq: null,
      on: true,
    });
  });
});

describe('utteranceToHold——Voice event translation plan', () => {
  test('Start: translated into hold, the bubble duration is extended from the default to the upper limit', () => {
    const hold = utteranceToHold({ kind: 'start', seq: 7, text: '一句要念很久的话' });
    assert.deepEqual(
      hold,
      { kind: 'hold', seq: 7 },
      'start must fall to hold, otherwise the bubble will still be the default duration of show',
    );
    assert.deepEqual(reduceBubbleHold(shown(), hold), {
      delayMs: BUBBLE_HOLD_MAX_MS,
      holdSeq: 7,
      on: true,
    });
  });

  test('End: Translate it into release, and leave a tail when the same sentence is continued.', () => {
    const started = utteranceToHold({ kind: 'start', seq: 7, text: '一句要念很久的话' });
    const ended = utteranceToHold({ kind: 'end', seq: 7, text: '一句要念很久的话' });
    assert.deepEqual(ended, { kind: 'release', seq: 7 });
    assert.deepEqual(reduceBubbleHold(reduceBubbleHold(shown(), started), ended), {
      delayMs: BUBBLE_HOLD_TAIL_MS,
      holdSeq: null,
      on: true,
    });
  });

  test('Voice events are directly fed to the state machine without translation: it does not take effect, and the bubble is still the default duration.', () => {
    // The desktop client once passed in start/end as it is, and both sentences fell on this branch, so the bubble was closed according to the duration of show.
    const raw = { kind: 'start', seq: 7 } as unknown as BubbleHoldEvent;
    const before = shown();
    assert.equal(
      reduceBubbleHold(before, raw),
      before,
      'Unrecognizable kind must be returned as is to expose "missing translation"',
    );
  });
});
