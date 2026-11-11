/**
 * Request distribution and listener creation: match in route table order, and return 404 if not matched.
 *
 * No business judgment is made; whatever the processor returns is written. This must always be true: processor errors
 * will always be normalized to 500 and stack information will never be returned to the client.
 * @module dsh-pet/src/standalone/server/listener
 */
import { createRequestSecurity, rejectRequest, secureResponse, type RequestSecurity } from '../request-security.ts';
import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { settingsPage, settingsScript, settingsStyle } from '../settings-page.ts';
import { readChatPanelScript } from '../chat-panel-asset.ts';
import { readSettingsIcon } from '../icon.ts';
import { MAX_REQUEST_BYTES, MAX_SETTINGS_BYTES, boundedRequest } from '../request-body.ts';
import { type StandaloneLogger } from '../context.ts';
import { DEFAULT_STANDALONE_PORT, PORT_SCAN_LIMIT } from './options.ts';
import type { StandaloneServer, StandaloneServerOptions } from './options.ts';
import { balanceHandler, modelsHandler, settingsHandler, testHandler, setupHandler } from './handlers.ts';
import { fail, matches, sendAsset, sendIcon, sendJson } from './respond.ts';

/** Assemble the request dispatcher: first handle the probe, settings page and shutdown, and then hand it over to the plugin route. */
function dispatch(
  options: StandaloneServerOptions,
  shutdownSecurity?: RequestSecurity,
): (req: IncomingMessage, res: ServerResponse, pathname: string) => void {
  const settings = settingsHandler(options.ai);
  const tester = testHandler(options.ai);
  const models = modelsHandler(options.ai);
  const balance = balanceHandler(options.ai);
  const setup = setupHandler(options.setup);
  return (req, res, pathname) => {
    const method = req.method ?? 'GET';
    if (method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    if (pathname === '/' || pathname === '/health') {
      if (method !== 'GET' && method !== 'HEAD') {
        rejectRequest(res, 405, 'GET required');
        return;
      }
      sendJson(res, 200, options.status?.() ?? { name: 'dsh-pet-standalone' }, true);
      return;
    }
    if (pathname === '/shutdown') {
      if (method !== 'POST') {
        rejectRequest(res, 405, 'Use POST to shut down');
        return;
      }
      if (shutdownSecurity) {
        const supplied = req.headers['x-dsh-pet-token'];
        if (
          typeof supplied !== 'string' ||
          !/^[A-Za-z0-9_-]{43}$/.test(supplied) ||
          !timingSafeEqual(Buffer.from(supplied), Buffer.from(shutdownSecurity.token))
        ) {
          rejectRequest(res, 403, 'A token is required to shut down');
          return;
        }
      }
      sendJson(res, 200, { ok: true, stopping: true });
      queueMicrotask(() => options.onShutdown?.());
      return;
    }
    const assets: Record<string, readonly [string, string]> = {
      '/standalone-ai/': [settingsPage, 'text/html'],
      '/standalone-ai/settings.js': [settingsScript, 'text/javascript'],
      '/standalone-ai/settings.css': [settingsStyle, 'text/css'],
    };
    if (pathname === '/standalone-ai/icon.png') {
      if (method !== 'GET' && method !== 'HEAD') {
        rejectRequest(res, 405, 'GET required');
        return;
      }
      const icon = readSettingsIcon();
      if (!icon) {
        rejectRequest(res, 404, 'Icon not found');
        return;
      }
      sendIcon(res, icon);
      return;
    }
    if (pathname === '/standalone-ai/chat-panel.js') {
      if (method !== 'GET' && method !== 'HEAD') {
        rejectRequest(res, 405, 'GET required');
        return;
      }
      // The build output is released with the package; the lack of it can only be caused by not running bundle, and explicitly returning 404 instead of giving an empty script.
      const chatPanel = readChatPanelScript();
      if (chatPanel === undefined) {
        rejectRequest(res, 404, 'Chat panel bundle missing; rebuild with npm run bundle');
        return;
      }
      sendAsset(res, chatPanel, 'text/javascript');
      return;
    }
    const asset = assets[pathname];
    if (asset) {
      if (method !== 'GET' && method !== 'HEAD') {
        rejectRequest(res, 405, 'GET required');
        return;
      }
      sendAsset(res, asset[0], asset[1]);
      return;
    }
    if (pathname === '/standalone-ai/setup') {
      void setup(req, res).catch((error: unknown) => fail(res, error, options.logger));
      return;
    }
    if (pathname === '/standalone-ai/settings') {
      void settings(req, res).catch((error: unknown) => fail(res, error, options.logger));
      return;
    }
    if (pathname === '/standalone-ai/test') {
      void tester(req, res).catch((error: unknown) => fail(res, error, options.logger));
      return;
    }
    if (pathname === '/standalone-ai/models') {
      void models(req, res).catch((error: unknown) => fail(res, error, options.logger));
      return;
    }
    if (pathname === '/standalone-ai/balance') {
      void balance(req, res).catch((error: unknown) => fail(res, error, options.logger));
      return;
    }
    const route = options.routes.find((candidate) => matches(candidate, pathname));
    if (!route) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(
        `dsh-pet-standalone: No matching route (registered: ${options.routes.map((item) => item.path).join(', ') || 'none'})`,
      );
      return;
    }
    try {
      void Promise.resolve(route.handler(req, res)).catch((error: unknown) => fail(res, error, options.logger));
    } catch (error) {
      fail(res, error, options.logger);
    }
  };
}

