/**
 * Contract test of action frequency card (src/client/settings/motion-card.ts).
 *
 * Three contracts:
 * 1. The order of the four input boxes is fixed as standby/turn/move/random action, the first three are editable and
 * the fourth is read-only;
 * 2. When one item is changed, the other two items do not move, and the value exceeding the upper limit is clamped
 * before submission;
 * 3. When busy, the first three inputs are all disabled.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { jsx } from 'react/jsx-runtime';

import { makeMotionCard } from './motion-card.ts';

interface Node {
  tag: string;
  props: Record<string, unknown>;
}

const h = ((tag: unknown, props: Record<string, unknown>) => ({ tag, props })) as unknown as typeof jsx;
const MotionCard = makeMotionCard({ h, t: (key: string) => key } as never);

function flatten(node: unknown): Node[] {
  if (node === null || node === undefined || typeof node === 'string') return [];
  if (Array.isArray(node)) return node.flatMap(flatten);
  const element = node as Node;
  return [element, ...flatten(element.props?.children)];
}

const inputs = (tree: unknown): Node[] => flatten(tree).filter((node) => node.tag === 'input');

/** Triggering out-of-focus commit of numberInputProps. */
function commit(input: Node, text: string): void {
  const target = { value: text };
  (input.props.onBlur as (event: { target: { value: string } }) => void)({ target });
}

describe('MotionCard——Action frequency card', () => {
  test('The order of the four boxes is fixed, the random action is read-only and equal to the margin', () => {
    const tree = MotionCard({
      busy: false,
      weights: { idle: 10, turn: 5, move: 5 },
      onChange: () => {},
    } as never);
    const found = inputs(tree);
    assert.equal(found.length, 4);
    assert.deepEqual(
      found.slice(0, 3).map((input) => input.props.defaultValue),
      ['10', '5', '5'],
    );
    assert.equal(found[3].props.value, 80);
    assert.equal(found[3].props.readOnly, true, 'Random actions should not be given entry points.');
  });

  test('Change to standby: the other two items will not move, and will be clamped to 90 if the upper limit is exceeded.', () => {
    const seen: unknown[] = [];
    const tree = MotionCard({
      busy: false,
      weights: { idle: 10, turn: 5, move: 5 },
      onChange: (weights: unknown) => seen.push(weights),
    } as never);
    commit(inputs(tree)[0], '95');
    assert.deepEqual(seen, [{ idle: 90, turn: 5, move: 5 }]);
  });

  test('No callback if the value has not changed', () => {
    const seen: unknown[] = [];
    const tree = MotionCard({
      busy: false,
      weights: { idle: 10, turn: 5, move: 5 },
      onChange: (weights: unknown) => seen.push(weights),
    } as never);
    commit(inputs(tree)[0], '10');
    assert.deepEqual(seen, []);
  });

  test('The first three inputs are disabled when busy', () => {
    const tree = MotionCard({
      busy: true,
      weights: { idle: 10, turn: 5, move: 5 },
      onChange: () => {},
    } as never);
    for (const input of inputs(tree).slice(0, 3)) assert.equal(input.props.disabled, true);
  });
});
