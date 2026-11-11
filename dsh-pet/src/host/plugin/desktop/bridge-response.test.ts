/**
 * Unit test of pipeline response mapping (asset goes to file, text and JSON goes to body, no need to respond to 204).
 *
 * Invariants of verify:
 * - id is brought back as it is: the concurrent requests on the pipeline are matched by it, and the serial number is
 * equivalent to giving the response of A to B;
 * - The asset is constant 200 and only contains the path, and the text is handed over to the main process to read the
 * disk (large videos do not enter the pipeline);
 * - Business failure (200 + ok:false) is transparently transmitted as it is, and the status code is not changed at
 * this layer.
 *
 * Running method: node --experimental-strip-types --test src/host/plugin/desktop/bridge-response.test.ts
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { toBridgeResponse } from './bridge-response.ts';

describe('toBridgeResponse —— route result → pipe response', () => {
  test('asset: Heng 200, only with file path and type (the text is read by the main process)', () => {
    const res = toBridgeResponse(7, { kind: 'file', file: '/tmp/a.webm', contentType: 'video/webm' });
    assert.deepEqual(res, { id: 7, status: 200, contentType: 'video/webm', file: '/tmp/a.webm' });
  });

  test('Text: status code and text are brought back as they are, the type is fixed text/plain', () => {
    const res = toBridgeResponse(2, { kind: 'text', status: 404, body: 'not found' });
    assert.deepEqual(res, { id: 2, status: 404, contentType: 'text/plain; charset=utf-8', body: 'not found' });
  });

  test('JSON: The service failure body is transparently transmitted as it is (200 + ok:false is not changed to 5 xx in this layer)', () => {
    const obj = { ok: false, reason: 'invalid-config' };
    const res = toBridgeResponse(3, { kind: 'json', status: 200, obj });
    assert.equal(res.status, 200);
    assert.equal(res.contentType, 'application/json; charset=utf-8');
    assert.deepEqual(JSON.parse(res.body ?? ''), obj);
  });

  test('JSON: If it is not 2, xx is also passed (405/413 is determined by route, and the mapping layer does not change the judgment)', () => {
    const res = toBridgeResponse(4, { kind: 'json', status: 405, obj: { ok: false, reason: 'method-not-allowed' } });
    assert.equal(res.status, 405);
  });

  test('No response required: empty 204 (the connection has been disconnected, no text is written)', () => {
    const res = toBridgeResponse(5, { kind: 'none' });
    assert.deepEqual(res, { id: 5, status: 204, contentType: 'text/plain; charset=utf-8', body: '' });
  });

  test('id is brought back as it is: two concurrent requests will not have serial numbers.', () => {
    const first = toBridgeResponse(11, { kind: 'text', status: 200, body: 'a' });
    const second = toBridgeResponse(12, { kind: 'text', status: 200, body: 'b' });
    assert.equal(first.id, 11);
    assert.equal(second.id, 12);
  });
});