/**
 * Create HTTP request listener.
 * @param options - Boot options.
 * @param injectedSecurity - Injected access check.
 * @returns listener.
 */
export function createRequestListener(
  options: StandaloneServerOptions,
  injectedSecurity?: RequestSecurity,
): (req: IncomingMessage, res: ServerResponse) => void {
  const security = options.security ?? injectedSecurity;
  const route = dispatch(options, security);
  return (req, res) => {
    let pathname: string;
    try {
      pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
    } catch {
      rejectRequest(res, 400, 'Invalid request URL');
      return;
    }
    secureResponse(res, pathname);
    if (security && !security.authorize(req, res)) return;
    // Do not record the path, fragment, query, body and authentication header to avoid writing the token into the log.
    options.logger.debug('Received a local HTTP request');
    const hasBody = req.headers['transfer-encoding'] !== undefined || Number(req.headers['content-length'] ?? 0) > 0;
    const bodyMethod = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method ?? '');
    // If there is a text or write method, bounded reading must be done first to prevent the plugin from reading infinitely.
    if ((hasBody || bodyMethod) && typeof req.on === 'function') {
      const limit = ['/standalone-ai/settings', '/standalone-ai/setup'].includes(pathname)
        ? MAX_SETTINGS_BYTES
        : MAX_REQUEST_BYTES;
      void boundedRequest(req, res, limit, options.bodyTimeoutMs)
        .then((bounded) => {
          if (bounded) route(bounded, res, pathname);
        })
        .catch((error: unknown) => fail(res, error, options.logger));
    } else route(req, res, pathname);
  };
}

/** Try one by one starting from the preferred port, only accept EADDRINUSE before continuing. */
async function bindFirstFree(server: HttpServer, preferred: number, logger: StandaloneLogger): Promise<number> {
  for (let port = preferred; port < preferred + PORT_SCAN_LIMIT; port += 1) {
    try {
      await new Promise<void>((accept, reject) => {
        const onError = (error: Error): void => {
          server.off('listening', onListening);
          reject(error);
        };
        const onListening = (): void => {
          server.off('error', onError);
          accept();
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(port, '127.0.0.1');
      });
      const address = server.address();
      const bound = typeof address === 'object' && address !== null ? address.port : port;
      // When the port is delayed, the reader will know that the final address is different from the requested one.
      if (preferred > 0 && bound !== preferred) logger.warn(`Port ${preferred} is busy; using ${bound}`);
      return bound;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error;
    }
  }
  throw new Error(`Starting at ${preferred}, all ${PORT_SCAN_LIMIT} consecutive ports are busy`);
}

/**
 * Create and start native services.
 * @param options - Boot options.
 * @returns monitored service.
 * @throws Thrown when multiple consecutive ports are occupied.
 */
export async function listenStandaloneServer(options: StandaloneServerOptions): Promise<StandaloneServer> {
  const security = options.security;
  const server = createServer(createRequestListener(options, security));
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  server.on('clientError', (_error, socket) => socket.destroy());
  const port = await bindFirstFree(server, options.port ?? DEFAULT_STANDALONE_PORT, options.logger);
  options.logger.info(`Standalone server listening at http://127.0.0.1:${port}/`);
  return {
    port,
    security: security ?? createRequestSecurity(),
    async close() {
      server.closeAllConnections();
      await new Promise<void>((accept) => server.close(() => accept()));
    },
  };
}
