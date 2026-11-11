'use strict';
/**
 * Linux exclusive: X11 pointer position query (pure Node, no native module, no reliance on external commands). The
 * click-through window cannot receive mouse events, and screen.getCursorScreenPoint() on Linux/X11 returns the last
 * mouse event position cached by Chromium - it freezes after the window is built. Fallback polling uses stale
 * coordinates to count, and pets will never be able to interact. Here we go directly to the X11 protocol: connection
 * handshake (Xauthority of MIT-MAGIC-COOKIE-1) with QueryPointer, on failure get() returns null and the caller falls
 * back to the native API. QueryPointer returns physical pixels, divided by caller scaleFactor when scaling is not 1.
 * @module dsh-pet/runtime/electron-helper/x11-pointer
 */
const net = require('node:net');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/** QueryPointer request for screen root in X11 protocol (opcode 38) */
const QUERY_POINTER = 38;
/** QueryPointer response fixed 32 bytes */
const REPLY_BYTES = 32;

/**
 * Maximum timeout limit for three waits (milliseconds). The X server is on this machine, and it is normally within
 * milliseconds. The only possibility of being stuck is that the X side is dead or the socket is hung. If the timeout
 * occurs, the entire connection must be discarded and restarted: if you stay on the half-dead connection, inFlight
 * will always be true, and the pet will permanently stop at the old coordinates.
 */
const CONNECT_TIMEOUT_MS = 500;
const HANDSHAKE_TIMEOUT_MS = 1000;
const QUERY_TIMEOUT_MS = 500;

/** Get MIT-MAGIC-COOKIE-1 of display from Xauthority; if not, return null (anonymous connection) */
function readCookie(display) {
  const file = process.env.XAUTHORITY || path.join(os.homedir(), '.Xauthority');
  let buf;
  try {
    buf = fs.readFileSync(file);
  } catch {
    return null;
  }
  const m = /^(?:[^:]*):(\d+)(?:\.\d+)?$/.exec(display || '');
  const wantNum = m ? m[1] : null;
  let off = 0;
  let fallback = null;
  while (off + 2 <= buf.length) {
    try {
      const family = buf.readUInt16BE(off);
      off += 2;
      const readField = () => {
        const len = buf.readUInt16BE(off);
        off += 2;
        const value = buf.subarray(off, off + len);
        off += len;
        return value;
      };
      const addr = readField();
      const num = readField().toString('latin1');
      const name = readField().toString('latin1');
      const data = readField();
      if (name !== 'MIT-MAGIC-COOKIE-1') continue;
      const entry = { family, addr, num, name, data };
      if (wantNum !== null && num === wantNum) return entry;
      if (fallback === null) fallback = entry;
    } catch {
      break;
    }
  }
  return fallback;
}

/** Connecting to X11 socket: file system path first, Linux abstract namespace second (/tmp still available when remapped) */
function connect(display) {
  const num = (/^(?:[^:]*):(\d+)/.exec(display) || [])[1] || '0';
  const paths = [`/tmp/.X11-unix/X${num}`, `\u0000/tmp/.X11-unix/X${num}`];
  return new Promise((resolve, reject) => {
    let index = 0;
    const attempt = () => {
      if (index >= paths.length) {
        reject(new Error('cannot connect to display ' + display));
        return;
      }
      const socket = net.connect(paths[index++]);
      const fail = (error) => {
        socket.destroy();
        if (index < paths.length) attempt();
        else reject(error);
      };
      // Set timeout only in the connection phase: it must be set to 0 after connecting, otherwise the idle polling connection will be kicked out as timeout
      socket.setTimeout(CONNECT_TIMEOUT_MS);
      socket.once('timeout', () => fail(new Error('X11 connect timeout')));
      socket.once('connect', () => {
        socket.setTimeout(0);
        socket.off('error', fail);
        resolve(socket);
      });
      socket.once('error', fail);
    };
    attempt();
  });
}

