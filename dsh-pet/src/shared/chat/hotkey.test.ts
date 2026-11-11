/**
 * Single test of hover shortcut key criteria: `L` opens a conversation, `S` takes a screenshot.
 *
 * Why it is worth nailing: The shortcut key is hung on document. If the criterion is written loosely, letters will be
 * snatched away in the input box, resulting in "cannot type that letter"; if the criterion is written tightly,
 * everything will be ineffective. Several boundaries are nailed down here.
 *
 * Use Node to build test runner (node:test) without introducing any npm dependencies.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { CAPTURE_HOTKEY_HINT, isCaptureHotkey, isChatHotkey, isTypingTarget, type HotkeyEvent } from './hotkey.ts';

/** Only create the fields used in the criterion, no real KeyboardEvent is required. */
const ev = (over: Partial<HotkeyEvent> = {}): HotkeyEvent => ({
  key: 'l',
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  target: null,
  ...over,
});

/** Create a fake element with tagName. */
const tag = (tagName: string, editable = false): EventTarget =>
  ({ tagName, isContentEditable: editable }) as unknown as EventTarget;

describe('isChatHotkey', () => {
  test('Both lowercase and uppercase L count', () => {
    assert.equal(isChatHotkey(ev({ key: 'l' })), true);
    assert.equal(isChatHotkey(ev({ key: 'L' })), true);
  });

  test('Other keys are not counted (the original T has given way)', () => {
    for (const key of ['t', 'a', 'r', 'Enter', ' ', 'Escape']) {
      assert.equal(isChatHotkey(ev({ key })), false, key);
    }
  });

  test('Modifier keys are not counted (Ctrl + L, etc. are left to the browser)', () => {
    assert.equal(isChatHotkey(ev({ ctrlKey: true })), false);
    assert.equal(isChatHotkey(ev({ metaKey: true })), false);
    assert.equal(isChatHotkey(ev({ altKey: true })), false);
  });

  test('Focus does not count on editable elements', () => {
    for (const target of [tag('INPUT'), tag('TEXTAREA'), tag('SELECT'), tag('DIV', true)]) {
      assert.equal(isChatHotkey(ev({ target })), false);
    }
  });

  test('Focus is calculated when it is on an ordinary element or has no focus', () => {
    assert.equal(isChatHotkey(ev({ target: tag('DIV') })), true);
    assert.equal(isChatHotkey(ev()), true);
  });
});

describe('isCaptureHotkey', () => {
  test('Both lowercase and uppercase S count', () => {
    assert.equal(isCaptureHotkey(ev({ key: 's' })), true);
    assert.equal(isCaptureHotkey(ev({ key: 'S' })), true);
  });

  test('Neither the dialogue key nor the sleep key counts.', () => {
    for (const key of ['l', 'z', 'd', 'm', 'Enter']) {
      assert.equal(isCaptureHotkey(ev({ key })), false, key);
    }
  });

  test('Modified keys are not counted (Ctrl + Shift + S is a global command, not a hover key)', () => {
    assert.equal(isCaptureHotkey(ev({ key: 's', ctrlKey: true })), false);
    assert.equal(isCaptureHotkey(ev({ key: 's', metaKey: true })), false);
    assert.equal(isCaptureHotkey(ev({ key: 's', altKey: true })), false);
  });

  test('Focus does not count on editable elements', () => {
    assert.equal(isCaptureHotkey(ev({ key: 's', target: tag('TEXTAREA') })), false);
  });

  test('Text and keystrokes share the same fact', () => {
    assert.equal(CAPTURE_HOTKEY_HINT, 'S 键');
  });
});

describe('isTypingTarget', () => {
  test('Three types of form controls and contenteditable are regarded as typing', () => {
    assert.equal(isTypingTarget(tag('INPUT')), true);
    assert.equal(isTypingTarget(tag('TEXTAREA')), true);
    assert.equal(isTypingTarget(tag('SELECT')), true);
    assert.equal(isTypingTarget(tag('div', true)), true);
  });

  test('null and non-elements are treated as non-typing', () => {
    assert.equal(isTypingTarget(null), false);
    assert.equal(isTypingTarget({} as unknown as EventTarget), false);
  });
});
