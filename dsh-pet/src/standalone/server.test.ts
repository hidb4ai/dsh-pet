/**
 * Contract testing for standalone mode HTTP service.
 *
 * This layer does not touch plugins (route injects fake handler): it nails the parts written by the standalone mode
 * - prefix transfer, operation and maintenance endpoints (`/`, `/health` , `/shutdown` ), exception centralize, port
 * deferral and shutdown release. The contract of the plugin route table itself is covered by integration.test.ts (the
 * one that comes from the real apply register).
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';

import type { RegisteredRoute, StandaloneLogger } from './context.ts';
import { createRequestListener, listenStandaloneServer } from './server.ts';
import { createRequestSecurity } from './request-security.ts';
const security = createRequestSecurity();

/** Silent logger (test assertion-only behavior) */
const silent: StandaloneLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

/** Minimum response stub: remember status code/response header/body, and support assertion "disconnected" */
class FakeRes {
  status = 0;
  headers: Record<string, string> = {};
  headersSent = false;
  destroyed = false;
  private readonly chunks: string[] = [];

  getHeaderNames(): string[] {
    return Object.keys(this.headers);
  }
  setHeader(name: string, value: string): void {
    this.headers[name] = value;
  }
  removeHeader(name: string): void {
    delete this.headers[name];
  }

  writeHead(status: number, headers?: Record<string, string>): this {
    this.status = status;
    this.headers = { ...this.headers, ...headers };
    this.headersSent = true;
    return this;
  }

  end(chunk?: string): void {
    if (typeof chunk === 'string') this.chunks.push(chunk);
  }

  destroy(): void {
    this.destroyed = true;
  }

  body(): string {
    return this.chunks.join('');
  }
}

/** Use fake req/res to drive the listener (no need to actually start socket) */
function call(listener: (req: IncomingMessage, res: ServerResponse) => void, url: string, method = 'GET'): FakeRes {
  const res = new FakeRes();
  // Only give the two fields that the listener can actually read (method/url); the remaining members are not touched by this test
  listener(
    {
      method,
      url,
      headers: { host: '127.0.0.1:3080', 'x-dsh-pet-token': security.token },
      socket: { localPort: 3080 },
    } as unknown as IncomingMessage,
    res as unknown as ServerResponse,
  );
  return res;
}

/** A "plugin" route: handler writes its own header to body (consistent with the contract of DSH WebServer) */
function pluginLikeRoute(onCall?: (url: string) => void): RegisteredRoute {
  return {
    kind: 'prefix',
    path: '/dsh-pet-7340',
    handler: (req, res) => {
      onCall?.(req.url ?? '');
      const payload = JSON.stringify({ ok: true, seen: req.url });
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(payload);
    },
  };
}

/** Occupy a port, return port number and shutdown function */
async function occupyPort(): Promise<{ port: number; close: () => Promise<void> }> {
  const server: Server = createServer((_req, res) => res.end('busy'));
  await new Promise<void>((accept) => server.listen(0, '127.0.0.1', () => accept()));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  return { port, close: () => new Promise<void>((accept) => server.close(() => accept())) };
}

