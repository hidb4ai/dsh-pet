/**
 * Contract test of two cards (src/client/settings/paths-cards.ts) at persist to disk location.
 *
 * Three contracts:
 * 1. It is collapsed by default, but the main text is still hanging on the tree (just the height is cut to 0) - the
 * content should not be lost when collapsed;
 * 2. `aria-expanded` / `aria-controls` of the title button is paired with id of the text, and the click is inverted;
 * 3. The question mark is inside the button but the bubble is blocked by itself: clicking it only produces bubbles,
 * without opening and closing.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { jsx } from 'react/jsx-runtime';

import type { ConfigMeta } from './config/index.ts';
import { makePathsCards } from './paths-cards.ts';

interface Node {
  tag: string;
  props: Record<string, unknown>;
}

const h = ((tag: unknown, props: Record<string, unknown>) => ({ tag, props })) as unknown as typeof jsx;

/** False useState: The folded state is given by the use case. setter only records the return value and does not trigger re-rendering. */
function fakeState(initial: boolean, seen: boolean[]) {
  return (() => [initial, (next: boolean) => seen.push(next)]) as never;
}

/** Create a pair of cards; `initial` is the initial opening and closing state shared by the two cards. */
function make(initial: boolean, seen: boolean[] = []) {
  return makePathsCards({ h, t: (key: string) => key, useState: fakeState(initial, seen) } as never);
}

const meta: ConfigMeta = {
  user: 'D:/u/config.jsonc',
  default: 'D:/p/assets/config.jsonc',
  animations: 'D:/u/animations',
  memes: 'D:/u/memes',
  logs: 'D:/u/pet.log',
  profile: 'default',
  storage: [
    { key: 'config', path: 'D:/u/config.jsonc', exists: true },
    { key: 'cache', path: 'D:/u/cache', exists: false },
  ],
};

function flatten(node: unknown): Node[] {
  if (node === null || node === undefined || typeof node === 'string') return [];
  if (Array.isArray(node)) return node.flatMap(flatten);
  const element = node as Node;
  return [element, ...flatten(element.props?.children)];
}

const byClass = (tree: unknown, cls: string): Node | undefined =>
  flatten(tree).find((node) => String(node.props?.className ?? '').includes(cls));

const byId = (tree: unknown, id: string): Node | undefined => flatten(tree).find((node) => node.props?.id === id);

describe('paths-cards —— Folding card', () => {
  test('Default collapse: button aria-expanded is false, the text is on the tree but aria-hidden', () => {
    const tree = make(false).ConfigMetaCard({ paths: meta });
    const button = byClass(tree, 'dsh-pet-cfg__foldToggle');
    assert.ok(button);
    assert.equal(button.props['aria-expanded'], false);
    assert.equal(button.props['aria-controls'], 'pet-cfg-paths-meta');
    // The text content is still rendered: folding it only cuts the height to 0, not rendering it un-rendered.
    const body = byId(tree, 'pet-cfg-paths-meta');
    assert.ok(body);
    assert.equal(body.props['aria-hidden'], 'true');
    const card = byClass(tree, 'dsh-pet-cfg__card');
    assert.ok(String(card?.props.className).includes('is-fold'));
    assert.ok(!String(card?.props.className).includes('is-open'));
  });

  test('Expanded state: aria-expanded is true, remove aria-hidden and mount is-open', () => {
    const tree = make(true).ConfigMetaCard({ paths: meta });
    const button = byClass(tree, 'dsh-pet-cfg__foldToggle');
    assert.equal(button?.props['aria-expanded'], true);
    assert.equal(byId(tree, 'pet-cfg-paths-meta')?.props['aria-hidden'], undefined);
    const card = byClass(tree, 'dsh-pet-cfg__card');
    assert.ok(String(card?.props.className).includes('is-open'));
  });

  test('Click the title line to return the reversed state', () => {
    const closed: boolean[] = [];
    const closedButton = byClass(make(false, closed).ConfigMetaCard({ paths: meta }), 'dsh-pet-cfg__foldToggle');
    (closedButton?.props.onClick as () => void)();
    assert.deepEqual(closed, [true]);

    const open: boolean[] = [];
    const openButton = byClass(make(true, open).ConfigMetaCard({ paths: meta }), 'dsh-pet-cfg__foldToggle');
    (openButton?.props.onClick as () => void)();
    assert.deepEqual(open, [false]);
  });

  test('Clicking the question mark only stops bubbling and does not switch the opening and closing of the question mark.', () => {
    const seen: boolean[] = [];
    const wrap = byClass(make(false, seen).ConfigMetaCard({ paths: meta }), 'dsh-pet-cfg__qWrap');
    assert.ok(wrap);
    let stopped = false;
    (wrap.props.onClick as (e: { stopPropagation: () => void }) => void)({
      stopPropagation: () => {
        stopped = true;
      },
    });
    assert.equal(stopped, true);
    assert.deepEqual(seen, []);
  });

  test('Each of the two cards uses its own text id', () => {
    const cards = make(false);
    const metaTree = cards.ConfigMetaCard({ paths: meta });
    const storageTree = cards.StorageCard({ paths: meta });
    assert.equal(byClass(metaTree, 'dsh-pet-cfg__foldToggle')?.props['aria-controls'], 'pet-cfg-paths-meta');
    assert.equal(byClass(storageTree, 'dsh-pet-cfg__foldToggle')?.props['aria-controls'], 'pet-cfg-paths-storage');
  });
});

describe('paths-cards ——The content does not change due to folding', () => {
  test('Advanced configuration lists five paths and log descriptions', () => {
    const tree = make(false).ConfigMetaCard({ paths: meta });
    const rows = flatten(tree).filter((node) => String(node.props?.className ?? '').includes('dsh-pet-cfg__path'));
    assert.equal(rows.length, 5);
    assert.ok(flatten(tree).some((node) => node.props?.className === 'dsh-pet-cfg__note'));
  });

  test('unmount and storage: two paths, unmount command and three-step instructions', () => {
    const tree = make(false).StorageCard({ paths: meta });
    const rows = flatten(tree).filter((node) => String(node.props?.className ?? '').includes('dsh-pet-cfg__path'));
    assert.equal(rows.length, 2);
    assert.ok(flatten(tree).some((node) => node.props?.className === 'dsh-pet-cfg__cmd'));
    const notes = flatten(tree).filter((node) => node.props?.className === 'dsh-pet-cfg__note');
    assert.equal(notes.length, 3);
  });

  test('The entire card does not render when there is no storage list', () => {
    const tree = make(false).StorageCard({ paths: { ...meta, storage: [] } });
    assert.equal(tree, null);
  });
});
