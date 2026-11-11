/**
 * Working state leaf analysis: `sessionId` is a new optional field. The old host does not write it, and the external
 * slot writes null.
 *
 * Only parsing boundaries are tested - aggregate with priority host/work-status.test.ts. Running method: node --
 * experimental-strip-types --test src/shared/work-status.test.ts
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { toWorkStatus } from './work-status.ts';

describe('toWorkStatus —— sessionId analysis', () => {
  test('With sessionId → keep it as it is, for click bubble to jump to the conversation', () => {
    const snap = toWorkStatus({ state: 'working', task: '改文件', sessionId: 'session-abc' });
    assert.equal(snap?.sessionId, 'session-abc');
  });

  test('Missing field / null (old host or external slot) → null, bubble therefore cannot be clicked', () => {
    assert.equal(toWorkStatus({ state: 'working', task: null })?.sessionId, null);
    assert.equal(toWorkStatus({ state: 'working', task: null, sessionId: null })?.sessionId, null);
  });

  test('Empty string / sentinel unknown / non-character string → null (prevent bubble from jumping to a non-existent place)', () => {
    for (const sessionId of ['', 'unknown', 42, {}, true]) {
      assert.equal(toWorkStatus({ state: 'working', task: null, sessionId })?.sessionId, null);
    }
  });

  test('The idle snapshot also contains sessionId: null', () => {
    assert.deepEqual(toWorkStatus({ state: null, task: null }), { state: null, task: null, sessionId: null });
  });
});
