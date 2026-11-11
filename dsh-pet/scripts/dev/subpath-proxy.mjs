/**
 * Sub-path deployment reproduction tool: strip off the prefix of `/app/DeepSeek-Harness/fngateway/*` and forward it to
 * the local machine DSH. Everything except the prefix will be 404 - the same conventions as reverse proxies such as
 * fnOS application gateway, used to reproduce issue #242. Develop self-test tools, not included in npm package.
 * Authentication is not implemented and the response body is not rewritten; Cookie and the request header are
 * transparently transmitted as they are, and only Host is rewritten, so the browser can directly reuse the existing
 * login status on the DSH site. The port, target and prefix are respectively argv [2..4], the default is 9090 → http
 * ://127.0.0.1:8080 → / app/DeepSeek-Harness/fngateway; the entry point is npm run dev:subpath.
 * @module dsh-pet/scripts/dev/subpath-proxy
 */
import { createServer, request } from 'node:http';
import { connect } from 'node:net';

const LISTEN_PORT = Number(process.argv[2] || 9090);
const TARGET = new URL(process.argv[3] || 'http://127.0.0.1:8080');
/** Remove the trailing slash: the prefix itself is not a requestable address, and the slashed form is completed by the redirect below. */
const PREFIX = (process.argv[4] || '/app/DeepSeek-Harness/fngateway').replace(/\/+$/, '');
/** Rewritten Host: The host verifies the signature Cookie according to the authority it recognizes, and the port must be consistent with the target. */
const UPSTREAM_AUTHORITY = `${TARGET.hostname}:${TARGET.port}`;

/** The upstream path after stripping the prefix; the mount root itself is mapped to `/`. */
function upstreamPath(url) {
  const rest = url.slice(PREFIX.length);
  return rest === '' ? '/' : rest;
}

const server = createServer((req, res) => {
  const url = req.url || '/';
  // The mount root without a trailing slash must be redirected: otherwise the document reference will be returned to the upper directory, and all relative requests will be incorrect.
  if (url === PREFIX || url.startsWith(PREFIX + '?')) {
    res.writeHead(301, { location: PREFIX + '/' + url.slice(PREFIX.length) });
    res.end();
    return;
  }
  if (!url.startsWith(PREFIX + '/')) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(`outside mount prefix: ${url}\n`);
    return;
  }
  const upstream = request(
    {
      host: TARGET.hostname,
      port: TARGET.port,
      method: req.method,
      path: upstreamPath(url),
      headers: { ...req.headers, host: UPSTREAM_AUTHORITY },
    },
    (answer) => {
      res.writeHead(answer.statusCode || 502, answer.headers);
      answer.pipe(res);
    },
  );
  upstream.on('error', (error) => {
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(`upstream error: ${error.message}\n`);
  });
  req.pipe(upstream);
});

// The WebSocket handshake is also subject to the prefix: the session event of DSH goes to ws. Without it, the page can be opened but the session cannot be connected.
server.on('upgrade', (req, socket, head) => {
  const url = req.url || '/';
  if (!url.startsWith(PREFIX + '/')) {
    socket.destroy();
    return;
  }
  const upstream = connect(Number(TARGET.port), TARGET.hostname, () => {
    const lines = [`GET ${upstreamPath(url)} HTTP/1.1`];
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      const name = req.rawHeaders[i];
      const value = name.toLowerCase() === 'host' ? UPSTREAM_AUTHORITY : req.rawHeaders[i + 1];
      lines.push(`${name}: ${value}`);
    }
    upstream.write(lines.join('\r\n') + '\r\n\r\n');
    if (head.length) upstream.write(head);
    upstream.pipe(socket);
    socket.pipe(upstream);
  });
  upstream.on('error', () => socket.destroy());
  socket.on('error', () => upstream.destroy());
});

server.listen(LISTEN_PORT, '127.0.0.1', () => {
  console.log(`Subpath environment ready: http://127.0.0.1:${LISTEN_PORT}${PREFIX}/`);
  console.log(`Upstream: ${TARGET.origin} (Host rewritten to ${UPSTREAM_AUTHORITY})`);
  console.log('Requests outside the prefix return 404, matching a real application gateway');
});
