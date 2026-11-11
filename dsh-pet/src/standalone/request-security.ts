/**
 * Access boundary of local HTTP: loopback Host verification, CSRF verification and process capability token.
 *
 * Responsible for determining whether the request can enter the route and clearing the wide CORS header written by the
 * upstream; it does not handle business semantics. Must always be true: only the current loopback address is accepted;
 * the token only appears in the startup list, request headers and HttpOnly cookie, and never enters the log or
 * response body. After the settings page is accessed with a token for the first time, change the session to cookie.
 * When refreshing, there is no token in the address bar.
 * @module dsh-pet/src/standalone/request-security
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

/** Requesting a secure facade. */
export interface RequestSecurity {
  /** Process capability token, write-only enters the local startup list, never enters HTTP response or log. */
  readonly token: string;
  /** Generate settings page address with token. */
  authenticatedUrl(baseUrl: string): string;
  /** Determine whether the request is allowed; when rejected, the response has been written. */
  authorize(req: IncomingMessage, res: ServerResponse, allowFileOrigin?: boolean): boolean;
}

/** Return a structured error and return false, so that the caller can directly call return. */
export function rejectRequest(res: ServerResponse, status: number, error: string): false {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify({ error }));
  return false;
}

/** Read-only paths without tokens; write operations and sensitive paths must have tokens. */
function publicRead(req: IncomingMessage): boolean {
  // The plugin will decode the path before distribution, and authentication must use the same spelling judgment.
  const path = decodeURIComponent(new URL(req.url ?? '/', 'http://127.0.0.1').pathname);
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  if (['/standalone-ai/settings', '/shutdown'].includes(path)) return false;
  if (/^\/dsh-pet-\d+\/(?:whisper|chat)(?:\/|$)/.test(path)) return false;
  return (
    [
      '/',
      '/health',
      '/standalone-ai/',
      '/standalone-ai/settings.js',
      '/standalone-ai/settings.css',
      '/standalone-ai/chat-panel.js',
      '/standalone-ai/icon.png',
    ].includes(path) || /^\/dsh-pet-\d+\//.test(path)
  );
}

/** Setting page credentials cookie: issued after the first access with token, and replace the token cleared from the address bar when refreshing. */
const TOKEN_COOKIE = 'dsh_pet_token';

/** Fixed shape of token: 32 bytes base64url. Shape verification is run first, so that regular safety comparisons can have equal lengths. */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

/** Get the credentials of this service from the Cookie header; if not, return an empty string. */
function readTokenCookie(req: IncomingMessage): string {
  const raw = req.headers.cookie;
  if (typeof raw !== 'string') return '';
  for (const part of raw.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() !== TOKEN_COOKIE) continue;
    return part.slice(separator + 1).trim();
  }
  return '';
}

/** Create a request security facade. */
export function createRequestSecurity(): RequestSecurity {
  const token = randomBytes(32).toString('base64url');
  return {
    token,
    authenticatedUrl(baseUrl) {
      const base = new URL(baseUrl);
      if (
        base.protocol !== 'http:' ||
        !['127.0.0.1', 'localhost'].includes(base.hostname) ||
        base.username ||
        base.password
      ) {
        throw new Error('The settings URL must be a loopback HTTP address');
      }
      return `${base.origin}/standalone-ai/#token=${token}`;
    },
    authorize(req, res, allowFileOrigin = false) {
      const host = req.headers.host;
      const port = req.socket.localPort;
      if (!port || (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`)) {
        return rejectRequest(res, 403, 'Only the current loopback address is allowed');
      }
      // The file page renderer also needs a token: the sandbox web page will also send the null source. The same
      // renderer may load media without Origin at all, and only in this case is it allowed. For sub-resources such as
      // fonts that force CORS, Chromium is sent from the file:// page to `file://` itself - neither null nor omitted.
      // Omitting it will make the fonts of the packaged application all 403.
      const fileOrigin =
        allowFileOrigin &&
        (req.headers.origin === 'null' || req.headers.origin === undefined || req.headers.origin === 'file://');
      if (
        !fileOrigin &&
        ((req.headers.origin !== undefined && req.headers.origin !== `http://${host}`) ||
          req.headers['sec-fetch-site'] === 'cross-site')
      ) {
        return rejectRequest(res, 403, 'Cross-site requests are not allowed');
      }
      try {
        if (publicRead(req) && !fileOrigin) return true;
      } catch {
        return rejectRequest(res, 400, 'Invalid request URL');
      }
      // In-page requests use request headers; after refreshing, the address bar token has been cleared, and HttpOnly cookie obtained from the first visit will be used instead.
      const header = req.headers['x-dsh-pet-token'];
      const fromHeader = typeof header === 'string' && TOKEN_SHAPE.test(header);
      const supplied = fromHeader ? header : readTokenCookie(req);
      // First verify according to the fixed shape, and then perform regular safety comparison to avoid leakage of length and content.
      if (!TOKEN_SHAPE.test(supplied) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(token))) {
        return rejectRequest(res, 403, 'Reopen settings from the pet menu');
      }
      if (fromHeader && readTokenCookie(req) !== token) {
        // Session level cookie: If Max-Age is not set, it will become invalid when the browser is closed. Refreshing
        // within the same process will continue to be available. Path root: The dialog panel needs to adjust the /
        // dsh-pet -< n >/ chat plugin route. If it is limited to / standalone-ai /, it will not be able to get the
        // credentials.
        res.setHeader('set-cookie', `${TOKEN_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/`);
      }
      return true;
    },
  };
}

/** Clear the wide CORS header written by the upstream and add the security response header. */
export function secureResponse(res: ServerResponse, pathname?: string): void {
  const writeHead = res.writeHead.bind(res);
  const isPublicOp = pathname === '/' || pathname === '/health';
  res.writeHead = ((status: number, ...args: unknown[]) => {
    const filtered = isPublicOp
      ? args
      : args.map((value) => {
          if (Array.isArray(value)) {
            return value.reduce<string[]>((result, item, index) => {
              if (index % 2 === 0 && !String(item).toLowerCase().startsWith('access-control-')) {
                return [...result, String(item), String(value[index + 1])];
              }
              return result;
            }, []);
          }
          if (value !== null && typeof value === 'object') {
            return Object.fromEntries(
              Object.entries(value).filter(([name]) => !name.toLowerCase().startsWith('access-control-')),
            );
          }
          return value;
        });
    if (!isPublicOp) {
      for (const name of res.getHeaderNames()) {
        if (name.toLowerCase().startsWith('access-control-')) res.removeHeader(name);
      }
    }
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'no-referrer');
    res.setHeader('cache-control', 'no-store');
    return Reflect.apply(writeHead, res, [status, ...filtered]);
  }) as typeof res.writeHead;
}
