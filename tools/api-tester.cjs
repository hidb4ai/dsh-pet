/**
 * Local proxy and browser console for the dsh-pet HTTP API.
 * The console and its proxy share an origin; API requests are forwarded to the configured DSH port.
 * Host authentication still applies. This development tool does not change the host's CORS policy.
 *
 * Usage:
 *   node tools/api-tester.cjs --no-open
 *   node tools/api-tester.cjs --port 3080 --proxy-port 8741
 * Use --dir to serve another static directory (default: tools/).
 *
 * The server binds to 127.0.0.1. POST /__upload?name=<filename> accepts raw file bytes and returns
 * a URL under /__uploads/. Uploads stay in the system temporary directory, outside the repository.
 * Uploaded media responses include CORS headers so a pet on another local port can fetch them.
 */
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const argv = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const PROXY_PORT = Number(argOf('--proxy-port', '8741'));
const ROOT_DIR = path.resolve(argOf('--dir', __dirname));
const PAGE = argOf('--page', 'api-tester.html');
const NO_OPEN = argv.includes('--no-open');

/** Forwarding target port: the input box on the test page can change it (via / __target), so it is in a variable state */
let hostPort = Number(argOf('--port', '3080'));

/** Routing prefix: consistent with ROUTE_PREFIX of src/host/index.ts (7340 is the name, not the port) */
const PREFIX = '/dsh-pet-7340';

/** This jump requires CORS headers. Note: **Only adds** to the local test agent and does not change the host behavior. */
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, PUT, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'access-control-max-age': '600',
};

/** The path that needs to be forwarded: the interface prefix itself + the proxy's own detection endpoint */
const isApi = (url) => url === PREFIX || url.startsWith(PREFIX + '/') || url.startsWith(PREFIX + '?');

/** Upload persist to disk directory: system temporary directory, outside the repository (the test page here acts as a "third-party managed asset") */
const UPLOAD_DIR = path.join(os.tmpdir(), 'dsh-pet-tester-uploads');
/** Limit each upload to 512 MiB to bound temporary disk usage. */
const UPLOAD_MAX = 512 * 1024 * 1024;
/** MIME used for upload/readback (`<video>` / `<img>` is decoded by it; unrecognized ones are streamed as binary) */
const UPLOAD_MIME = {
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.m4v': 'video/x-m4v',
  '.mkv': 'video/x-matroska',
  '.gif': 'image/gif',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

/** Forward a request to host and send the response (including CORS header) back to the browser */
function forward(req, res) {
  const target = `http://127.0.0.1:${hostPort}${req.url}`;
  const headers = { ...req.headers, host: `127.0.0.1:${hostPort}` };

  const upstream = http.request(target, { method: req.method, headers }, (up) => {
    // When forwarding, keep the upstream content-type, etc., and then overlay CORS; it will not be affected if the source station does not give content-length (chunked is passed as usual)
    res.writeHead(up.statusCode || 502, { ...up.headers, ...CORS });
    up.pipe(res);
  });

  upstream.on('error', (err) => {
    const msg =
      err.code === 'ECONNREFUSED'
        ? `Cannot connect to http://127.0.0.1:${hostPort}. Start DSH or change the port in the page or with --port.`
        : `Proxy request failed: ${err.message}`;
    res.writeHead(502, { 'content-type': 'application/json; charset=utf-8', ...CORS });
    res.end(JSON.stringify({ proxyError: msg, target }, null, 2));
  });

  req.pipe(upstream);
}

/**
 * Proxy your own small endpoint (**not** the dsh-pet interface, so put it outside the prefix): GET / __target → { port
 * } When the page starts, it asks "Which port to forward to now" POST / __target ? port = N → { port } The port input
 * box is changed on the page and the forwarding target is switched. This way, the test page can change the port
 * without restarting the agent.
 */
function handleTarget(req, res, url) {
  if (req.method === 'POST' || req.method === 'GET') {
    const p = Number(url.searchParams.get('port'));
    if (Number.isInteger(p) && p > 0 && p <= 65535) hostPort = p;
  }
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', ...CORS });
  res.end(JSON.stringify({ port: hostPort }));
}

/**
 * Receive an upload: the request body is the **original bytes** of the file (do not use multipart - save a parser, and
 * `fetch(url, { body: file })` can directly send File/Blob). Streaming persist to disk does not read the entire file
 * into memory.
 *
 * The returned url points to the proxy's own port - a **cross-origin** address for the DSH page, which is the path to
 * be tested.
 */
function handleUpload(req, res, url) {
  const json = (status, obj) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...CORS });
    res.end(JSON.stringify(obj));
  };
  if (req.method !== 'POST') return json(405, { ok: false, error: 'use POST' });

  // Only take the **base name** of the original file (strip off any path components to prevent traversal); the extension is retained - rely on it to determine MIME during readback
  const raw = path.basename(String(url.searchParams.get('name') || 'upload'));
  const ext = (path.extname(raw) || '.bin').toLowerCase();
  const name = Date.now().toString(36) + '-' + crypto.randomBytes(4).toString('hex') + ext;
  const file = path.join(UPLOAD_DIR, name);

  try {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  } catch (e) {
    return json(500, { ok: false, error: 'Could not create the upload directory: ' + e.message });
  }

  const out = fs.createWriteStream(file);
  let bytes = 0;
  let done = false;

  const fail = (status, msg) => {
    if (done) return;
    done = true;
    req.unpipe(out);
    out.destroy();
    fs.rm(file, { force: true }, () => {});
    // No destroy (req): Drain the remaining request body so that the client can see a clear status code instead of the connection being blocked.
    req.resume();
    json(status, { ok: false, error: msg });
  };

  req.on('data', (chunk) => {
    bytes += chunk.length;
    if (bytes > UPLOAD_MAX) fail(413, `File too large (limit: ${Math.round(UPLOAD_MAX / 1024 / 1024)} MB)`);
  });
  req.on('error', (e) => fail(400, 'Receive failed: ' + e.message));
  out.on('error', (e) => fail(500, 'Write failed: ' + e.message));
  out.on('finish', () => {
    if (done) return;
    if (!bytes) return fail(400, 'Empty file');
    done = true;
    json(200, { ok: true, url: `http://127.0.0.1:${PROXY_PORT}/__uploads/${name}`, bytes, name });
  });
  req.pipe(out);
}