/** Locate the root window of the first screen in the setup response body. Offset 0/16 Try both: some servers have more than 16 bytes prefix */
function parseRoot(body) {
  const pad = (n) => (4 - (n % 4)) % 4;
  for (const start of [0, 16]) {
    if (body.length < start + 16) continue;
    const vendorLen = body.readUInt16LE(start);
    if (vendorLen < 1 || vendorLen > 255) continue;
    const vendor = body.subarray(start + 16, start + 16 + vendorLen).toString('latin1');
    if (!/^[\x20-\x7e]+$/.test(vendor)) continue;
    const numScreens = body[start + 4];
    const numFormats = body[start + 5];
    if (numScreens < 1 || numFormats > 32) continue;
    const screenOff = start + 16 + vendorLen + pad(vendorLen) + numFormats * 8;
    if (screenOff + 4 > body.length) continue;
    const root = body.readUInt32LE(screenOff);
    if (root !== 0) return root;
  }
  throw new Error('cannot locate root window in X11 setup reply');
}

/** X11 connection handshake; successful return { socket , root } */
function handshake(display) {
  return connect(display).then(
    (socket) =>
      new Promise((resolve, reject) => {
        const cookie = readCookie(display);
        const name = cookie ? Buffer.from(cookie.name, 'latin1') : Buffer.alloc(0);
        const data = cookie ? cookie.data : Buffer.alloc(0);
        const pad = (n) => (4 - (n % 4)) % 4;
        const head = Buffer.alloc(12);
        head.write('l', 0, 'latin1');
        head.writeUInt16LE(11, 2);
        head.writeUInt16LE(0, 4);
        head.writeUInt16LE(name.length, 6);
        head.writeUInt16LE(data.length, 8);
        const setup = Buffer.concat([head, name, Buffer.alloc(pad(name.length)), data, Buffer.alloc(pad(data.length))]);

        let buffer = Buffer.alloc(0);
        const onData = (chunk) => {
          buffer = Buffer.concat([buffer, chunk]);
          if (buffer.length < 8) return;
          if (buffer[0] !== 1) {
            cleanup();
            socket.destroy();
            reject(new Error('X11 setup failed, status=' + buffer[0]));
            return;
          }
          const total = 8 + buffer.readUInt16LE(6) * 4;
          if (buffer.length < total) return;
          cleanup();
          try {
            resolve({ socket, root: parseRoot(buffer.subarray(8)) });
          } catch (error) {
            socket.destroy();
            reject(error);
          }
        };
        const onError = (error) => {
          cleanup();
          socket.destroy();
          reject(error);
        };
        // Handshaking is also waiting: X does not reply to setup. When responding, ensure() cannot be left hanging forever.
        const timeout = setTimeout(() => {
          cleanup();
          socket.destroy();
          reject(new Error('X11 handshake timeout'));
        }, HANDSHAKE_TIMEOUT_MS);
        timeout.unref?.();
        const cleanup = () => {
          clearTimeout(timeout);
          socket.off('data', onData);
          socket.off('error', onError);
        };
        socket.on('data', onData);
        socket.on('error', onError);
        socket.write(setup);
      }),
  );
}

/**
 * Create a polling-style pointer provider.
 *
 * @param options.intervalMs - query interval (default 60 ms).
 * @param options.display - X display (default is DISPLAY).
 * @returns get returns the coordinates (physical pixels) of the last successful query, which has not yet been
 * successfully queried for null, and start/stop/probe.
 */
