/**
 * End-to-end contract: fake ctx + real apply + real `node:http` service.
 *
 * This layer answers "Does standalone mode run the plugin's own host half?" and verifies three things:
 * 1. The route prefix of `apply` register is indeed taken over by an independent service - there is only one route
 * table and no second set of implementation;
 * 2. The endpoints of the assets in the package are not dependent on the same shape as those in DSH (the path
 * conventions of `/state` , `/models` , and `/config/meta` );
 * 3. The conventions of path security and "configuration unreachable" are still established by the real HTTP
 * (independent services do not overwrite URL and do not swallow exceptions).
 *
 * The coverage limit is the same as `routes.test.ts` : in source code form, the package root is parsed into
 * `<pkg>/src` , and `assets/config.jsonc` in the package is unreachable → `readAllConfig` must be thrown. Therefore
 * there is no assertion of "off-the-shelf configuration" here, that path is covered by the end-to-end verification of
 * the build output ( `lib/standalone.js` ) (see the section Standalone Running of README).
 *
 * In order, listen first, then `apply` - exactly the same as CLI: the plugin's `launchHelper` depends on
 * `ctx.webServer.port > 0` . When the port is 0, it will only retry 500 ms and never open the desktop window.
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { packageRoot } from '../host/helper-process.ts';
import { apply } from '../host/index.ts';
import { createStandaloneContext, type RegisteredRoute, type StandaloneLogger } from './context.ts';
import { configPathsFor } from './options.ts';
import { listenStandaloneServer, type StandaloneServer } from './server.ts';
import { createRequestSecurity } from './request-security.ts';

/** Silent logger (the plugin will still print a small amount of warn to console. That is its own diagnosis and is not blocked here) */
const silent: StandaloneLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

let home = '';
let base = '';
let server: StandaloneServer | undefined;
let context: ReturnType<typeof createStandaloneContext> | undefined;
let savedHome: string | undefined;
let savedElectron: string | undefined;

before(async () => {
  home = mkdtempSync(join(tmpdir(), 'dsh-pet-standalone-'));
  savedHome = process.env.DSH_HOME;
  savedElectron = process.env.DSH_PET_ELECTRON_PATH;
  process.env.DSH_HOME = home;
  // Point to a real executable file: even if you pull up the branch, it will not actually download Electron
  process.env.DSH_PET_ELECTRON_PATH = process.execPath;

  const routes: RegisteredRoute[] = [];
  const portRef = { value: 0 };
  const created = createStandaloneContext({ port: () => portRef.value, logger: silent, routes });
  const listening = await listenStandaloneServer({
    routes,
    logger: silent,
    port: 0,
    // The same operation and maintenance information shape as CLI (this assertion comes with the field name used to verify CLI)
    status: () => ({ name: 'dsh-pet-standalone', plugin: { root: packageRoot } }),
  });
  // The sequence is exactly the same as CLI: first listen to get the port, then apply - the plugin's launchHelper depends on port > 0
  portRef.value = listening.port;
  apply(created.ctx);
  context = created;
  server = listening;
  base = `http://127.0.0.1:${listening.port}`;
});

after(async () => {
  // Release effect (stop Helper and clear two self-renewal polling timers) - if not released, node:test will not exit after running.
  await context?.dispose().catch(() => {});
  await context?.dispose().catch(() => {}); // Idempotent: repeated release must not throw an error
  await server?.close().catch(() => {});
  if (savedHome === undefined) delete process.env.DSH_HOME;
  else process.env.DSH_HOME = savedHome;
  if (savedElectron === undefined) delete process.env.DSH_PET_ELECTRON_PATH;
  else process.env.DSH_PET_ELECTRON_PATH = savedElectron;
  rmSync(home, { recursive: true, force: true });
});

/** Get the response of a plugin route */
async function get(path: string): Promise<{ status: number; text: string; json: () => unknown }> {
  const response = await fetch(`${base}${path}`);
  const text = await response.text();
  return { status: response.status, text, json: () => JSON.parse(text) as unknown };
}

test('real plugin chat routes cannot bypass the standalone capability using encoded names', async () => {
  const security = createRequestSecurity();
  const protectedServer = await listenStandaloneServer({
    routes: context?.routes ?? [],
    logger: silent,
    port: 0,
    security,
  });
  try {
    const prefix = `http://127.0.0.1:${protectedServer.port}/dsh-pet-7340/`;
    for (const name of ['chat', '%63hat', 'ch%61t']) {
      const response = await fetch(prefix + name + '?pet=main');
      assert.equal(response.status, 403);
      await response.text();
    }
    // When you bring valid credentials, the encoded name will go through the parameter verification of the real plugin and eventually report pet-required.
    const response = await fetch(prefix + '%63hat', { headers: { 'X-DSH-Pet-Token': security.token } });
    assert.equal(response.status, 200);
    assert.equal(((await response.json()) as { reason: string }).reason, 'pet-required');
  } finally {
    await protectedServer.close();
  }
});

