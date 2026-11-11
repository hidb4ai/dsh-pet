/**
 * Single test of single segment HTTP Range analysis (runtime/electron-helper/range.js).
 *
 * It has the same semantics as parseRange of src/host/http.ts on the host side, and the boundary matrix remains
 * consistent; one copy is measured on both sides because the running environment and build boundary are different
 * (bridge is CJS of Electron main process, and the host is TS). Running method: node --test
 * scripts/tests/range.test.mjs (npm run test:ui will be brought).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { parseRange } = require('../../runtime/electron-helper/range.js');

describe('parseRange - Range analysis of bridge asset response', () => {
  test('Complete request: bytes =0- → entire file', () => {
    assert.deepEqual(parseRange('bytes=0-', 1000), { start: 0, end: 999 });
  });

  test('Explicit interval: bytes =262144- → from this offset to the end', () => {
    assert.deepEqual(parseRange('bytes=262144-', 1000000), { start: 262144, end: 999999 });
  });

  test('Suffix form: bytes =-200 → 200 bytes at the end', () => {
    assert.deepEqual(parseRange('bytes=-200', 1000), { start: 800, end: 999 });
  });

  test('Suffix exceeds file length: bytes =-5000 → whole copy', () => {
    assert.deepEqual(parseRange('bytes=-5000', 1000), { start: 0, end: 999 });
  });

  test('The starting point is out of bounds: bytes =1000- → unsatisfiable (reply to 416)', () => {
    assert.equal(parseRange('bytes=1000-', 1000), 'unsatisfiable');
  });

  test('The starting point is greater than the end point: bytes =200-100 → unsatisfiable (reply to 416)', () => {
    assert.equal(parseRange('bytes=200-100', 1000), 'unsatisfiable');
  });

  test('Multi-segment request: bytes =0-99,200-299 → Ignore (return to the whole copy)', () => {
    assert.equal(parseRange('bytes=0-99,200-299', 1000), null);
  });

  test('No Range header: null → Ignore', () => {
    assert.equal(parseRange(null, 1000), null);
  });

  test('File length is 0: bytes =0- → ignore', () => {
    assert.equal(parseRange('bytes=0-', 0), null);
  });
});
