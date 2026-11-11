/**
 * Response tool: hit determination, JSON/file/error writeback.
 *
 * It does not determine the status code semantics (given by the processor), but is only responsible for persisting to
 * disk according to the format. This must always be true: you must confirm that the response has not ended before
 * writing back to avoid secondary writing.
 * @module dsh-pet/src/standalone/server/respond
 */
import { type RegisteredRoute, type StandaloneLogger } from '../context.ts';
import { type ServerResponse } from 'node:http';

/** Prefix route matches: exact is only congruent, prefix is allowed to be followed by sub-paths. */
export function matches(route: RegisteredRoute, pathname: string): boolean {
  if (route.kind === 'exact') return pathname === route.path;
  return pathname === route.path || pathname.startsWith(`${route.path}/`);
}

/** Return JSON; the probe allows cross-domain reading. */
export function sendJson(res: ServerResponse, status: number, body: unknown, cors = false): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    ...(cors ? { 'access-control-allow-origin': '*' } : {}),
  });
  res.end(payload);
}

/** Return to static resources, with CSP that only allows same-origin scripts, styles, and same-origin blob pictures. */
export function sendAsset(res: ServerResponse, body: string, type: string): void {
  res.writeHead(200, {
    'content-type': `${type}; charset=utf-8`,
    'content-length': Buffer.byteLength(body),
    // blob: only for avatar preview and voice playback: the image transport token fetch is converted to blob and
    // cannot be directly put into img src (the same source img without Origin will be judged as the file source).
    // media-src must be explicitly released blob:: The voice is synthesized and then converted to blob URL and then
    // handed over to < audio >. If this line is missing, it will fall back to default-src ' none ', which behaves like
    // NotSupportedError " no supported source" instead of 403. base-uri takes 'self': The settings page should use <
    // base href ="/"> to correct the document reference to the site root. The plugin route is under the root and not
    // in the / standalone-ai / directory; the same origin is still limited, and external base is not allowed.
    'content-security-policy':
      "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' blob:; media-src 'self' blob:; connect-src 'self'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'",
    'x-frame-options': 'DENY',
  });
  res.end(body);
}

/** Return to settings page label icon: binary PNG, does not participate in CSP and sniffing. */
export function sendIcon(res: ServerResponse, icon: Buffer): void {
  res.writeHead(200, {
    'content-type': 'image/png',
    'content-length': icon.length,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(icon);
}

/** Record and return a 500 without details. */
export function fail(res: ServerResponse, _error: unknown, logger: StandaloneLogger): void {
  // Vendor errors are never echoed or logged: there may be API keys or addresses with credentials.
  logger.error('Standalone route failed (details omitted to protect credentials)');
  if (res.headersSent) res.destroy();
  else sendJson(res, 500, { error: '本机服务暂时无法处理请求' });
}
