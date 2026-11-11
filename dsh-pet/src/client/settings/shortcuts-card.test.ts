/**
 * The contract of the shortcut key card: all five elements are present, the key position is taken from the true
 * source, the binding is followed by the change, and it is a folding card like the reference card at the end of the
 * page.
 *
 * The only value of this card is that "the keys have only one true source" - the hover key reads the shared constant,
 * and the global key reads the DSH directory. The day someone writes down the keys, the assertion here will be red.
 *
 * Running method: node --experimental-strip-types --test src/client/settings/shortcuts-card.test.ts
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { jsx } from 'react/jsx-runtime';

import { HEAR_HOTKEY_HINT } from '../../shared/chat/hear-hold.ts';
import { CAPTURE_HOTKEY_HINT, CHAT_HOTKEY_HINT } from '../../shared/chat/hotkey.ts';
import { SLEEP_HOTKEY_HINT } from '../../shared/sleep-hotkey.ts';
import { TODO_HOTKEY_HINT } from '../../shared/todo/hotkey.ts';
import { keycapOf, type ShortcutHost } from '../app-shortcut.ts';
import { makeShortcutsCard } from './shortcuts-card.ts';

/** Node pile: `h` only collects tag and props without rendering. */
interface Node {
  tag: string;
  props: Record<string, unknown>;
}

/** Directory line: service expanded keycap fragment by platform. */
type Row = { id: string; keys: string[] };

const h = ((tag: unknown, props: Record<string, unknown>) => ({ tag, props })) as unknown as typeof jsx;
/** False useState: The initial value is accepted as it is, setter only swallows the call. */
const useState = ((init: unknown) => [init, () => {}]) as never;
/** False useEffect: Do not hang subscribe in the test, only require it to exist. */
const useEffect = (() => {}) as never;

/** False context: Directory content is given by use case. */
function makeCtx(rows: Row[]): ShortcutHost {
  return {
    get: () => ({
      catalog: {
        getSnapshot: () => rows,
        subscribe: () => () => {},
      },
    }),
  };
}

/** What the four commands look like after they have been changed: the letters appearing in the keycaps are not the default values. */
const REBOUND: Row[] = [
  { id: 'pet-chat.open', keys: ['Ctrl', '+', 'Alt', '+', 'J'] },
  { id: 'pet-chat.float', keys: ['Ctrl', '+', 'Alt', '+', 'K'] },
  { id: 'pet-chat.hear', keys: ['Ctrl', '+', 'Alt', '+', 'H'] },
  { id: 'pet-chat.capture', keys: ['Ctrl', '+', 'Alt', '+', 'Y'] },
];

/** Default combination: fallback copy when there is no such line in the directory. */
const CHAT_DEFAULT = keycapOf({ code: 'KeyP', modifiers: ['primary', 'shift'] });
const FLOAT_DEFAULT = keycapOf({ code: 'KeyL', modifiers: ['primary', 'shift'] });
const HEAR_DEFAULT = keycapOf({ code: 'KeyM', modifiers: ['primary', 'shift'] });
const CAPTURE_DEFAULT = keycapOf({ code: 'KeyS', modifiers: ['primary', 'shift'] });

/** Flatten the node tree and collect all text fragments into arrays. */
function texts(node: unknown): string[] {
  if (node === null || node === undefined) return [];
  if (typeof node === 'string') return [node];
  if (typeof node === 'number') return [String(node)];
  if (Array.isArray(node)) return node.flatMap(texts);
  return texts((node as Node).props?.children);
}

