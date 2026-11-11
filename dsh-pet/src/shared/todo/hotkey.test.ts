/**
 * The hover shortcut key (src/shared/todo/hotkey.ts) of the to-do panel: only the naked pressed D is recognized.
 *
 * The general rules of key pressing are verified by shared/hotkey's test. Here only the "which key" is tested.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { TODO_HOTKEY_HINT, isTodoHotkey } from './hotkey.ts';
import type { HotkeyEvent } from '../hotkey.ts';

/** A minimal keyboard event double. */
function ev(over: Partial<HotkeyEvent> = {}): HotkeyEvent {
  return { key: 'd', ctrlKey: false, metaKey: false, altKey: false, target: null, ...over };
}

describe('isTodoHotkey —— Press D to switch the panel', () => {
  test('d and D both count', () => {
    assert.equal(isTodoHotkey(ev({ key: 'd' })), true);
    assert.equal(isTodoHotkey(ev({ key: 'D' })), true);
  });

  test('Dialogue T does not count', () => {
    assert.equal(isTodoHotkey(ev({ key: 't' })), false);
  });

  test('Modifier keys are not counted', () => {
    assert.equal(isTodoHotkey(ev({ ctrlKey: true })), false);
    assert.equal(isTodoHotkey(ev({ altKey: true })), false);
  });

  test('Typing in the input box does not count', () => {
    const input = { tagName: 'INPUT' } as unknown as EventTarget;
    assert.equal(isTodoHotkey(ev({ target: input })), false);
  });

  test('The menu prompt and button refer to the same key', () => {
    assert.ok(
      TODO_HOTKEY_HINT.startsWith('D'),
      `The prompt should state D, but the actual value is ${TODO_HOTKEY_HINT}`,
    );
  });
});
