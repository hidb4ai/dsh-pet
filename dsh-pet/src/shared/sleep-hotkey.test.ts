/**
 * Criterion test for the sleep shortcut key (Z): verify "switch when pressed naked, no grabbing in the input box" and
 * "the copy and the key are the same fact". Running method: node --experimental-strip-types --test
 * src/shared/sleep-hotkey.test.ts
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { SLEEP_HOTKEY_HINT, isSleepHotkey } from './sleep-hotkey.ts';
import type { HotkeyEvent } from './hotkey.ts';

/** Only create the fields used in the criterion, no real KeyboardEvent is required. */
const ev = (over: Partial<HotkeyEvent> = {}): HotkeyEvent => ({
  key: 'z',
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  target: null,
  ...over,
});

/** Create an editable focus target (tagName is enough to determine typing). */
const input = (isContentEditable = false): EventTarget =>
  ({ tagName: 'INPUT', isContentEditable }) as unknown as EventTarget;

describe('isSleepHotkey —— Press Z to switch', () => {
  test('Both lowercase and uppercase are recognized (Caps Lock should not disable the shortcut keys)', () => {
    assert.equal(isSleepHotkey(ev({ key: 'z' })), true);
    assert.equal(isSleepHotkey(ev({ key: 'Z' })), true);
  });

  test('Key combinations with Ctrl / Meta / Alt are not available.', () => {
    assert.equal(isSleepHotkey(ev({ ctrlKey: true })), false);
    assert.equal(isSleepHotkey(ev({ metaKey: true })), false);
    assert.equal(isSleepHotkey(ev({ altKey: true })), false);
  });

  test('The focus is not grabbed when the focus is in the input box / contenteditable (that is typing)', () => {
    assert.equal(isSleepHotkey(ev({ target: input() })), false);
    assert.equal(isSleepHotkey(ev({ target: input(true) })), false);
  });

  test('Other keys are not hit, S has been given to the screenshot', () => {
    assert.equal(isSleepHotkey(ev({ key: 'd' })), false);
    assert.equal(isSleepHotkey(ev({ key: 's' })), false);
  });

  test('The fact that menu copy and button are the same', () => {
    assert.equal(SLEEP_HOTKEY_HINT, 'Z 键');
  });
});
