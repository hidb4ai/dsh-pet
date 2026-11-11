/**
 * Criteria for displaying position numeric keys: `1` - `4` are in the same order as the right-click menu, do not grab
 * in the input box, and do not grab modifier keys.
 *
 * The order is worth nailing: the numeric keys and menu items share {@link DISPLAY_ORDER} . Anyone who changes the
 * order will cause silent misalignments such as "press 3 to become desktop only", and the scene will only be regarded
 * as "the keys are tied wrong".
 *
 * Running method: node --experimental-strip-types --test src/shared/display-hotkey.test.ts
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { DISPLAY_HOTKEY_HINTS, DISPLAY_ORDER, displayOfHotkey } from './display-hotkey.ts';
import type { HotkeyEvent } from './hotkey.ts';

/** Only create the fields used in the criterion, no real KeyboardEvent is required. */
const ev = (over: Partial<HotkeyEvent> = {}): HotkeyEvent => ({
  key: '1',
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  target: null,
  ...over,
});

/** Create a fake element with tagName. */
const tag = (tagName: string, editable = false): EventTarget =>
  ({ tagName, isContentEditable: editable }) as unknown as EventTarget;

describe('displayOfHotkey——Number keys to display position', () => {
  test('1-4 correspond to web / desktop / both / none in sequence', () => {
    assert.deepEqual(
      ['1', '2', '3', '4'].map((key) => displayOfHotkey(ev({ key }))),
      ['web', 'desktop', 'both', 'none'],
    );
  });

  test('All other keys will not be recognized.', () => {
    for (const key of ['5', '0', 'l', 's', 'd', 'm', 'z', 'Enter', ' ']) {
      assert.equal(displayOfHotkey(ev({ key })), undefined, key);
    }
  });

  test('Key combinations with Ctrl / Meta / Alt are not available.', () => {
    assert.equal(displayOfHotkey(ev({ ctrlKey: true })), undefined);
    assert.equal(displayOfHotkey(ev({ metaKey: true })), undefined);
    assert.equal(displayOfHotkey(ev({ altKey: true })), undefined);
  });

  test('The focus is not grabbed when the focus is in the input box / contenteditable (that is typing)', () => {
    for (const target of [tag('INPUT'), tag('TEXTAREA'), tag('SELECT'), tag('DIV', true)]) {
      assert.equal(displayOfHotkey(ev({ target })), undefined);
    }
  });

  test('Keycap text and sequence have the same origin', () => {
    assert.deepEqual(DISPLAY_ORDER, ['web', 'desktop', 'both', 'none']);
    assert.deepEqual(DISPLAY_HOTKEY_HINTS, ['1 键', '2 键', '3 键', '4 键']);
  });
});