describe('createRequestListener - transferred to plugin route', () => {
  test('The request under the prefix is handed over to the plugin handler as it is (URL contains the prefix and is cut by the plugin itself)', () => {
    let seen = '';
    const listener = createRequestListener({
      routes: [pluginLikeRoute((url) => (seen = url))],
      logger: silent,
      security,
    });
    const res = call(listener, '/dsh-pet-7340/config?force=1');
    assert.equal(res.status, 200);
    assert.equal(
      seen,
      '/dsh-pet-7340/config?force=1',
      'The plug-in handler must get the complete URL (its own slice prefix)',
    );
    assert.equal(res.body(), JSON.stringify({ ok: true, seen: '/dsh-pet-7340/config?force=1' }));
  });

  test('Outside the prefix → 404, and list the registered routes ("the plugin does not register" must be visible at a glance)', () => {
    const listener = createRequestListener({ routes: [pluginLikeRoute()], logger: silent, security });
    const res = call(listener, '/nope');
    assert.equal(res.status, 404);
    assert.match(res.body(), /\/dsh-pet-7340/, '404 text should be prefixed with register');
    assert.equal(
      res.headers['access-control-allow-origin'],
      undefined,
      'Cross-source reading is prohibited in independent mode',
    );
  });

  test('The routes of kind = exact are matched congruently and sub-paths are not included.', () => {
    const exact: RegisteredRoute = {
      kind: 'exact',
      path: '/dsh-pet-7340/state',
      handler: (_req, res) => {
        res.writeHead(200);
        res.end('exact');
      },
    };
    const listener = createRequestListener({ routes: [exact], logger: silent, security });
    assert.equal(call(listener, '/dsh-pet-7340/state').body(), 'exact');
    assert.equal(call(listener, '/dsh-pet-7340/state/extra').status, 404);
  });

  test('/ and / health → Operation JSON (custom status provider)', () => {
    const listener = createRequestListener({
      routes: [],
      logger: silent,
      security,
      status: () => ({ name: 'dsh-pet-standalone', port: 3080 }),
    });
    for (const path of ['/', '/health']) {
      const res = call(listener, path);
      assert.equal(res.status, 200);
      assert.deepEqual(JSON.parse(res.body()), { name: 'dsh-pet-standalone', port: 3080 });
      assert.equal(res.headers['access-control-allow-origin'], '*');
    }
  });

  test('OPTIONS → 204, no cross-source, and does not fall into the plugin handler', () => {
    let calls = 0;
    const listener = createRequestListener({
      routes: [pluginLikeRoute(() => (calls += 1))],
      logger: silent,
      security,
    });
    const res = call(listener, '/dsh-pet-7340/config', 'OPTIONS');
    assert.equal(res.status, 204);
    assert.equal(calls, 0, 'Preflight should not be included in the plug-in route');
    assert.equal(res.headers['access-control-allow-headers'], undefined);
  });

  test('/ shutdown → Return 200 first, and then trigger the cleanup callback (the caller must be able to get the response)', async () => {
    const reasons: string[] = [];
    const listener = createRequestListener({
      routes: [pluginLikeRoute()],
      logger: silent,
      security,
      onShutdown: () => reasons.push('shutdown'),
    });
    const res = call(listener, '/shutdown', 'POST');
    assert.equal(res.status, 200);
    assert.deepEqual(JSON.parse(res.body()), { ok: true, stopping: true });
    assert.deepEqual(
      reasons,
      [],
      'callback must be queued after the response (otherwise the caller may not wait for 200)',
    );
    await new Promise((accept) => setImmediate(accept));
    assert.deepEqual(reasons, ['shutdown']);
  });
});

describe('createRequestListener ——Exception centralize', () => {
  test('handler throws an error and does not write the header → 500 JSON (consistent with the plugin’s own 500 conventions)', () => {
    const exploding: RegisteredRoute = {
      kind: 'prefix',
      path: '/dsh-pet-7340',
      handler: () => {
        throw new Error('读盘失败');
      },
    };
    const res = call(createRequestListener({ routes: [exploding], logger: silent, security }), '/dsh-pet-7340/config');
    assert.equal(res.status, 500);
    assert.deepEqual(JSON.parse(res.body()), { error: '本机服务暂时无法处理请求' });
  });

  test('handler asynchronously rejects the same centralize as 500', async () => {
    const exploding: RegisteredRoute = {
      kind: 'prefix',
      path: '/dsh-pet-7340',
      handler: async () => {
        throw new Error('异步失败');
      },
    };
    const res = call(createRequestListener({ routes: [exploding], logger: silent, security }), '/dsh-pet-7340/config');
    await new Promise((accept) => setImmediate(accept));
    assert.equal(res.status, 500);
    assert.match(res.body(), /本机服务暂时无法处理请求/);
  });

  test('Header emitted failed: disconnected instead of writing bad response (consistent with wrong conventions of plugin sendFile)', () => {
    const partial: RegisteredRoute = {
      kind: 'prefix',
      path: '/dsh-pet-7340',
      handler: (_req, res) => {
        res.writeHead(200);
        res.end('前半段');
        throw new Error('写一半炸了');
      },
    };
    const res = call(createRequestListener({ routes: [partial], logger: silent, security }), '/dsh-pet-7340/x');
    assert.equal(res.status, 200, 'The header that has been written will not be rewritten.');
    assert.equal(res.destroyed, true, 'The connection must be disconnected after writing the header');
  });
});

