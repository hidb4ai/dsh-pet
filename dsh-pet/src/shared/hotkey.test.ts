/**
 * General criteria for hovering shortcut keys (src/shared/hotkey.ts): press a certain key naked and do not grab typing
 * in the input box.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { isBareKey, isTypingTarget, type HotkeyEvent } from './hotkey.ts';

/** A minimal keyboard event double: criteria read-only key, modifier keys and target. */
function ev(over: Partial<HotkeyEvent> = {}): HotkeyEvent {
  return { key: 'd', ctrlKey: false, metaKey: false, altKey: false, target: null, ...over };
}

/** Create a fake element with only tagName. */
function tag(name: string): EventTarget {
  return { tagName: name } as unknown as EventTarget;
}

describe('isBareKey - Only recognize single keys without modifier keys', () => {
  test('Both uppercase and lowercase are counted: d and D both match lowercase d', () => {
    assert.equal(isBareKey(ev({ key: 'd' }), 'd'), true, 'Lowercase should match');
    assert.equal(isBareKey(ev({ key: 'D' }), 'd'), true, 'Uppercase should match');
  });

  test('Other keys do not count', () => {
    assert.equal(isBareKey(ev({ key: 't' }), 'd'), false);
    assert.equal(isBareKey(ev({ key: 'ArrowDown' }), 'd'), false);
  });

  test('Anything with Ctrl / Meta / Alt will not be counted: it is the shortcut key of the browser or host', () => {
    assert.equal(isBareKey(ev({ ctrlKey: true }), 'd'), false);
    assert.equal(isBareKey(ev({ metaKey: true }), 'd'), false);
    assert.equal(isBareKey(ev({ altKey: true }), 'd'), false);
  });

  test('Focus is not counted in the input box: that is typing', () => {
    assert.equal(isBareKey(ev({ target: tag('INPUT') }), 'd'), false);
    assert.equal(isBareKey(ev({ target: tag('TEXTAREA') }), 'd'), false);
    assert.equal(isBareKey(ev({ target: tag('SELECT') }), 'd'), false);
  });

  test('Focus is calculated on ordinary elements', () => {
    assert.equal(isBareKey(ev({ target: tag('DIV') }), 'd'), true);
    assert.equal(isBareKey(ev(), 'd'), true, 'target should also be counted as null');
  });
});

describe('isTypingTarget - The keys in these places are for typing', () => {
  test('Input class element with contenteditable', () => {
    assert.equal(isTypingTarget(tag('INPUT')), true);
    assert.equal(isTypingTarget({ tagName: 'DIV', isContentEditable: true } as unknown as EventTarget), true);
  });

  test('Normal elements and empty targets', () => {
    assert.equal(isTypingTarget(tag('DIV')), false);
    assert.equal(isTypingTarget(null), false);
  });
});
