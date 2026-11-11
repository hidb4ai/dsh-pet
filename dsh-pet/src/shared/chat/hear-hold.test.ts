/**
 * Single test of the "press and hold" state machine: recording is only started once when pressed, and the automatic
 * repeat during the press and hold must be eaten and released before cleanup.
 *
 * Why it’s worth nailing: These mistakes are not errors, but silent deviations - repeated event omissions will fill a
 * string of v into the input box, and loosening omissions will cause the recording to continue to the 24-second limit.
 * Both of them can only be seen through testing if they "feel wrong" on a real machine.
 *
 * Use Node to build test runner (node:test) without introducing any npm dependencies.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { createHearHold, isHearHotkey } from './hear-hold.ts';
import type { HotkeyEvent } from '../hotkey.ts';

/** Only create the fields used in the criterion, no real KeyboardEvent is required. */
const ev = (over: Partial<HotkeyEvent & { repeat: boolean }> = {}): HotkeyEvent & { repeat?: boolean } => ({
  key: 'm',
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  target: null,
  repeat: false,
  ...over,
});

/** Create a fake element with tagName. */
const tag = (tagName: string, editable = false): EventTarget =>
  ({ tagName, isContentEditable: editable }) as unknown as EventTarget;

/** A state machine that records the number of times; armed can be changed midway to simulate the cursor leaving the pet. */
function harness(): {
  hold: ReturnType<typeof createHearHold>;
  counts: { press: number; release: number };
  arm: (next: boolean) => void;
} {
  const counts = { press: 0, release: 0 };
  let armed = true;
  const hold = createHearHold({
    isArmed: () => armed,
    onPress: () => {
      counts.press += 1;
    },
    onRelease: () => {
      counts.release += 1;
    },
  });
  return { hold, counts, arm: (next) => (armed = next) };
}

describe('isHearHotkey', () => {
  test('Both lowercase and uppercase M count', () => {
    assert.equal(isHearHotkey(ev({ key: 'm' })), true);
    assert.equal(isHearHotkey(ev({ key: 'M' })), true);
  });

  test('Other keys are not counted (the original V has given way)', () => {
    for (const key of ['v', 't', 'd', 's', 'a', 'Enter', ' ', 'Escape']) {
      assert.equal(isHearHotkey(ev({ key })), false, key);
    }
  });

  test('Modifier keys are not counted (Ctrl + M, etc. are left to the browser)', () => {
    assert.equal(isHearHotkey(ev({ ctrlKey: true })), false);
    assert.equal(isHearHotkey(ev({ metaKey: true })), false);
    assert.equal(isHearHotkey(ev({ altKey: true })), false);
  });

  test('The focus is on the editable element: not counted, leave m to the input box', () => {
    for (const target of [tag('INPUT'), tag('TEXTAREA'), tag('SELECT'), tag('DIV', true)]) {
      assert.equal(isHearHotkey(ev({ target })), false);
    }
  });
});

describe('createHearHold', () => {
  test('Press while hovering: eat the event and start recording once', () => {
    const { hold, counts } = harness();
    assert.equal(hold.onKeyDown(ev()), true, 'The pressed V must be eaten, otherwise a v will be played');
    assert.equal(counts.press, 1);
  });

  test('The cursor is not on the pet: the event is not triggered and the event is not eaten.', () => {
    const { hold, counts, arm } = harness();
    arm(false);
    assert.equal(hold.onKeyDown(ev()), false);
    assert.equal(counts.press, 0);
  });

  test('Other keys and modified keys are not affected.', () => {
    const { hold, counts } = harness();
    assert.equal(hold.onKeyDown(ev({ key: 'a' })), false);
    assert.equal(hold.onKeyDown(ev({ ctrlKey: true })), false);
    assert.equal(counts.press, 0);
  });

  test('When the cursor is pressed in the input box: recording will not start and events will not be received.', () => {
    const { hold, counts } = harness();
    assert.equal(hold.onKeyDown(ev({ target: tag('TEXTAREA') })), false, 'm needs to be entered into the input box');
    assert.equal(counts.press, 0);
  });

  test('All the automatic repeats during the press and hold period will be eaten, but the recording will not be repeated.', () => {
    const { hold, counts } = harness();
    hold.onKeyDown(ev());
    for (let i = 0; i < 5; i++) assert.equal(hold.onKeyDown(ev({ repeat: true })), true, `${i} repeat`);
    assert.equal(counts.press, 1);
  });

  test('The focus has entered the input box while pressing: repeated events will still be eaten (otherwise v will be poured into the box)', () => {
    const { hold } = harness();
    hold.onKeyDown(ev());
    assert.equal(hold.onKeyDown(ev({ repeat: true, target: tag('TEXTAREA') })), true);
    assert.equal(hold.onKeyDown(ev({ target: tag('TEXTAREA') })), true);
  });

  test('Press another key while holding down: ignore it', () => {
    const { hold, counts } = harness();
    hold.onKeyDown(ev());
    assert.equal(hold.onKeyDown(ev({ key: 'a', repeat: true })), false);
    assert.equal(counts.release, 0);
  });

  test('Release the same key to cleanup, and only collect it once', () => {
    const { hold, counts } = harness();
    hold.onKeyDown(ev());
    hold.onKeyUp(ev({ key: 'M' }));
    assert.equal(counts.release, 1);
    hold.onKeyUp(ev({ key: 'm' }));
    assert.equal(counts.release, 1, 'The extra keyup should not be finished again');
  });

  test('Cleanup does not work when releasing other keys', () => {
    const { hold, counts } = harness();
    hold.onKeyDown(ev());
    hold.onKeyUp(ev({ key: 'a' }));
    assert.equal(counts.release, 0);
  });

  test('Release when not holding: Do nothing', () => {
    const { hold, counts } = harness();
    hold.onKeyUp(ev());
    assert.equal(counts.release, 0);
  });

  test('release() forced cleanup (take this step when the window is out of focus and cannot receive keyup)', () => {
    const { hold, counts } = harness();
    hold.onKeyDown(ev());
    hold.release();
    assert.equal(counts.release, 1);
    hold.release();
    assert.equal(counts.release, 1, 'release must be idempotent');
  });

  test('You can press and hold it again after releasing it.', () => {
    const { hold, counts } = harness();
    hold.onKeyDown(ev());
    hold.onKeyUp(ev());
    hold.onKeyDown(ev());
    assert.equal(counts.press, 2);
    assert.equal(counts.release, 1);
  });

  test('The first time it is repeated automatically (no real press): does not start', () => {
    const { hold, counts } = harness();
    assert.equal(hold.onKeyDown(ev({ repeat: true })), false);
    assert.equal(counts.press, 0);
  });
});