describe('listenStandaloneServer - Port and shutdown', () => {
  const closers: Array<() => Promise<void>> = [];

  after(async () => {
    for (const close of closers.splice(0)) await close().catch(() => {});
  });

  test('When the preferred port is occupied, it will be postponed backward, and the port will be released after it is closed.', async () => {
    const blocker = await occupyPort();
    closers.push(blocker.close);
    const server = await listenStandaloneServer({
      routes: [pluginLikeRoute()],
      logger: silent,
      security,
      port: blocker.port,
    });
    closers.push(server.close);
    assert.ok(
      server.port > blocker.port,
      `Expected the next available port; got ${server.port} (occupied: ${blocker.port})`,
    );

    const response = await fetch(`http://127.0.0.1:${server.port}/`);
    assert.equal(response.status, 200);
    const body = (await response.json()) as { name?: string };
    assert.equal(body.name, 'dsh-pet-standalone');

    const port = server.port;
    await server.close();
    // The port must be released when closing: re-using the same port to start a service should be successful (keep-alive will be EADDRINUSE if the connection is not disconnected)
    const reuse = createServer((_req, res) => res.end('reused'));
    await new Promise<void>((accept, reject) => {
      reuse.once('error', reject);
      reuse.listen(port, '127.0.0.1', () => accept());
    });
    await new Promise<void>((accept) => reuse.close(() => accept()));
  });

  test('The plugin route is available via the real HTTP (200 under the prefix, 404 outside the prefix)', async () => {
    const server = await listenStandaloneServer({ routes: [pluginLikeRoute()], logger: silent, security, port: 0 });
    closers.push(server.close);
    const inside = await fetch(`http://127.0.0.1:${server.port}/dsh-pet-7340/state`, {
      headers: { 'X-DSH-Pet-Token': security.token },
    });
    assert.equal(inside.status, 200);
    const outside = await fetch(`http://127.0.0.1:${server.port}/whatever`, {
      headers: { 'X-DSH-Pet-Token': security.token },
    });
    assert.equal(outside.status, 404);
  });
});

