/**
 * The mock host used for desktop Helper self-test only implements four read-only endpoints under the / dsh-pet-7340
 * prefix: resolved configuration, pressing petId to get animation, balance, and balance trigger count. Develop
 * self-test tools, not included in npm package. It does not simulate the user layer and file pets (the configuration
 * only returns the built-in default one), and it does not provide write operations, authentication and system
 * notifications (system notifications are independent capabilities of the browser side and follow the DSH web page's
 * own event flow and have nothing to do with desktop mode). Assets are always read from assets/webm in the package.
 * petId is only used as an attribution identifier and is not mapped to an independent asset directory. Must always:
 * The path parsed by thumb should stay within the asset root, and if it exceeds the limit, it will be 400. The port
 * takes the first parameter, the default is 8231; the entry point is npm run dev:mock.
 * @module dsh-pet/scripts/dev/mock-server
 */
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync, readFileSync } from 'node:fs';
import { join, resolve, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.argv[2] || 8231);
const here = resolve(fileURLToPath(new URL('.', import.meta.url)));
const PACKAGE_ROOT = resolve(here, '..', '..');
const WEBM_ROOT = join(PACKAGE_ROOT, 'assets', 'webm');
const CONFIG_FILE = join(PACKAGE_ROOT, 'assets', 'config.jsonc');

/** Strip JSONC annotation (same rules as stripJsonc of real host readAllConfig), return pure JSON. */
const stripJsonc = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^\\:])\/\/.*$/gm, '$1')
    .trim();

const sendJson = (res, status, body) => {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  });
  res.end(payload);
};

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const pathname = decodeURIComponent(url.pathname);

  if (pathname === '/dsh-pet-7340/balance') {
    // Simulate a DeepSeek balance of CNY 11.06 and vary the used ratio to exercise wallet animations.
    sendJson(res, 200, {
      ok: true,
      provider: 'deepseek',
      kind: 'deepseek',
      data: { currency: 'CNY', total: '11.06', granted: '5.00', toppedUp: '10.00' },
    });
    return;
  }

  if (pathname === '/dsh-pet-7340/balance/trigger') {
    sendJson(res, 200, { count: 0 });
    return;
  }

  // Finished product configuration: The mock environment has no user layer and file pets, so there is only the main
  // entry (equal to the built-in default, and the fields are retained as they are). The consumer reads according to
  // the structure of the resolved configuration without verification.
  if (pathname === '/dsh-pet-7340/config') {
    if (!existsSync(CONFIG_FILE)) {
      res.writeHead(404);
      res.end('no config.jsonc');
      return;
    }
    sendJson(res, 200, { main: JSON.parse(stripJsonc(readFileSync(CONFIG_FILE, 'utf8'))) });
    return;
  }

  // Animation file: / dsh-pet-7340/thumb /< petId >/< name >. webm, the same form as host route. petId is only used as
  // an ownership identifier, and mock is read from the unified asset root (the development environment does not
  // simulate independent asset directories); first peel off the petId segment and then parse it according to the file
  // name. You must confirm that the target is still within WEBM_ROOT before releasing it.
  if (pathname.startsWith('/dsh-pet-7340/thumb/')) {
    let rel = pathname.slice('/dsh-pet-7340/thumb/'.length);
    const slash = rel.indexOf('/');
    rel = slash >= 0 ? rel.slice(slash + 1) : rel;
    if (!rel || rel.length === 0) {
      res.writeHead(400);
      res.end('bad path');
      return;
    }
    const candidate = normalize(join(WEBM_ROOT, rel));
    const rootWithSep = WEBM_ROOT.endsWith(sep) ? WEBM_ROOT : WEBM_ROOT + sep;
    if (candidate !== WEBM_ROOT && !candidate.startsWith(rootWithSep)) {
      res.writeHead(400);
      res.end('bad path');
      return;
    }
    if (!existsSync(candidate)) {
      res.writeHead(404);
      res.end('asset not found');
      return;
    }
    const { size } = statSync(candidate);
    res.writeHead(200, {
      'content-type': 'video/webm',
      'content-length': size,
      'cache-control': 'public, max-age=3600',
    });
    createReadStream(candidate).pipe(res);
    return;
  }

  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end(`mock: not found ${pathname}`);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[mock-server] listening on http://127.0.0.1:${PORT}/dsh-pet-7340/`);
  console.log(`[mock-server] config:  http://127.0.0.1:${PORT}/dsh-pet-7340/config`);
  console.log(`[mock-server] assets:  ${WEBM_ROOT}`);
});
