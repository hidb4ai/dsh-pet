/**
 * Contract test of response constructor: The conclusion determines the status code, and the body is always the same
 * entity.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  failureBody,
  failResult,
  internalError,
  invalidJson,
  methodNotAllowed,
  okResult,
  payloadTooLarge,
} from './result.ts';

test('okResult: 200, the response body is the result itself', () => {
  const r = okResult({ ok: true, n: 1 });
  assert.equal(r.kind, 'json');
  assert.equal(r.kind === 'json' ? r.status : undefined, 200);
  assert.deepEqual(r.kind === 'json' ? r.obj : undefined, { ok: true, n: 1 });
});

test('okResult: Cache header available', () => {
  const r = okResult({ counter: 0 }, { 'cache-control': 'no-cache' });
  assert.deepEqual(r.kind === 'json' ? r.headers : undefined, { 'cache-control': 'no-cache' });
});

test('failResult: Business failure is always 200 + failed entities', () => {
  const r = failResult('unknown-pet', '没有这只桌宠：ghost');
  assert.deepEqual(r, {
    kind: 'json',
    status: 200,
    obj: { ok: false, reason: 'unknown-pet', message: '没有这只桌宠：ghost' },
  });
});

test('failResult: Additional fields are entered into the body, but ok / reason / message cannot be covered.', () => {
  const r = failResult('locked', '占用中', { expiresAt: 123, ok: true, reason: 'bad-request' });
  assert.deepEqual(r, {
    kind: 'json',
    status: 200,
    obj: { ok: false, reason: 'locked', message: '占用中', expiresAt: 123 },
  });
});

test('Protocol failed: real status code + same entity shape', () => {
  const cases: Array<[ReturnType<typeof invalidJson>, number, string]> = [
    [invalidJson(), 400, 'invalid-json'],
    [methodNotAllowed(), 405, 'method-not-allowed'],
    [payloadTooLarge(), 413, 'payload-too-large'],
    [internalError(), 500, 'internal-error'],
  ];
  for (const [r, status, reason] of cases) {
    assert.equal(r.kind === 'json' ? r.status : undefined, status);
    const obj = r.kind === 'json' ? (r.obj as Record<string, unknown>) : {};
    assert.equal(obj.ok, false, reason);
    assert.equal(obj.reason, reason);
    assert.equal(typeof obj.message, 'string');
  }
});

test('failureBody: Has nothing to do with the status code, only describes the conclusion', () => {
  assert.deepEqual(failureBody('bad-request', 'x'), { ok: false, reason: 'bad-request', message: 'x' });
});
