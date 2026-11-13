/** Prevent accidental ID zero or malformed sequences in operator-entered action mappings. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRobotActionIds } from './settings.ts';

test('accept ordered taught action IDs, including a deliberate zero', () => {
  assert.deepEqual(parseRobotActionIds('0, 100,101'), [0, 100, 101]);
});

test('reject empty IDs, decimal positions, expressions and out-of-range values', () => {
  for (const value of ['', ' ', '1,', ',1', '1,,2', '-1', '1.2', '1e2', '1;2', '2147483648'])
    assert.throws(() => parseRobotActionIds(value), /robotInvalidIds/);
});
