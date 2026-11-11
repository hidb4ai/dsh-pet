/**
 * Contract test of action frequency weight (src/shared/weights.ts).
 *
 * Three contracts:
 * 1. Random action = 100 − sum of three items, and will not be negative;
 * 2. When one item is changed, the other two items do not move, and the input exceeding the upper limit is clamped;
 * 3. Bad configuration (missing fields, non-numeric, negative numbers) is resolved to undefined, and the form retains
 * the current value.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { actionPercent, parseWeights, withWeight } from './weights.ts';

describe('actionPercent —— Proportion of random actions', () => {
  test('Default 10/5/5: Random action 80', () => {
    assert.equal(actionPercent({ idle: 10, turn: 5, move: 5 }), 80);
  });

  test('The invalid total exceeds 100: treat it as 0 and do not return a negative number', () => {
    assert.equal(actionPercent({ idle: 120, turn: 5, move: 5 }), 0);
  });

  test('Three items occupy 100: Random action 0', () => {
    assert.equal(actionPercent({ idle: 90, turn: 5, move: 5 }), 0);
  });
});

describe('withWeight ——Change one item and leave the rest unchanged', () => {
  test('Increase standby: Clamp to 100 − Steering − Move', () => {
    assert.deepEqual(withWeight({ idle: 10, turn: 5, move: 5 }, 'idle', 95), { idle: 90, turn: 5, move: 5 });
  });

  test('Decimal rounding, negative numbers clamped to 0', () => {
    assert.deepEqual(withWeight({ idle: 10, turn: 5, move: 5 }, 'turn', 7.6), { idle: 10, turn: 8, move: 5 });
    assert.deepEqual(withWeight({ idle: 10, turn: 5, move: 5 }, 'move', -3), { idle: 10, turn: 5, move: 0 });
  });

  test('Non-digits are treated as 0', () => {
    assert.deepEqual(withWeight({ idle: 10, turn: 5, move: 5 }, 'idle', Number.NaN), { idle: 0, turn: 5, move: 5 });
  });

  test('The total has exceeded 100 (bad handwritten configuration): clip to 0, no negative number is output', () => {
    assert.deepEqual(withWeight({ idle: 100, turn: 10, move: 0 }, 'move', 5), { idle: 100, turn: 10, move: 0 });
  });

  test('Do not modify input parameters', () => {
    const weights = { idle: 10, turn: 5, move: 5 };
    withWeight(weights, 'idle', 30);
    assert.deepEqual(weights, { idle: 10, turn: 5, move: 5 });
  });
});

describe('parseWeights —— Finished product configuration → Weight', () => {
  test('Three non-negative numbers are brought out as they are', () => {
    assert.deepEqual(parseWeights({ idle: 30, turn: 5, move: 5 }), { idle: 30, turn: 5, move: 5 });
  });

  test('Missing field/not a number/negative number/not an object: always undefined', () => {
    assert.equal(parseWeights({ idle: 30, turn: 5 }), undefined);
    assert.equal(parseWeights({ idle: 'x', turn: 5, move: 5 }), undefined);
    assert.equal(parseWeights({ idle: -1, turn: 5, move: 5 }), undefined);
    assert.equal(parseWeights(null), undefined);
    assert.equal(parseWeights([]), undefined);
  });
});
