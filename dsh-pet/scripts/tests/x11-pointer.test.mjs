/**
 * Single test of x11-pointer - only test without touching X server: setup response analysis, and timeout when the
 * connection cannot be reached.
 *
 * Why it’s worth a single test: This section is the **handwritten X11 line protocol**. If the offset is wrong by one
 * space, the root window will be recognized as a random number, and the real machine CI does not have X11 to run.
 * Here, the synthesis buffer is used to verify two layouts: ① Standard layout (vendor immediately after the 16 bytes
 * fixed-length header); ② "Multiple 16 bytes prefix" layout encountered in actual testing (for individual servers, see
 * the parseRoot comment of x11-pointer.js). Use stand-in socket to test the timeout: it must fail when the X side does
 * not respond, and polling cannot be hung permanently.
 *
 * Running method: node --test scripts/tests/x11-pointer.test.mjs (npm run test:ui will be brought)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { EventEmitter } = require('node:events');
const net = require('node:net');
const { createLinuxPointer, parseRoot } = require('../../runtime/electron-helper/x11-pointer.js');

/** Stand-in socket: never connect, never data; setTimeout sends 'timeout' to the point, which is consistent with the behavior of node:net */
function neverConnectingSocket() {
  const socket = new EventEmitter();
  let timer = null;
  socket.setTimeout = (ms, callback) => {
    if (timer) clearTimeout(timer);
    timer = ms > 0 ? setTimeout(() => (callback ? callback() : socket.emit('timeout')), ms) : null;
  };
  socket.destroy = () => {
    if (timer) clearTimeout(timer);
  };
  return socket;
}

/** synthesize a setup response body: fixed-length header + vendor + formats + first screen (only the root field is guaranteed to be readable) */
function setupBody({ vendor = 'The X.Org Foundation', formats = 1, root = 0x831 } = {}) {
  const pad = (n) => (4 - (n % 4)) % 4;
  const head = Buffer.alloc(16);
  const vendorBuf = Buffer.from(vendor, 'latin1');
  head.writeUInt16LE(vendorBuf.length, 0); // vendor length
  head.writeUInt16LE(0xffff, 2); // max request length
  head[4] = 1; // number of screens
  head[5] = formats; // number of formats
  head[6] = 0; // image byte order
  head[7] = 0; // bitmap bit order
  head[8] = 32; // scanline unit
  head[9] = 32; // scanline pad
  head[10] = 8; // min keycode
  head[11] = 255; // max keycode

  const formatBuf = Buffer.alloc(formats * 8);
  const screen = Buffer.alloc(48);
  screen.writeUInt32LE(root, 0); // Root window: parseRoot read-only this field
  return Buffer.concat([head, vendorBuf, Buffer.alloc(pad(vendorBuf.length)), formatBuf, screen]);
}

test('Standard layout: read root window from first screen', () => {
  assert.equal(parseRoot(setupBody({ root: 0x831 })), 0x831);
  assert.equal(parseRoot(setupBody({ root: 0x400, formats: 4 })), 0x400);
});

test('Layouts with multiple 16 bytes prefixes can also be recognized (tested on individual servers)', () => {
  const body = Buffer.concat([Buffer.alloc(16, 0x5a), setupBody({ root: 0x6d0 })]);
  assert.equal(parseRoot(body), 0x6d0);
});

test('When the root window is not recognized, an error is explicitly thrown and no garbage value is returned.', () => {
  assert.throws(() => parseRoot(Buffer.alloc(64)), /cannot locate root window/);
});

test('X side does not respond to the connection → fails within a time limit and does not hang polling', async () => {
  const realConnect = net.connect;
  net.connect = () => neverConnectingSocket();
  try {
    const started = Date.now();
    // fallback: Normal implementation of 500 ms ×2 will fail; 3 s has not yet been implemented, indicating that the timeout logic does not take effect (the old version will hang forever)
    const watchdog = new Promise((_, reject) => {
      setTimeout(
        () => reject(new Error('Connection did not fail within the deadline (timeout guard failed)')),
        3000,
      ).unref?.();
    });
    await Promise.race([
      assert.rejects(createLinuxPointer({ display: ':0' }).probe(), /X11 connect timeout/),
      watchdog,
    ]);
    assert.ok(Date.now() - started < 3000);
  } finally {
    net.connect = realConnect;
  }
});
