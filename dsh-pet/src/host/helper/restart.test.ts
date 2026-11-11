/**
 * restart pure function test: verify the judgment of "blank output does not count as process running" (#286).
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { helperOutputIsMeaningful } from './restart.ts';

describe('helperOutputIsMeaningful - Blank output does not count as "the process is really running"', () => {
  test('Pure blank (written before Electron abort \\ r \\ n) → not counted as output', () => {
    assert.equal(helperOutputIsMeaningful('\r\n'), false);
  });

  test('Only spaces and tabs → do not count as output', () => {
    assert.equal(helperOutputIsMeaningful(' \t '), false);
  });

  test('There is actual content → Calculate output', () => {
    assert.equal(helperOutputIsMeaningful('[dsh-pet] helper booted'), true);
  });
});
