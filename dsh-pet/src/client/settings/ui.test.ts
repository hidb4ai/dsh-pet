/**
 * Contract test of settings page shared widget (src/client/settings/ui.ts).
 *
 * Three contracts:
 * 1. The description must use the `data-tip` bubble attribute, and the field with the description must also have
 * readable `aria-label` ;
 * 2. The checked state and disabled state of the switch grid are transparently transmitted to the native checkbox, and
 * the switch only returns a Boolean value;
 * 3. Do not leave a blank question mark when there is no description, and do not add `data-tip` to unexplained
 * elements.
 *
 * Record the node tree with fake `h` (without citing jsdom).
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { jsx } from 'react/jsx-runtime';

import { makeUiKit } from './ui.ts';

interface Node {
  tag: string;
  props: Record<string, unknown>;
}

const h = ((tag: string, props: Record<string, unknown>) => ({ tag, props })) as unknown as typeof jsx;

const ui = makeUiKit({ h, t: (key) => key });

/** Flatten the entire tree to facilitate finding nodes by label. */
function flatten(node: unknown): Node[] {
  if (node === null || node === undefined || typeof node === 'string') return [];
  if (Array.isArray(node)) return node.flatMap(flatten);
  const element = node as Node;
  return [element, ...flatten(element.props?.children)];
}

const byClass = (node: unknown, className: string): Node[] =>
  flatten(node).filter((child) => String(child.props.className ?? '').includes(className));

describe('field —— Field', () => {
  test('With description: The label is followed by a question mark, indicating that data-tip and aria-label are written simultaneously.', () => {
    const field = ui.field('大小', h('input', {}), '高度自动 = 宽度 × 9/16');
    const [label] = byClass(field, 'dsh-pet-cfg__flabel');
    const question = byClass(label, 'dsh-pet-cfg__q')[0];
    assert.equal(question.props['aria-label'], '高度自动 = 宽度 × 9/16', 'Question marks must have an accessible name');
    assert.equal(question.props['data-tip'], '高度自动 = 宽度 × 9/16');
    assert.equal(question.props.role, 'img');
    assert.equal(
      flatten(label).some((node) => node.tag === 'input'),
      false,
      'The input box is in the field container, not in the label',
    );
  });

  test('Without explanation: the label is just plain text and does not grow a question mark out of thin air.', () => {
    const field = ui.field('大小', h('input', {}));
    assert.deepEqual(byClass(field, 'dsh-pet-cfg__q'), []);
    const [label] = byClass(field, 'dsh-pet-cfg__flabel');
    assert.equal(label.props.children, '大小');
  });

  test('The question mark is not attached to data-tip-end: the bubble is automatically flanged by tip-layer, and is no longer divided into left and right.', () => {
    const field = ui.field('大小', h('input', {}), '说明');
    const [question] = byClass(field, 'dsh-pet-cfg__q');
    assert.equal(question.props['data-tip-end'], undefined);
  });
});

describe('toggleCell —— switch grid', () => {
  test('The checked and disabled states are transparently transmitted to checkbox, and the title is translated', () => {
    const cell = ui.toggleCell('notifyToggle', true, true, () => {});
    const input = flatten(cell).find((node) => node.tag === 'input');
    assert.equal(input?.props.type, 'checkbox');
    assert.equal(input?.props.checked, true);
    assert.equal(input?.props.disabled, true);
    assert.ok(flatten(cell).some((node) => node.props.children === 'notifyToggle'));
  });

  test('Switch only returns a Boolean value and does not throw the event object to the caller', () => {
    const seen: boolean[] = [];
    const cell = ui.toggleCell('x', false, false, (value) => seen.push(value));
    const input = flatten(cell).find((node) => node.tag === 'input');
    const onChange = input?.props.onChange as (event: { target: { checked: boolean } }) => void;
    onChange({ target: { checked: true } });
    assert.deepEqual(seen, [true]);
  });

  test('Description fixed on `<label + Hint>`', () => {
    const cell = ui.toggleCell('notifyToggle', false, false, () => {});
    const [question] = byClass(cell, 'dsh-pet-cfg__q');
    assert.equal(question.props['aria-label'], 'notifyToggleHint');
    assert.equal(question.props['data-tip'], 'notifyToggleHint');
  });
});

describe('cardHead——Card head', () => {
  test('title + question mark; only title when there is no description', () => {
    const withHint = ui.cardHead('宠物配置', '每只宠物独立配置');
    const [question] = byClass(withHint, 'dsh-pet-cfg__q');
    assert.equal(question.props['aria-label'], '每只宠物独立配置');

    const without = ui.cardHead('宠物配置');
    assert.deepEqual(byClass(without, 'dsh-pet-cfg__q'), []);
  });
});
