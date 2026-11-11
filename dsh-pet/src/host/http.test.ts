/**
 * Contract test of HTTP pipeline (src/host/http.ts): request body reading, single segment Range parsing, Range
 * response of sendFile. readBody/parseRange uses fake requests and pure function drivers; sendFile uses the local
 * temporary server to send real requests.
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MAX_BODY_BYTES, parseRange, readBody, sendFile } from './http.ts';

/** False request: only keep on/off and destroy used by readBody. */
function fakeReq() {
  const emitter = new EventEmitter();
  const destroyed: boolean[] = [];
  const req = {
    on: (event: string, listener: (...args: unknown[]) => void) => emitter.on(event, listener),
    off: (event: string, listener: (...args: unknown[]) => void) => emitter.off(event, listener),
    destroy: () => destroyed.push(true),
    emit: (event: string, ...args: unknown[]) => emitter.emit(event, ...args),
  };
  return { req: req as unknown as Parameters<typeof readBody>[0], destroyed, emitter: req };
}

describe('readBody —— Normal reading', () => {
  test('Arrival in fragments: spell into complete text', async () => {
    const { req, emitter } = fakeReq();
    const pending = readBody(req);
    emitter.emit('data', Buffer.from('{"a":'));
    emitter.emit('data', Buffer.from('1}'));
    emitter.emit('end');
    assert.equal(await pending, '{"a":1}');
  });

  test('After reading close again, it will not change the result.', async () => {
    const { req, emitter } = fakeReq();
    const pending = readBody(req);
    emitter.emit('data', Buffer.from('x'));
    emitter.emit('end');
    assert.equal(await pending, 'x');
    emitter.emit('close');
  });
});

describe('readBody - Path rejected', () => {
  test('Exceeding the upper limit: reject with body-too-large and destroy the request', async () => {
    const { req, emitter, destroyed } = fakeReq();
    const pending = readBody(req);
    emitter.emit('data', Buffer.alloc(MAX_BODY_BYTES + 1));
    await assert.rejects(pending, (error: Error & { code?: string }) => {
      assert.equal(error.code, 'body-too-large');
      return true;
    });
    assert.deepEqual(destroyed, [true], 'The connection should be destroyed after exceeding the limit');
  });

  test('Client interrupt (close): Rejected with client-aborted, will not hang forever', async () => {
    const { req, emitter } = fakeReq();
    const pending = readBody(req);
    emitter.emit('data', Buffer.from('半截'));
    emitter.emit('close');
    await assert.rejects(pending, (error: Error & { code?: string }) => {
      assert.equal(error.code, 'client-aborted');
      return true;
    });
  });

  test('Underlying error: exposed as is', async () => {
    const { req, emitter } = fakeReq();
    const pending = readBody(req);
    const boom = new Error('socket hang up');
    emitter.emit('error', boom);
    await assert.rejects(pending, (error: Error) => error === boom);
  });
});