describe('HTTP boundary protects every route and settings', () => {
  test('blocks attacks, paid GET, unauthenticated reads and legacy wildcard CORS', async () => {
    let calls = 0;
    const server = await listenStandaloneServer({
      port: 0,
      security,
      logger: silent,
      routes: [
        {
          kind: 'prefix',
          path: '/dsh-pet-7340',
          handler: (_req, res) => {
            calls++;
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.writeHead(200, { 'Access-Control-Allow-Origin': '*', 'access-control-allow-headers': '*' });
            res.end('ok');
          },
        },
      ],
    });
    try {
      const base = `http://127.0.0.1:${server.port}`;
      for (const path of ['/standalone-ai/settings', '/dsh-pet-7340/whisper', '/shutdown']) {
        assert.equal(
          (
            await fetch(base + path, {
              method: path === '/dsh-pet-7340/whisper' || path === '/shutdown' ? 'POST' : 'GET',
            })
          ).status,
          403,
        );
      }
      const headersList: Array<Record<string, string>> = [
        { Origin: 'https://evil.test' },
        { Origin: 'null' },
        { 'Sec-Fetch-Site': 'cross-site' },
      ];
      for (const headers of headersList) {
        assert.equal(
          (await fetch(base + '/health', { headers: { ...headers, 'X-DSH-Pet-Token': security.token } })).status,
          403,
          JSON.stringify(headers),
        );
      }
      const wrongHost = await new Promise<number>((resolve, reject) => {
        const req = httpRequest(base + '/health', { headers: { Host: 'evil.test' } }, (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        });
        req.on('error', reject);
        req.end();
      });
      assert.equal(wrongHost, 403);
      assert.equal(calls, 0);
      const response = await fetch(base + '/dsh-pet-7340/config', { headers: { 'X-DSH-Pet-Token': security.token } });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('access-control-allow-origin'), null);
      assert.equal(response.headers.get('access-control-allow-headers'), null);
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
      assert.equal((await fetch(base + '/shutdown', { headers: { 'X-DSH-Pet-Token': security.token } })).status, 405);
    } finally {
      await server.close();
    }
  });
  test('settings reads/saves are redacted, local-only, validated, bounded and rate limited', async () => {
    let saves = 0;
    const ai = {
      getSettings: () => ({ protocol: 'anthropic', model: 'x', hasKey: true, apiKey: 'secret-from-backend' }),
      saveSettings: async (input: unknown) => {
        saves++;
        return { ...(input as object), hasKey: true, apiKey: 'secret-from-backend' };
      },
      testConnection: async (input: { baseUrl?: string }) => {
        void input;
        return { ok: true, message: '连接成功', reply: 'pong' };
      },
      discoverModels: async (input: { baseUrl?: string }) => ({
        ok: true as const,
        models: [{ id: input.baseUrl ?? 'missing', name: 'M1' }],
      }),
      queryBalance: async () => ({
        ok: true as const,
        provider: 'deepseek-official',
        shape: 'money' as const,
        data: { wallets: [{ currency: 'CNY', total: '12.34', granted: '0.00', toppedUp: '12.34' }] },
      }),
    };
    const server = await listenStandaloneServer({ port: 0, security, logger: silent, routes: [], ai });
    try {
      const base = `http://127.0.0.1:${server.port}`;
      const headers = { 'X-DSH-Pet-Token': security.token, 'Content-Type': 'application/json' };
      const shell = await fetch(base + '/standalone-ai/');
      assert.equal(shell.status, 200);
      assert.match(shell.headers.get('content-security-policy') ?? '', /default-src 'none'/);
      assert.doesNotMatch(await shell.text(), new RegExp(security.token));
      // The label icon must be publicly readable: if the browser retrieves favicon with neither Origin nor token,
      // token verification will result in 403. In source code form, assets in the package is unreachable (PACKAGE_ROOT
      // points to src/). At this time, only 404 with clear semantics is required.
      const icon = await fetch(base + '/standalone-ai/icon.png');
      assert.notEqual(icon.status, 403, 'Icon must not require a token');
      assert.ok(
        icon.status === 404 || icon.headers.get('content-type') === 'image/png',
        'The icon is either missing 404 or PNG',
      );
      assert.equal((await fetch(base + '/standalone-ai/settings')).status, 403);
      const read = await fetch(base + '/standalone-ai/settings', { headers });
      assert.deepEqual(await read.json(), { protocol: 'anthropic', model: 'x', hasKey: true });
      for (const body of ['null', '{broken', '{"whisperIntervalSec":59}']) {
        assert.equal((await fetch(base + '/standalone-ai/settings', { method: 'POST', headers, body })).status, 400);
      }
      assert.equal(saves, 0);
      assert.equal(
        (
          await fetch(base + '/standalone-ai/settings', {
            method: 'POST',
            headers,
            body: JSON.stringify({ model: 'x'.repeat(17000) }),
          })
        ).status,
        413,
      );
      assert.equal(
        (
          await fetch(base + '/standalone-ai/settings', {
            method: 'POST',
            headers: { 'X-DSH-Pet-Token': security.token, 'Content-Type': 'text/plain' },
            body: '{}',
          })
        ).status,
        415,
      );
      const saved = await fetch(base + '/standalone-ai/settings', {
        method: 'POST',
        headers,
        body: JSON.stringify({ apiKey: '' }),
      });
      assert.equal(saved.status, 200);
      assert.deepEqual(await saved.json(), { hasKey: true });
      assert.equal(saves, 1);
      assert.equal((await fetch(base + '/standalone-ai/test')).status, 403);
      assert.equal((await fetch(base + '/standalone-ai/test', { headers })).status, 405);
      const testRes = await fetch(base + '/standalone-ai/test', { method: 'POST', headers, body: '{}' });
      assert.equal(testRes.status, 200);
      assert.deepEqual(await testRes.json(), { ok: true, message: '连接成功', reply: 'pong' });
      assert.equal((await fetch(base + '/standalone-ai/models')).status, 403);
      assert.equal((await fetch(base + '/standalone-ai/models', { headers })).status, 405);
      const modelsRes = await fetch(base + '/standalone-ai/models', {
        method: 'POST',
        headers,
        body: JSON.stringify({ protocol: 'openai-compatible', baseUrl: 'https://draft.test/v1', apiKey: 'k' }),
      });
      assert.equal(modelsRes.status, 200);
      // Echoing the draft address: Proves that the unsaved address in the form has been transferred to the discovery logic as it is.
      assert.deepEqual(await modelsRes.json(), { ok: true, models: [{ id: 'https://draft.test/v1', name: 'M1' }] });
      assert.equal((await fetch(base + '/standalone-ai/balance')).status, 403);
      assert.equal((await fetch(base + '/standalone-ai/balance', { headers })).status, 405);
      const balanceRes = await fetch(base + '/standalone-ai/balance', { method: 'POST', headers });
      assert.equal(balanceRes.status, 200);
      assert.equal((await balanceRes.json()).provider, 'deepseek-official');
      let last = 0;
      for (let i = 0; i < 25; i++)
        last = (await fetch(base + '/standalone-ai/settings', { method: 'POST', headers, body: '{}' })).status;
      assert.equal(last, 429);
    } finally {
      await server.close();
    }
  });
  test('even delegated plugin bodies are capped before handler invocation', async () => {
    let calls = 0;
    const server = await listenStandaloneServer({
      port: 0,
      security,
      logger: silent,
      routes: [
        pluginLikeRoute(() => {
          calls++;
        }),
      ],
    });
    try {
      const result = await fetch(`http://127.0.0.1:${server.port}/dsh-pet-7340/config`, {
        method: 'POST',
        headers: { 'X-DSH-Pet-Token': security.token },
        body: 'x'.repeat(1024 * 1024 + 1),
      });
      assert.equal(result.status, 413);
      assert.equal(calls, 0);
    } finally {
      await server.close();
    }
  });
});