/** Send back the file you just uploaded as it is. ** CORS must be given**: The browser-side asset uses fetch, and cross-origin depends on it. */
function serveUpload(req, res, name) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8', ...CORS });
    return res.end('use GET');
  }
  // path.basename Another trip: `/__uploads/..%2f..%2fsecret` This type of crossing is flattened before the path is assembled.
  const file = path.join(UPLOAD_DIR, path.basename(decodeURIComponent(name)));
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', ...CORS });
      return res.end('no such upload');
    }
    res.writeHead(200, {
      'content-type': UPLOAD_MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'content-length': st.size,
      // The file name is different every time it is uploaded, but the test page will be retransmitted repeatedly - no-store guarantees that you will always get the copy you just uploaded.
      'cache-control': 'no-store',
      ...CORS,
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

/** Static file (test page itself); anti-traversal verification has been done */
function serveStatic(req, res) {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/' || rel === '') rel = '/' + PAGE;
  const file = path.resolve(ROOT_DIR, '.' + rel);
  if (!file.startsWith(ROOT_DIR)) {
    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
    return res.end('forbidden');
  }
  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end('not found: ' + rel);
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(buf);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    return res.end();
  }
  if (url.pathname === '/__target') return handleTarget(req, res, url);
  // The agent acts as a "third-party asset custodian": upload + readback (all outside the prefix and will not be forwarded as the dsh-pet interface)
  if (url.pathname === '/__upload') return handleUpload(req, res, url);
  if (url.pathname.startsWith('/__uploads/')) {
    return serveUpload(req, res, url.pathname.slice('/__uploads/'.length));
  }
  if (isApi(req.url || '')) return forward(req, res);
  serveStatic(req, res);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\nPort ${PROXY_PORT} is busy. Try: node tools/api-tester.cjs --proxy-port 8742\n`);
  } else {
    console.error("\nProxy startup failed:" + err.message + '\n');
  }
  process.exit(1);
});

server.listen(PROXY_PORT, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${PROXY_PORT}/${PAGE}`;
  console.log('');
  console.log("  dsh-pet API tester");
  console.log('  ─────────────────────────────────────────────');
  console.log(`  Tester   ${url}`);
  console.log(`  Upstream http://127.0.0.1:${hostPort}${PREFIX}`);
  console.log(`  Uploads  ${UPLOAD_DIR}`);
  console.log("           Uploaded videos are served from /__uploads/,");
  console.log("           simulating third-party assets provided by URL.");
  console.log('');
  console.log("  Press Ctrl+C to quit");
  console.log('');

  if (NO_OPEN) return;
  // Windows uses start (note that the first empty parameter is the window title placeholder), macOS uses open, and the rest xdg-open
  const [cmd, args] =
    process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '', url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]];
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true }).unref();
  } catch {
    /* Even if it cannot be opened, the address has been printed on it. */
  }
});
