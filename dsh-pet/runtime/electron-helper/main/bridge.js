'use strict';
/**
 * The only channel with the host: bridge mode writes the renderer request as protocol walking stdout, and then opens a
 * local port to receive the host response; non-bridge (manual start-desktop / independent application) returns to HTTP
 * direct connection.
 *
 * The callback address and waiting response table are exclusively owned by this module. The caller only asks
 * callbackUrl() and sends hostRequest().
 * @module dsh-pet/runtime/electron-helper/main/bridge
 */

const fsPromises = require('node:fs/promises');
const { parseRange } = require('../range.js');

/**
 * Create bridge channel.
 *
 * @param deps.isBridge - Whether pulled up by the host in bridge mode.
 * @param deps.prefix - protocol line prefix (consistent with prefix for host helper-process).
 * @param deps.origin - host HTTP source in non-bridge mode.
 * @param deps.token - Access credentials for standalone applications (request headers only).
 */
function createBridge({ isBridge, prefix, origin, token }) {
  let bridgeSeq = 0;
  /** id -> { resolve , reject }: A request corresponds to a callback response from the host */
  const bridgePending = new Map();
  let bridgeCallbackUrl = '';

  /** renderer request → host (request line with callback URL); return host response ({ status, contentType ?, body ?, file ?}), timeout error */
  function bridgeRequest(method, url, body) {
    return new Promise((resolve, reject) => {
      const id = ++bridgeSeq;
      bridgePending.set(id, { resolve, reject });
      process.stdout.write(prefix + JSON.stringify({ id, method, url, body, cb: bridgeCallbackUrl }) + '\n');
      // If the host does not respond for a long time (the process exits/the host action is suspended), it does not hang indefinitely: 45 s fallback (LLM generates a maximum of 30-60 s)
      setTimeout(() => {
        const p = bridgePending.get(id);
        if (!p) return;
        bridgePending.delete(id);
        p.reject(new Error('bridge request timeout'));
      }, 45000).unref?.();
    });
  }

  /** Dispatch the host callback response ({ id, status, ...}) to the corresponding request */
  function bridgeResolve(resp) {
    const p = resp && bridgePending.get(resp.id);
    if (!p) return;
    bridgePending.delete(resp.id);
    p.resolve(resp);
  }

  /** Local callback server: host sends the response POST here (127.0.0.1 random port, bypassing the stdin/DSH gate) */
  function startBridgeCallback() {
    const http = require('node:http');
    const server = http.createServer((req, res) => {
      if (req.method !== 'POST' || req.url !== '/respond') {
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('dsh-pet: not found');
        return;
      }
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        try {
          bridgeResolve(JSON.parse(raw));
          res.writeHead(200, { 'content-type': 'text/plain' });
          res.end('ok');
        } catch {
          res.writeHead(400, { 'content-type': 'text/plain' });
          res.end('dsh-pet: bad payload');
        }
      });
      req.on('error', () => {
        res.writeHead(400, { 'content-type': 'text/plain' });
        res.end('dsh-pet: bad payload');
      });
    });
    server.on('error', (e) => {
      console.error('[dsh-pet-desktop-helper] bridge callback server error:', String(e && e.message ? e.message : e));
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      bridgeCallbackUrl = 'http://127.0.0.1:' + (addr && typeof addr === 'object' ? addr.port : 0) + '/respond';
      console.error('[dsh-pet-desktop-helper] bridge callback: ' + bridgeCallbackUrl);
    });
    return server;
  }

  /** Process a renderer request: spell host request line → wait for response → assemble Response (asset read disk) */
  async function handleBridgeRequest(request) {
    const url = new URL(request.url); // dsh-pet-bridge://dsh-pet/dsh-pet-7340/...
    const method = request.method || 'GET';
    let body;
    // PATCH also has a body (pending partial update): Missing the read will cause the host to receive an empty body and regard a normal modification as a bad JSON.
    if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
      body = await request.text();
    }
    const resp = await bridgeRequest(method, url.pathname + url.search, body);
    const headers = { 'access-control-allow-origin': '*' }; // The renderer page is file:// source, scheme cross-source requires CORS
    if (resp.contentType) headers['content-type'] = resp.contentType;
    if (resp.file) {
      // asset: Directly read the disk and return (the host has resolved the absolute path). In the middle of the
      // video, press `Range: bytes=N-` to fill in the data. Returning to the whole part will cause the player to piece
      // together the whole part as the second half, and ended will be advanced to the wrong position (the action is
      // cut off).
      try {
        const data = await fsPromises.readFile(resp.file);
        const decision = parseRange(request.headers.get('range'), data.length);
        if (decision === 'unsatisfiable') {
          return new Response(null, {
            status: 416,
            headers: { ...headers, 'content-range': `bytes */${data.length}`, 'accept-ranges': 'bytes' },
          });
        }
        if (decision !== null) {
          const slice = data.subarray(decision.start, decision.end + 1);
          return new Response(new Uint8Array(slice), {
            status: 206,
            headers: {
              ...headers,
              'content-length': String(slice.length),
              'content-range': `bytes ${decision.start}-${decision.end}/${data.length}`,
              'accept-ranges': 'bytes',
            },
          });
        }
        return new Response(new Uint8Array(data), {
          status: resp.status || 200,
          headers: { ...headers, 'content-length': String(data.length), 'accept-ranges': 'bytes' },
        });
      } catch (e) {
        console.error('[dsh-pet-desktop-helper] bridge file read failed:', resp.file, e);
        return new Response('dsh-pet: asset read failed', { status: 500, headers });
      }
    }
    return new Response(resp.body ?? '', { status: resp.status || 200, headers });
  }

  /** Communication with host handlePetRoute: bridge mode uses pipeline, manual start-desktop flow returns to HTTP direct connection */
  async function hostRequest(method, url, body) {
    if (isBridge) return bridgeRequest(method, url, body);
    const resp = await fetch(origin + url, {
      method,
      headers: {
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...(token ? { 'X-DSH-Pet-Token': token } : {}),
      },
      body,
    });
    return { status: resp.status, body: await resp.text() };
  }

  return {
    hostRequest,
    handle: handleBridgeRequest,
    startCallback: startBridgeCallback,
    callbackUrl: () => bridgeCallbackUrl,
  };
}

module.exports = { createBridge };
