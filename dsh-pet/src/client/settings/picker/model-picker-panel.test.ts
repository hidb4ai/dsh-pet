/**
 * Contract testing of model selector overlay.
 *
 * Three contracts:
 * 1. Three distinct states: "Loading"/"Pull failed" is displayed when the list is not pulled, and the corresponding
 * empty state is displayed when the list is empty or the search fails, and it is never left blank;
 * 2. The selected state comes from the current value: `aria-checked` only falls on the line that is actually selected,
 * and the highlighted line also has the `is-active` class;
 * 3. Disable transparent transmission: When the selector is disabled, the search box and each row cannot be clicked.
 *
 * Record the node tree with a fake `h` (does not reference jsdom and does not render the real DOM).
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { jsx } from 'react/jsx-runtime';

import { buildModelRows } from './model-rows.ts';
import { buildModelPanel, type ModelPanelView } from './model-picker-panel.ts';

/** Fake node: Only the label name and props are left, which is enough for assertion. */
interface Node {
  tag: string;
  props: Record<string, unknown>;
}

const h = ((tag: string, props: Record<string, unknown>) => ({ tag, props })) as unknown as typeof jsx;

/** Flatten the entire tree into a node array to facilitate searching by label or class name. */
function flatten(node: unknown): Node[] {
  if (node === null || node === undefined || typeof node === 'string') return [];
  if (Array.isArray(node)) return node.flatMap(flatten);
  const element = node as Node;
  const children = element.props?.children;
  return [element, ...flatten(children)];
}

const catalog = [{ id: 'openai', name: 'OpenAI', models: [{ id: 'gpt-4o', name: 'GPT-4o' }] }];

/** Create a view; only cover the fields that the use case cares about. */
function view(overrides: Partial<ModelPanelView> = {}): ModelPanelView {
  const base: ModelPanelView = {
    h,
    // The translation function directly returns the key name, and the copy can be located according to key in the assertion, without relying on the specific Chinese and English.
    t: (key) => key,
    label: '碎碎念模型',
    disabled: false,
    catalog,
    failed: false,
    rows: buildModelRows(catalog, ''),
    active: 0,
    query: '',
    value: { provider: '', model: '' },
    pos: { left: 10, top: 20, width: 240, maxHeight: 300 },
    panelRef: { current: null },
    onQueryChange: () => {},
    onPick: () => {},
    onHover: () => {},
    onKeyDown: () => {},
  };
  return { ...base, ...overrides };
}

const texts = (tree: unknown): string[] =>
  flatten(tree)
    .map((node) => node.props.children)
    .filter((child): child is string => typeof child === 'string');

describe('buildModelPanel - floating layer three states and selected state', () => {
  test('The list is not pulled: "Loading" is displayed and the row list is not rendered.', () => {
    const tree = buildModelPanel(view({ catalog: null, rows: [] }));
    assert.deepEqual(
      flatten(tree)
        .filter((node) => node.tag === 'button')
        .map((node) => node.props.className),
      [],
      'Optional rows cannot appear before the list is pulled.',
    );
    assert.deepEqual(texts(tree), ['modelLoading']);
  });

  test('Pull failed: "Pull failed" is displayed instead of "Loading"', () => {
    const tree = buildModelPanel(view({ catalog: null, rows: [], failed: true }));
    assert.deepEqual(texts(tree), ['modelCatalogFailed']);
  });

  test('There is no available service provider for host: the entire block displays "No available model" without leaving a blank floating layer.', () => {
    const tree = buildModelPanel(view({ catalog: [], rows: buildModelRows([], '') }));
    assert.deepEqual(
      texts(tree).filter((text) => text !== 'modelSearch'),
      ['modelNoModels'],
    );
  });

  test('Search failed: "No matching model" is displayed.', () => {
    const tree = buildModelPanel(view({ query: 'zzz', rows: buildModelRows(catalog, 'zzz') }));
    assert.deepEqual(
      texts(tree).filter((text) => text !== 'modelSearch'),
      ['modelEmpty'],
    );
  });

  test('Normal list: number of rows, clickable rows, selected state and highlighting all follow the view data', () => {
    const rows = buildModelRows(catalog, '');
    // Line order: [Follow(0), Group header(1), Model(2)], highlight the line where the model falls.
    const tree = buildModelPanel(view({ rows, active: 2, value: { provider: 'openai', model: 'gpt-4o' } }));
    const buttons = flatten(tree).filter((node) => node.tag === 'button');
    assert.equal(buttons.length, 2, '"Follow the current conversation" + a model');
    const [follow, model] = buttons;
    assert.equal(
      follow.props['aria-checked'],
      false,
      'The specific model is currently selected, and the follow line should not be checked.',
    );
    assert.equal(model.props['aria-checked'], true);
    assert.equal(model.props.className, 'dsh-pet-mp__item is-active', 'Highlight falls on line active');
    assert.equal(model.props['data-row'], 2);
  });

  test('Disable passthrough: search box and every row are disabled', () => {
    const tree = buildModelPanel(view({ disabled: true }));
    const nodes = flatten(tree);
    assert.equal(nodes.find((node) => node.tag === 'input')?.props.disabled, true);
    for (const button of nodes.filter((node) => node.tag === 'button')) {
      assert.equal(button.props.disabled, true);
    }
  });

  test('Writing process: The panel has menu semantics and the search box has aria-label', () => {
    const tree = buildModelPanel(view());
    const nodes = flatten(tree);
    const panel = nodes[0];
    assert.equal(panel.props.role, 'menu');
    assert.equal(panel.props['aria-label'], '碎碎念模型');
    const input = nodes.find((node) => node.tag === 'input');
    assert.equal(input?.props['aria-label'], 'modelSearch');
    assert.equal(input?.props.placeholder, 'modelSearch');
  });
});