test('bounded body replay preserves plugin readBody; chunked and stalled inputs never invoke handlers', async () => {
  let calls = 0;
  const server = await listenStandaloneServer({
    port: 0,
    security,
    logger: silent,
    bodyTimeoutMs: 30,
    routes: [
      {
        kind: 'prefix',
        path: '/plugin',
        handler: async (req, res) => {
          calls++;
          const chunks: Buffer[] = [];
          await new Promise<void>((resolve, reject) => {
            req.on('data', (chunk: Buffer) => chunks.push(chunk));
            req.once('end', resolve);
            req.once('error', reject);
          });
          res.end(Buffer.concat(chunks));
        },
      },
    ],
  });
  try {
    const url = `http://127.0.0.1:${server.port}/plugin`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'X-DSH-Pet-Token': security.token },
      body: '中文 body',
    });
    assert.equal(await response.text(), '中文 body');
    assert.equal(calls, 1);
    async function chunked(body: string): Promise<number> {
      return new Promise((resolve, reject) => {
        const req = httpRequest(
          url,
          { method: 'POST', headers: { 'X-DSH-Pet-Token': security.token, 'Transfer-Encoding': 'chunked' } },
          (res) => {
            res.resume();
            resolve(res.statusCode ?? 0);
            req.destroy();
          },
        );
        req.on('error', reject);
        req.write(body);
      });
    }
    assert.equal(await chunked('x'.repeat(1024 * 1024 + 1)), 413);
    assert.equal(await chunked('not finished'), 408);
    assert.equal(calls, 1);
  } finally {
    await server.close();
  }
});