/** Flatten the node tree and collect all `data-tip` (the content of the question mark bubble is not in the text). */
function tips(node: unknown): string[] {
  if (node === null || node === undefined || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(tips);
  const element = node as Node;
  const tip = element.props?.['data-tip'];
  return [...(typeof tip === 'string' ? [tip] : []), ...tips(element.props?.children)];
}

/** Flatten the node tree and collect all element nodes. */
function nodes(node: unknown): Node[] {
  if (node === null || node === undefined || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(nodes);
  const element = node as Node;
  return [element, ...nodes(element.props?.children)];
}

/** Render the entire card once per given directory. */
function render(rows: Row[] = []): unknown {
  const Card = makeShortcutsCard({ h, t: (key: string) => key, useState, useEffect } as never, makeCtx(rows));
  return Card({});
}

describe('ShortcutsCard——Shortcut key card', () => {
  test('The global group follows the directory: after changing the binding, the changed keys are displayed.', () => {
    const text = texts(render(REBOUND)).join('\n');
    assert.ok(text.includes('Ctrl+Alt+K'), 'Open a conversation with the re-bound key');
    assert.ok(text.includes('Ctrl+Alt+H'), 'Voice input uses modified keys');
    assert.ok(text.includes('Ctrl+Alt+Y'), 'Use the modified keys to take screenshots');
    assert.ok(text.includes('Ctrl+Alt+J'), 'Sidebar dialogue uses modified keys');
  });

  test('The binding has not been changed → the global group shows the default combination', () => {
    const text = texts(render()).join('\n');
    assert.ok(text.includes(FLOAT_DEFAULT), 'Open conversation');
    assert.ok(text.includes(HEAR_DEFAULT), 'Voice input');
    assert.ok(text.includes(CAPTURE_DEFAULT), 'Screenshot');
    assert.ok(text.includes(CHAT_DEFAULT), 'Sidebar dialogue');
  });

  test('Hovering the group of read shared constants is not affected by binding changes', () => {
    const text = texts(render(REBOUND)).join('\n');
    assert.ok(text.includes(CHAT_HOTKEY_HINT), 'Open conversation');
    assert.ok(text.includes(HEAR_HOTKEY_HINT), 'Press and hold to speak');
    assert.ok(text.includes(CAPTURE_HOTKEY_HINT), 'Screenshot');
    assert.ok(text.includes(TODO_HOTKEY_HINT), 'To-do');
    assert.ok(text.includes(SLEEP_HOTKEY_HINT), 'Sleep');
  });

  test('Both sets of titles and descriptions, as well as all row labels are', () => {
    const text = texts(render()).join('\n');
    for (const key of [
      'shortcutGroupPet',
      'shortcutGroupPetHint',
      'shortcutGroupGlobal',
      'shortcutGroupGlobalHint',
      'shortcutRowChat',
      'shortcutRowHold',
      'shortcutRowHear',
      'shortcutRowCapture',
      'shortcutRowPaste',
      'shortcutRowTodo',
      'shortcutRowSleep',
      'shortcutRowDisplay',
      'shortcutRowSidebar',
    ]) {
      assert.ok(text.includes(key), key + ' 应该出现');
    }
  });

  test('It is a folding card, which is folded by default (the same skeleton as the two reference cards at the end of the page)', () => {
    const all = nodes(render());
    const card = all.find((node) => String(node.props?.className ?? '').includes('dsh-pet-cfg__card'));
    assert.ok(String(card?.props?.className).includes('is-fold'), 'It should be a folding card');
    assert.ok(!String(card?.props?.className).includes('is-open'), 'Should not be expanded by default');
    const toggle = all.find((node) => String(node.props?.className ?? '').includes('dsh-pet-cfg__foldToggle'));
    assert.equal(toggle?.props?.['aria-expanded'], false);
    assert.equal(toggle?.props?.['aria-controls'], 'pet-cfg-shortcuts');
  });

  test('The title is the card header text, and the description is hung on the question mark bubble', () => {
    const tree = render();
    assert.ok(texts(tree).join('\n').includes('shortcutCardTitle'), 'The title should be in the text');
    assert.ok(tips(tree).includes('shortcutCardHint'), 'Instructions should be hung on data-tip');
  });
});
