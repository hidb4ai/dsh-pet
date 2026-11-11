/**
 * Contract test of the "Action Frequency" card in the standalone mode setting page.
 *
 * Three contracts:
 * 1. animationWeights in the resolved configuration is read into the draft, and the default fallback is
 * built-in for missing items;
 * 2. When one item is changed, the other two items do not move and are clamped when the upper limit is exceeded.
 * Read-only random actions are updated simultaneously;
 * 3. Put animationWeights on the save body.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';

import { coreScript } from './script/core.ts';
import { globalsScript } from './script/globals.ts';
import { petsScript } from './script/pets.ts';
import { widgetsScript } from './script/widgets.ts';

interface FakeNode {
  nodeType: number;
  attrs: Record<string, string>;
  children: FakeNode[];
  listeners: Record<string, () => void>;
  value?: string;
  setAttribute(name: string, value: string): void;
  addEventListener(name: string, fn: () => void): void;
  append(...kids: FakeNode[]): void;
}

interface Probe {
  state: {
    globals: { animationWeights: { idle: number; turn: number; move: number } };
    pets: Record<string, unknown[]>;
  };
  motionCard(): FakeNode;
  pickGlobals(main: Record<string, unknown>): { animationWeights: { idle: number; turn: number; move: number } };
  petsBody(): { animationWeights: { idle: number; turn: number; move: number } };
}

/** Minimum false DOM: Only enough for the script to render the card and trigger input once. */
function probe(): Probe {
  const byId = new Map<string, FakeNode>();
  const node = (): FakeNode => {
    const el: FakeNode = {
      nodeType: 1,
      attrs: {},
      children: [],
      listeners: {},
      value: '',
      setAttribute(name, value) {
        el.attrs[name] = String(value);
        if (name === 'id') byId.set(String(value), el);
      },
      addEventListener(name, fn) {
        el.listeners[name] = fn;
      },
      append(...kids) {
        el.children.push(...kids);
      },
    };
    return el;
  };
  const document = {
    createElement: node,
    createTextNode: (text: string) => ({ nodeType: 3, textContent: text }),
    getElementById: (id: string) => byId.get(id) ?? null,
    querySelectorAll: () => [],
    addEventListener() {},
  };
  const script = [
    coreScript('/dsh-pet-7340', {
      voices: [],
      fonts: [],
      displays: [],
      corners: [],
      physics: {},
      font: {},
      weights: { idle: 10, turn: 5, move: 5 },
    }),
    widgetsScript(),
    globalsScript(),
    petsScript(),
    'globalThis.__probe = { state, motionCard, pickGlobals, petsBody };',
  ].join('\n');
  const context: Record<string, unknown> = {
    document,
    location: { hash: '' },
    history: { replaceState() {} },
    URLSearchParams,
  };
  runInNewContext(script, context);
  return context.__probe as Probe;
}

/** Depth traverse the input box in the rendering tree; the text node does not have attrs and is skipped directly. */
function inputs(node: FakeNode, out: FakeNode[] = []): FakeNode[] {
  if (!node || !node.attrs) return out;
  if (node.attrs.id) out.push(node);
  for (const kid of node.children ?? []) inputs(kid, out);
  return out;
}

const weightsOf = (node: FakeNode) => node.attrs.id;

describe('Standalone mode action frequency card', () => {
  test('Read: The three items are brought out as they are, and the missing item fallback is built-in default', () => {
    const api = probe();
    assert.deepEqual(
      { ...api.pickGlobals({ animationWeights: { idle: 30, turn: 5, move: 5 } }).animationWeights },
      { idle: 30, turn: 5, move: 5 },
    );
    assert.deepEqual({ ...api.pickGlobals({}).animationWeights }, { idle: 10, turn: 5, move: 5 });
  });

  test('The order of the four frames is fixed; change the random action of clamping and synchronizing read-only during standby', () => {
    const api = probe();
    api.state.globals = api.pickGlobals({ animationWeights: { idle: 10, turn: 5, move: 5 } });
    const fields = inputs(api.motionCard()).filter((node) => weightsOf(node).startsWith('g-motion-'));
    assert.deepEqual(
      fields.map((node) => weightsOf(node)),
      ['g-motion-idle', 'g-motion-turn', 'g-motion-move', 'g-motion-action'],
    );
    assert.equal(fields[3].value, '80');
    fields[0].value = '95';
    fields[0].listeners.input();
    assert.deepEqual({ ...api.state.globals.animationWeights }, { idle: 90, turn: 5, move: 5 });
    assert.equal(fields[3].value, '0', 'Random actions should be recalculated with three items');
  });

  test('Save the body with animationWeights', () => {
    const api = probe();
    api.state.globals = api.pickGlobals({});
    api.state.pets = { main: [] };
    assert.deepEqual({ ...api.petsBody().animationWeights }, { idle: 10, turn: 5, move: 5 });
  });
});
