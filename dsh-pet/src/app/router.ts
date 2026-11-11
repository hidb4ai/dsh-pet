/**
 * HTTP entry point for independent applications: plugin route, AI configuration page and status page share the same
 * local service.
 *
 * Only route and request boundaries (deduplicate, length limit, CORS, error fallback) are implemented, and the
 * business logic of each route is not implemented; it has no dependence on Electron, making it easy to directly test
 * invalid and untrusted requests. For pages and security modules that rely on standalone, security decisions are
 * always made before distribution.
 *
 * @module dsh-pet/src/app/router
 */

import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { RegisteredRoute } from '../standalone/context.ts';
import { boundedRequest, MAX_REQUEST_BYTES, MAX_SETTINGS_BYTES } from '../standalone/request-body.ts';
import { rejectRequest, type RequestSecurity } from '../standalone/request-security.ts';
import {
  balanceHandler,
  modelsHandler,
  settingsHandler,
  testHandler,
  setupHandler,
  type StandaloneServerOptions,
} from '../standalone/server.ts';
import { sendIcon } from '../standalone/server/respond.ts';
import { readChatPanelScript } from '../standalone/chat-panel-asset.ts';
import { readSettingsIcon } from '../standalone/icon.ts';
import { settingsPage, settingsScript, settingsStyle } from '../standalone/settings-page.ts';

/** route dependencies: security check, AI processor and data source of two pages, all injected to break away from Electron test. */
interface RouterDeps {
  security: RequestSecurity;
  ai?: StandaloneServerOptions['ai'];
  setup?: StandaloneServerOptions['setup'];
  log(message: string): void;
  status(port: number): unknown;
  landingPage(port: number): string;
  /** Dialog panel script source; `lib/chat-panel.js` is read in the package by default and can be injected into the test. */
  chatPanelScript?: () => string | undefined;
}

/**
 * Start the local service and return the actual port and shutdown function.
 *
 * Only listen to the random port 127.0.0.1; the request body is read according to the route limit before entering the
 * processor.
 */
export function startRouter(
  routes: RegisteredRoute[],
  deps: RouterDeps,
): Promise<{ port: number; close: () => Promise<void> }> {
  const settings = settingsHandler(deps.ai);
  const chatPanelScript = deps.chatPanelScript ?? readChatPanelScript;
  const tester = testHandler(deps.ai);
  const models = modelsHandler(deps.ai);
  const balance = balanceHandler(deps.ai);
  /** The AI route that comes with the standalone mode: the path is the lookup table of the processor. No matter how many entries there are, the branch nesting will not be deepened. */
  const aiRoutes: Record<string, typeof settings> = {
    '/standalone-ai/setup': setupHandler(deps.setup),
    '/standalone-ai/settings': settings,
    '/standalone-ai/test': tester,
    '/standalone-ai/models': models,
    '/standalone-ai/balance': balance,
  };
  let boundPort = 0;

  const server = createServer((req, res) => {
    let url: URL;
    try {
      url = new URL(req.url ?? '/', 'http://127.0.0.1');
    } catch {
      rejectRequest(res, 400, 'Invalid request URL');
      return;
    }
    const route = routes.find((candidate) =>
      candidate.kind === 'exact'
        ? url.pathname === candidate.path
        : url.pathname === candidate.path || url.pathname.startsWith(`${candidate.path}/`),
    );
    // Only the plugin route accepts requests from the file renderer, and it still requires its own credentials.
    if (!deps.security.authorize(req, res, !!route)) return;
    const method = req.method ?? 'GET';
    if (method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const dispatch = async (request: IncomingMessage): Promise<void> => {
      const assets: Record<string, readonly [string, string]> = {
        '/standalone-ai/': [settingsPage, 'text/html'],
        '/standalone-ai/settings.js': [settingsScript, 'text/javascript'],
        '/standalone-ai/settings.css': [settingsStyle, 'text/css'],
      };
      if (url.pathname === '/standalone-ai/icon.png') {
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
      if (url.pathname === '/standalone-ai/chat-panel.js') {
        if (method !== 'GET' && method !== 'HEAD') {
          rejectRequest(res, 405, 'GET required');
          return;
        }
        // It shares the same product with the CLI side: the settings page refers to it fixedly, and the absence of this route in the packaged application will leave the dialog area blank.
        const chatPanel = chatPanelScript();
        if (chatPanel === undefined) {
          rejectRequest(res, 404, 'Chat panel bundle missing; rebuild with npm run bundle');
          return;
        }
        sendText(res, 200, 'text/javascript', chatPanel);
        return;
      }
      const asset = assets[url.pathname];
      if (asset || url.pathname === '/health' || url.pathname === '/') {
        if (method !== 'GET' && method !== 'HEAD') {
          rejectRequest(res, 405, 'GET required');
          return;
        }
        if (asset) sendText(res, 200, asset[1], asset[0]);
        else if (url.pathname === '/health')
          sendText(res, 200, 'application/json', JSON.stringify(deps.status(boundPort)));
        else sendText(res, 200, 'text/html', deps.landingPage(boundPort));
        return;
      }
      const aiHandler = aiRoutes[url.pathname];
      if (aiHandler) {
        await aiHandler(request, res);
        return;
      }
      if (!route) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('not found');
        return;
      }
      // CORS only makes the authenticated file renderer available and does not grant any capabilities by itself.
      res.setHeader('access-control-allow-origin', '*');
      await route.handler(request, res);
    };

    const hasBody = req.headers['transfer-encoding'] !== undefined || Number(req.headers['content-length'] ?? 0) > 0;
    const bodyMethod = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
    void (async () => {
      if (hasBody || bodyMethod) {
        const limit = ['/standalone-ai/settings', '/standalone-ai/setup'].includes(url.pathname)
          ? MAX_SETTINGS_BYTES
          : MAX_REQUEST_BYTES;
        const bounded = await boundedRequest(req, res, limit);
        if (bounded) await dispatch(bounded);
      } else await dispatch(req);
    })().catch(() => {
      // The request body, address, and thrown value may all have credentials: logs remain general.
      deps.log('本机接口处理失败');
      if (!res.headersSent) rejectRequest(res, 500, 'The endpoint cannot process this request right now');
      else res.end();
    });
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  server.on('clientError', (_error, socket) => socket.destroy());

  return new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      boundPort = (server.address() as AddressInfo).port;
      resolvePromise({
        port: boundPort,
        close: async () => {
          server.closeAllConnections();
          await new Promise<void>((done) => server.close(() => done()));
        },
      });
    });
  });
}

/** Write a plain text response: Fixed turning off caching and sniffing to prevent page inline scripts from being loaded as resources. */
function sendText(res: ServerResponse, status: number, type: string, body: string): void {
  res.writeHead(status, {
    'content-type': `${type}; charset=utf-8`,
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  });
  res.end(body);
}