function createLinuxPointer(options = {}) {
  const intervalMs = options.intervalMs ?? 60;
  const display = options.display || process.env.DISPLAY || ':0';
  let socket = null;
  let root = 0;
  let pending = null; // resolver currently answered by QueryPointer
  let buffer = Buffer.alloc(0);
  let last = null;
  let timer = null;
  let inFlight = false;
  let stopped = false;

  function reset() {
    if (socket) {
      socket.removeAllListeners();
      socket.destroy();
    }
    socket = null;
    root = 0;
    buffer = Buffer.alloc(0);
    if (pending) {
      pending.reject(new Error('connection reset'));
      pending = null;
    }
  }

  function ensure() {
    if (socket) return Promise.resolve();
    return handshake(display).then(({ socket: s, root: r }) => {
      socket = s;
      root = r;
      buffer = Buffer.alloc(0);
      s.on('data', (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        while (pending && buffer.length >= REPLY_BYTES) {
          const reply = buffer.subarray(0, REPLY_BYTES);
          buffer = buffer.subarray(REPLY_BYTES);
          const resolve = pending.resolve;
          pending = null;
          // The first bytes of the response must be 1 (Reply), otherwise it means that the protocol has been misaligned
          if (reply[0] !== 1) {
            resolve(null);
            continue;
          }
          resolve({ x: reply.readInt16LE(16), y: reply.readInt16LE(18) });
        }
      });
      s.on('error', reset);
      s.on('close', reset);
    });
  }

  function query() {
    return ensure().then(
      () =>
        new Promise((resolve, reject) => {
          // The response may never come (the X side is stuck): it will fail after timeout, and the entire connection
          // will be dropped by the caller reset. Late responses will remain in buffer and will be regarded as their
          // own results by the next query, and can only be cleared by reconnecting.
          const timer = setTimeout(() => {
            pending = null;
            reject(new Error('X11 QueryPointer timeout'));
          }, QUERY_TIMEOUT_MS);
          timer.unref?.();
          pending = {
            resolve: (point) => {
              clearTimeout(timer);
              resolve(point);
            },
            reject: (error) => {
              clearTimeout(timer);
              reject(error);
            },
          };
          const req = Buffer.alloc(8);
          req[0] = QUERY_POINTER;
          req.writeUInt16LE(2, 2);
          req.writeUInt32LE(root, 4);
          socket.write(req);
        }),
    );
  }

  function tick() {
    if (inFlight || stopped) return;
    inFlight = true;
    query()
      .then((point) => {
        if (point) last = point;
      })
      .catch(() => {
        reset();
      })
      .finally(() => {
        inFlight = false;
      });
  }

  return {
    get: () => last,
    start() {
      if (timer !== null || stopped) return;
      tick();
      timer = setInterval(tick, intervalMs);
      timer.unref?.();
    },
    stop() {
      stopped = true;
      if (timer !== null) clearInterval(timer);
      timer = null;
      reset();
    },
    /** Single query (for self-test/test) */
    probe: () =>
      handshake(display).then(
        ({ socket: s, root: r }) =>
          new Promise((resolve, reject) => {
            let buffer = Buffer.alloc(0);
            const timer = setTimeout(() => {
              s.destroy();
              reject(new Error('X11 QueryPointer timeout'));
            }, QUERY_TIMEOUT_MS);
            timer.unref?.();
            const onData = (chunk) => {
              buffer = Buffer.concat([buffer, chunk]);
              if (buffer.length < REPLY_BYTES) return;
              clearTimeout(timer);
              s.off('data', onData);
              s.destroy();
              resolve({ x: buffer.readInt16LE(16), y: buffer.readInt16LE(18) });
            };
            s.on('data', onData);
            s.on('error', (error) => {
              clearTimeout(timer);
              s.destroy();
              reject(error);
            });
            const req = Buffer.alloc(8);
            req[0] = QUERY_POINTER;
            req.writeUInt16LE(2, 2);
            req.writeUInt32LE(r, 4);
            s.write(req);
          }),
      ),
  };
}

module.exports = { createLinuxPointer, parseRoot };

if (require.main === module) {
  createLinuxPointer()
    .probe()
    .then(
      (point) => console.log(JSON.stringify(point)),
      () => process.exit(1),
    );
}