test('config pet IDs: duplicate IDs return 200 + bad-request without creating a user file', async (t) => {
  const file = configPathsFor(packageRoot, home).userFile;
  assert.equal(existsSync(file), false);
  t.after(() => rmSync(file, { force: true }));
  const pet = {
    id: 'main',
    name: 'Blue',
    size: 240,
    balanceEnabled: false,
    display: 'web',
    position: { corner: 'top-right', marginX: 20, marginY: 20 },
  };
  for (const id of ['main', ' main ']) {
    const response = await fetch(`${base}/dsh-pet-7340/config`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pets: [pet, { ...pet, id, name: 'second' }] }),
    });
    assert.equal(response.status, 200);
    const body = (await response.json()) as { reason: string; message: string };
    assert.equal(body.reason, 'bad-request');
    assert.match(body.message, /^invalid pet config:/);
    assert.equal(existsSync(file), false);
  }
});

describe('The plugin host half is running in standalone mode.', () => {
  test('apply registers the plugin’s own route prefix (standalone mode does not write its own route table)', () => {
    const routes = context?.routes ?? [];
    assert.equal(
      routes.length,
      1,
      'The current plug-in only registers one prefix route; additional registers must be explicitly confirmed here.',
    );
    assert.equal(routes[0]?.kind, 'prefix');
    assert.equal(routes[0]?.path, '/dsh-pet-7340');
    assert.equal(typeof routes[0]?.handler, 'function');
  });

  test('/ state is endomorphic with DSH (standalone mode does not have any session events → leaves retain initial values)', async () => {
    const response = await get('/dsh-pet-7340/state');
    assert.equal(response.status, 200);
    const body = response.json() as {
      sections: Record<string, { counter: number; data: unknown }>;
      pets: Record<string, unknown>;
    };
    assert.deepEqual(Object.keys(body.sections).sort(), [
      'balance',
      'config',
      'focusSession',
      'menu',
      'notify',
      'workStatus',
    ]);
    assert.equal(body.sections.balance?.counter, 0);
    assert.equal(body.sections.balance?.data, null);
    assert.equal(body.sections.config?.counter, 0, 'No one has ever written a configuration change signal.');
    assert.deepEqual(body.pets, {});
  });

  test('/ models is an empty list (in standalone mode there is no llm service, but no error is reported or fails silently)', async () => {
    const response = await get('/dsh-pet-7340/models');
    assert.equal(response.status, 200);
    assert.deepEqual(response.json(), { providers: [] });
  });

  test('/ The path conventions of config/meta are exactly the same as options.configPathsFor (the image must not drift)', async () => {
    const response = await get('/dsh-pet-7340/config/meta');
    assert.equal(response.status, 200);
    const meta = response.json() as { user: string; default: string; animations: string };
    const paths = configPathsFor(packageRoot, home);
    // These three items are the derivation that the standalone mode physical examination (--check) relies on; if the plugin changes the path but options.ts does not follow, it will be red here
    assert.equal(meta.user, paths.userFile);
    assert.equal(meta.default, paths.defaultFile);
    assert.equal(meta.animations, join(home, 'dsh-pet', 'main-animation'));
  });
});

describe('Conventions when configuration and asset are unreachable - explicit failure, no silent fallback', () => {
  test('The default configuration in the package cannot be read (source code form) → / config 200 + generate-error entity', async () => {
    const response = await get('/dsh-pet-7340/config');
    assert.equal(
      response.status,
      200,
      'Interface unified 200, failure is placed in the entity: silently returning an empty configuration will make the desktop pet "look normal but have nothing"',
    );
    const body = response.json() as { ok?: boolean; reason?: string; message?: string };
    assert.equal(body.ok, false);
    assert.equal(body.reason, 'generate-error');
    assert.ok((body.message ?? '').length > 0, 'Error text must be readable');
  });

  test('The route security conventions of thumb still hold true for HTTP', async () => {
    // The backslash is not fragmented by pathname of URL, and will be directly entered into the path concatenate as petId - must be 400
    assert.equal((await get('/dsh-pet-7340/thumb/..%5C..%5Coutside/leak.webm')).status, 400);
    // Extension whitelist
    assert.equal((await get('/dsh-pet-7340/thumb/main/x.txt')).status, 400);
    // Non-existent asset (neither the main asset chain nor the exclusive directory can be found)
    assert.equal((await get(`/dsh-pet-7340/thumb/main/${encodeURIComponent('不存在.webm')}`)).status, 404);
  });

  test('The asset root of pic/memes is also not suitable for path fragments', async () => {
    assert.equal((await get('/dsh-pet-7340/pic/memes/..%5C..%5Coutside-memes/leak.png')).status, 400);
    assert.equal((await get('/dsh-pet-7340/pic/memes/main/nope.png')).status, 404);
  });
});

describe('Serve your own endpoint independently', () => {
  test('/ Report plugin version and port (operation and maintenance information, with cross-source)', async () => {
    const response = await fetch(`${base}/`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), '*');
    const body = (await response.json()) as { name: string; plugin: { root: string } };
    assert.equal(body.name, 'dsh-pet-standalone');
    assert.equal(body.plugin.root, packageRoot);
  });

  test('/ shutdown only returns 200 when there is no cleanup callback, which does not affect the continued operation of the service.', async () => {
    const response = await fetch(`${base}/shutdown`, { method: 'POST' });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, stopping: true });
    assert.equal(
      (await get('/dsh-pet-7340/state')).status,
      200,
      'No one in the test is actually down: the service should continue to be available',
    );
  });
});