describe('parseRange —— single segment bytes interval', () => {
  test('Complete request: bytes =0- → entire file', () => {
    assert.deepEqual(parseRange('bytes=0-', 1000), { start: 0, end: 999 });
  });

  test('Explicit range: bytes =100-199 → only take this section', () => {
    assert.deepEqual(parseRange('bytes=100-199', 1000), { start: 100, end: 199 });
  });

  test('Open ending: bytes =500- → from 500 to the end of the file', () => {
    assert.deepEqual(parseRange('bytes=500-', 1000), { start: 500, end: 999 });
  });

  test('Suffix form: bytes =-200 → 200 bytes at the end', () => {
    assert.deepEqual(parseRange('bytes=-200', 1000), { start: 800, end: 999 });
  });

  test('Suffix exceeds file length: bytes =-5000 → whole copy', () => {
    assert.deepEqual(parseRange('bytes=-5000', 1000), { start: 0, end: 999 });
  });

  test('Single bytes: bytes =0-0 → only take the 0th bytes', () => {
    assert.deepEqual(parseRange('bytes=0-0', 1000), { start: 0, end: 0 });
  });

  test('Last bytes: bytes =999- → last bytes', () => {
    assert.deepEqual(parseRange('bytes=999-', 1000), { start: 999, end: 999 });
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

  test('The unit is not bytes: items =0-99 → ignore', () => {
    assert.equal(parseRange('items=0-99', 1000), null);
  });

  test('Invalid syntax: bytes = abc-def → Ignore', () => {
    assert.equal(parseRange('bytes=abc-def', 1000), null);
  });

  test('No Range header: undefined → Ignore', () => {
    assert.equal(parseRange(undefined, 1000), null);
  });

  test('File length is 0: bytes =0- → ignore', () => {
    assert.equal(parseRange('bytes=0-', 0), null);
  });

  test('Suffix is 0: bytes =-0 → ignore', () => {
    assert.equal(parseRange('bytes=-0', 1000), null);
  });
});

describe('sendFile —— Range response', () => {
  /** Deterministic content of 1000 bytes: i bytes = i % 256, easy to assert slice boundaries */
  const payload = Buffer.from(Array.from({ length: 1000 }, (_value, index) => index % 256));
  let dir = '';
  let base = '';
  let close = (): void => {};

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), 'dsh-pet-range-'));
    const file = join(dir, 'clip.webm');
    writeFileSync(file, payload);
    // Each test file builds its own server and random port, and closes it at the end (does not rely on external services)
    const server = createServer((req, res) => sendFile(req, res, file, 'video/webm'));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const port = address && typeof address === 'object' ? address.port : 0;
    base = `http://127.0.0.1:${port}`;
    close = () => server.close();
  });

  after(() => {
    close();
    rmSync(dir, { recursive: true, force: true });
  });

  test('None Range: Return 200, body is the entire file', async () => {
    const response = await fetch(base);
    assert.equal(response.status, 200);
    assert.equal(Buffer.from(await response.arrayBuffer()).length, payload.length);
  });

  test('Single segment interval: bytes =100-199 → 206, only return these 100 bytes', async () => {
    const response = await fetch(base, { headers: { range: 'bytes=100-199' } });
    assert.equal(response.status, 206);
    const body = Buffer.from(await response.arrayBuffer());
    assert.equal(body.length, 100);
    assert.equal(body[0], 100);
    assert.equal(body[99], 199);
  });

  test('Open ending: bytes =500- → 206, return 500..999', async () => {
    const response = await fetch(base, { headers: { range: 'bytes=500-' } });
    assert.equal(response.status, 206);
    assert.equal(response.headers.get('content-range'), 'bytes 500-999/1000');
    assert.equal(Buffer.from(await response.arrayBuffer()).length, 500);
  });

  test('The starting point is out of bounds: bytes =1000- → 416, and declare the total file length', async () => {
    const response = await fetch(base, { headers: { range: 'bytes=1000-' } });
    assert.equal(response.status, 416);
    assert.equal(response.headers.get('content-range'), 'bytes */1000');
  });

  test('Multi-segment request: bytes =0-99,200-299 → 200 whole portion (ignore Range)', async () => {
    const response = await fetch(base, { headers: { range: 'bytes=0-99,200-299' } });
    assert.equal(response.status, 200);
    assert.equal(Buffer.from(await response.arrayBuffer()).length, payload.length);
  });

  test('206 must contain Content-Range and slice length, otherwise the player will still be misaligned', async () => {
    const response = await fetch(base, { headers: { range: 'bytes=262-' } });
    assert.equal(response.status, 206);
    assert.equal(response.headers.get('content-length'), '738');
    assert.equal(response.headers.get('content-range'), 'bytes 262-999/1000');
    assert.equal(response.headers.get('accept-ranges'), 'bytes');
  });
});
