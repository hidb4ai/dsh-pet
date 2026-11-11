/**
 * Route-level regression testing: `/dsh-pet-7340/thumb/<petId>/<file>` ’s path security and asset ownership.
 *
 * Why there is this separate layer: `petId` is the only user input in this route that directly enters the file path.
 * resolveAsset must be applied - the backslash decoded by `%5C` on Windows will not be cut by `rest.split('/')` ,
 * otherwise `..\..\` can read out of the user root disk. This document pins this invariant to the handler layer
 * (rather than just testing the pure function) to prevent "someone will write a new hand-written path in the future."
 *
 * Direct import source code ( `./index.ts` ) instead of `lib/` build output: the test does not depend on
 * `npm run build` ( lib / not included in the library). Cost: PACKAGE_ROOT in the module in source code form is
 * resolved to `<pkg>/src` , and assets in the package is unreachable, so this document only covers the thumb route;
 * the finished contract of `/config` is covered by the guard and end-to-end script of shared/config.test.ts.
 *
 * Use Node to build test runner (node:test) without introducing any npm dependencies.
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Writable } from 'node:stream';

import { apply } from './index.ts';
import { activeChatMemoryProvider } from './chat-memory-provider.ts';

/** Bait content outside the user root: Any response body that appears indicates that the root disk reading is successful. */
const SECRET = 'TOP-SECRET-BYTES';
/** pet pack own asset content */
const OWN = 'PETPACK-OWN-ASSET';
/** Main asset pool contents */
const MAIN = 'MAIN-POOL-ASSET';
/** Pictures in the user meme directory (sharing chain) */
const SHARED_PIC = 'SHARED-MEME-BYTES';
/** pet pack Exclusive pictures in the meme directory */
const OWN_PIC = 'PETPACK-OWN-MEME';
/** Chinese name pet pack (The warehouse clearly supports Chinese names, and the ASCII whitelist cannot be used for identifier verification) */
const CN_PET = '测试宠';

type Result = { status: number; body: string };

let dir = '';
let call: (url: string, method?: string, body?: string) => Promise<Result> = () =>
  Promise.reject(new Error('未初始化'));
let savedHome: string | undefined;
let savedElectron: string | undefined;
/** All effect release functions of apply() register (called in after: otherwise the resident timer will prevent the test process from exiting) */
const disposers: Array<() => void> = [];
/** apply() Service hung out through ctx.provide (external Cordis side of host side) */
const provided = new Map<string, unknown>();

/** Minimum response pile: writeHead records status code, Writable collects body (sendFile is written by pipe) */
class FakeRes extends Writable {
  declare status: number;
  declare chunks: Buffer[];
  constructor() {
    super();
    this.status = 0;
    this.chunks = [];
  }
  writeHead(status: number): this {
    this.status = status;
    return this;
  }
  _write(chunk: Buffer, _enc: BufferEncoding, cb: () => void): void {
    this.chunks.push(Buffer.from(chunk));
    cb();
  }
}

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'dsh-pet-routes-'));
  const home = join(dir, 'home');
  const userRoot = join(home, 'dsh-pet');
  // Valid asset: pet pack own directory (Chinese name) + main asset pool
  mkdirSync(join(userRoot, 'pet', `${CN_PET}-animation`), { recursive: true });
  writeFileSync(join(userRoot, 'pet', `${CN_PET}-animation`, 'test.webm'), OWN);
  mkdirSync(join(userRoot, 'main-animation', 'webm'), { recursive: true });
  writeFileSync(join(userRoot, 'main-animation', 'webm', 'mainidle.webm'), MAIN);
  // Meme: user directory (shared chain) + pet pack exclusive directory (owned by the same set of assets as <name>- animation /)
  mkdirSync(join(userRoot, 'memes'), { recursive: true });
  writeFileSync(join(userRoot, 'memes', '共用图.png'), SHARED_PIC);
  mkdirSync(join(userRoot, 'pet', `${CN_PET}-memes`), { recursive: true });
  writeFileSync(join(userRoot, 'pet', `${CN_PET}-memes`, '自家图.png'), OWN_PIC);
  // Bait outside user root: directory name ending in - animation / - memes, exactly what the old vulnerability could read
  mkdirSync(join(dir, 'outside-animation'), { recursive: true });
  writeFileSync(join(dir, 'outside-animation', 'leak.webm'), SECRET);
  mkdirSync(join(dir, 'outside-memes'), { recursive: true });
  writeFileSync(join(dir, 'outside-memes', 'leak.png'), SECRET);

  savedHome = process.env.DSH_HOME;
  savedElectron = process.env.DSH_PET_ELECTRON_PATH;
  process.env.DSH_HOME = home;
  // Hitting an existing file: Desktop Helper will not actually download/pull up no matter which branch you take.
  process.env.DSH_PET_ELECTRON_PATH = process.execPath;

  let handler: ((req: unknown, res: unknown) => Promise<void>) | undefined;
  const noop = (): void => {};
  apply({
    // Consistent with DSH: The return value of effect is the release function. Collect it here and call it in after()
    // - the plugin now has a resident timer (balance period refresh). If it is not released, the test process will
    // wait for it (it will not exit after running).
    effect: (fn: () => unknown) => {
      try {
        const dispose = fn();
        if (typeof dispose === 'function') disposers.push(dispose as () => void);
        return dispose;
      } catch {
        /* The built-in configuration is unreachable in source code form. refreshDesktop will be thrown to the caller - it will be swallowed here and will not affect the route register. */
      }
    },
    // External Cordis service (third-party register balance query): consistent with DSH, provide returns the release function
    provide: (name: string, value: unknown) => {
      provided.set(name, value);
      return noop;
    },
    on: () => noop,
    webServer: { register: (spec: { handler: typeof handler }) => ((handler = spec.handler), noop) },
    commands: { register: () => noop },
    logger: { warn: () => {}, info: () => {}, debug: () => {}, error: () => {} },
    // Fixed returning a "no registered balance interface" service provider: the path of POST /balance is therefore
    // certain (matchBalanceProvider misses → S is written as ok:false/unsupported, instead of going to fetch-error by
    // throwing an error)
    agentDefaultModel: { currentSelection: () => ({ provider: 'no-such-provider', model: 'x' }) },
    credentials: { resolve: async () => undefined },
    // The data source of the model list route (the host llm service with the same origin as the DSH model selector): a
    // normal service provider + a service provider that cannot list models (the single point of verification failure
    // does not bring down the entire list)
    llm: {
      listProviders: () => [
        { id: 'deepseek', name: 'DeepSeek' },
        { id: 'broken', name: 'Broken' },
      ],
      listModels: async (provider: string) => {
        if (provider === 'broken') throw new Error('adapter does not list models');
        return [{ id: 'deepseek-chat', name: 'DeepSeek Chat' }];
      },
    },
  });
  assert.ok(handler, 'apply () should register / dsh-pet-7340 prefix handler'); // If register fails, the entire test is meaningless.

  call = (url: string, method = 'GET', body?: string) =>
    new Promise<Result>((done) => {
      const res = new FakeRes();
      res.on('finish', () => done({ status: res.status, body: Buffer.concat(res.chunks).toString('utf8') }));
      // Request stub: 'end' must be called back, otherwise host to PUT/POST's readBody will never wait for the end
      // event, and the caller will hang directly. With body, 'data' is sent first and then 'end' (readBody waits for
      // both events).
      void handler?.(
        {
          method,
          url,
          // The real IncomingMessage always has headers; sendFile is used to read Range
          headers: {},
          on: (event: string, cb: (chunk?: Buffer) => void) => {
            if (event === 'data' && body !== undefined) queueMicrotask(() => cb(Buffer.from(body, 'utf8')));
            if (event === 'end') queueMicrotask(() => cb());
            return undefined;
          },
        },
        res,
      );
    });
});

after(() => {
  // Release the effect of the plugin register first (clear the balance period timer), otherwise the process will not exit after the test is run.
  for (const dispose of disposers.splice(0)) {
    try {
      dispose();
    } catch {
      /* Failure to release does not affect the rest of the cleanup */
    }
  }
  if (savedHome === undefined) delete process.env.DSH_HOME;
  else process.env.DSH_HOME = savedHome;
  if (savedElectron === undefined) delete process.env.DSH_PET_ELECTRON_PATH;
  else process.env.DSH_PET_ELECTRON_PATH = savedElectron;
  rmSync(dir, { recursive: true, force: true });
});

describe('/ models route - the data source of the "AI Model" drop-down box on the settings page', () => {
  test('Each service provider is returned together with the model under its name (same origin as DSH model selector)', async () => {
    const r = await call('/dsh-pet-7340/models');
    assert.equal(r.status, 200);
    const body = JSON.parse(r.body) as {
      providers: Array<{ id: string; name: string; models: Array<{ id: string; name: string }> }>;
    };
    assert.deepEqual(body.providers[0], {
      id: 'deepseek',
      name: 'DeepSeek',
      models: [{ id: 'deepseek-chat', name: 'DeepSeek Chat' }],
    });
  });

  test('A single service provider cannot list a model → just leave it empty without dragging down the entire list', async () => {
    const r = await call('/dsh-pet-7340/models');
    const body = JSON.parse(r.body) as { providers: Array<{ id: string; models: unknown[] }> };
    assert.equal(
      body.providers.length,
      2,
      'If a service provider cannot list a model, the entire list will not be empty.',
    );
    assert.deepEqual(body.providers[1].models, []);
  });

  test('Not GET → 405 (read-only endpoint)', async () => {
    const r = await call('/dsh-pet-7340/models', 'POST');
    assert.equal(r.status, 405);
  });
});

describe('/ state + / balance —— polling unified status and balance action endpoints', () => {
  test('GET /state returns { sections , pets } (initial leaf counter =0 / data = null )', async () => {
    const r = await call('/dsh-pet-7340/state');
    assert.equal(r.status, 200);
    const body = JSON.parse(r.body) as {
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
    assert.equal(
      body.sections.balance.counter,
      0,
      'counter =0 when no one writes it (the first pull of the front end is used as the baseline)',
    );
    assert.equal(body.sections.balance.data, null);
    assert.equal(
      body.sections.config.data,
      null,
      'No one has written the configuration change signal (counter =0 / data = null)',
    );
    assert.deepEqual(body.pets, {});
  });

  test('Not GET → 405 (read-only endpoint)', async () => {
    assert.equal((await call('/dsh-pet-7340/state', 'POST')).status, 405);
  });

  test('Only transmit since / Only transmit timeout → 200 + bad-request (required in pairs, the same set of conventions as wait/timeout / playback)', async () => {
    for (const q of ['since=0', 'timeout=1000']) {
      const r = await call('/dsh-pet-7340/state?' + q);
      assert.equal(r.status, 200, q);
      const body = JSON.parse(r.body) as { ok: boolean; reason: string };
      assert.equal(body.ok, false);
      assert.equal(body.reason, 'bad-request');
    }
  });

  test('Invalid since / timeout → 200 + bad-request (non-integer, negative number, decimal, exceeding upper limit)', async () => {
    for (const q of [
      'since=abc&timeout=1000',
      'since=-1&timeout=1000',
      'since=0&timeout=99999',
      'since=0&timeout=1.5',
    ]) {
      const r = await call('/dsh-pet-7340/state?' + q);
      assert.equal(r.status, 200, q);
      const body = JSON.parse(r.body) as { ok: boolean; reason: string };
      assert.equal(body.ok, false, q);
      assert.equal(body.reason, 'bad-request', q);
    }
  });

  test('since is different from the current version → return to full amount immediately (without suspending)', async () => {
    const r = await call('/dsh-pet-7340/state?since=12345&timeout=10000');
    assert.equal(r.status, 200);
    const body = JSON.parse(r.body) as { counter: number; sections: Record<string, unknown> };
    assert.equal(
      typeof body.counter,
      'number',
      'The response must carry the top level counter (the caller uses it as the since of the next tick)',
    );
    assert.ok(body.sections, 'When returning immediately, the same state is full');
  });

  test('since is the same as the current version + timeout =0 → take the pending branch but wake up on the next tick (equivalent to "return immediately")', async () => {
    const first = JSON.parse((await call('/dsh-pet-7340/state')).body) as { counter: number };
    const r = await call('/dsh-pet-7340/state?since=' + first.counter + '&timeout=0');
    assert.equal(r.status, 200);
    assert.equal(
      (JSON.parse(r.body) as { counter: number }).counter,
      first.counter,
      'No one has written → The version number remains unchanged',
    );
  });

  test('since is the same as the current version → **really hangs** and will not return until the point is reached (the core behavior of long polling)', async () => {
    const first = JSON.parse((await call('/dsh-pet-7340/state')).body) as { counter: number };
    const t0 = Date.now();
    const r = await call('/dsh-pet-7340/state?since=' + first.counter + '&timeout=200');
    const elapsed = Date.now() - t0;
    assert.equal(r.status, 200);
    // No one writes leaves → You can only wait for timeout. The purpose of this use case is to prove that "hang" is
    // not empty talk: all other use cases use timeout =0, taking the same branch but not really waiting.
    assert.ok(elapsed >= 180, `It should really hang about 200 ms, measured ${elapsed} ms`);
  });

  test('POST /balance is an action endpoint: only { ok : true } is returned, no balance data is returned', async () => {
    const r = await call('/dsh-pet-7340/balance', 'POST');
    assert.equal(r.status, 200);
    assert.deepEqual(JSON.parse(r.body), { ok: true }, 'Action endpoints must not stuff balance data into responses');
  });

  test('GET /balance deleted → 405 (data only has one export / state)', async () => {
    assert.equal((await call('/dsh-pet-7340/balance', 'GET')).status, 405);
  });

  test('After POST /balance: the balance appears in S and is marked with manual (the front end must play a text description accordingly)', async () => {
    await call('/dsh-pet-7340/balance', 'POST');
    const r = await call('/dsh-pet-7340/state');
    const leaf = (JSON.parse(r.body) as { sections: { balance: { counter: number; data: Record<string, unknown> } } })
      .sections.balance;
    assert.ok(leaf.counter > 0, 'The action must advance counter (otherwise the front end will not render)');
    assert.equal(
      leaf.data.ok,
      false,
      'The service provider has not registered the balance interface → the unavailable status is also written in S',
    );
    assert.equal(leaf.data.reason, 'unsupported');
    assert.equal(leaf.data.manual, true, 'Manually triggered tags must be written with the data');
  });

  test('old / balance/trigger deleted → no longer an endpoint (falls to asset fallback → 404)', async () => {
    const r = await call('/dsh-pet-7340/balance/trigger');
    assert.notEqual(r.status, 200, 'The trigger count endpoint should have been removed');
  });
});

describe('polling Old endpoints deleted after unification - cannot be revived', () => {
  // These endpoints have all been merged into GET /state, there is no longer a separate client polling loop, and the
  // old endpoints must not be resurrected. This guard is kept to prevent "adding back another / xxx polling endpoint"
  // (that's what we want to eliminate this time). NOTE / broadcast is not listed here: it is a POST write endpoint
  // (see dedicated grouping below), the guard here only requires that it is no longer a GET read endpoint.
  for (const path of ['/dsh-pet-7340/notify']) {
    test(`${path} has been removed (GET is no longer an endpoint)`, async () => {
      const r = await call(path);
      assert.notEqual(r.status, 200, `${path} should have been merged into / state`);
    });
  }

  test('The GET read endpoint for /work-status has been removed (now the POST/DELETE write endpoint)', async () => {
    assert.equal((await call('/dsh-pet-7340/work-status')).status, 405);
  });

  test('The GET read endpoint of /broadcast has been deleted (the data has only one outlet of /state)', async () => {
    assert.equal((await call('/dsh-pet-7340/broadcast')).status, 405);
  });

  test('/ whisper only accepts POST (the read endpoint has been deleted, GET no longer returns text)', async () => {
    assert.equal((await call('/dsh-pet-7340/whisper?pet=main', 'GET')).status, 405);
  });

  test('/ whisper/trigger deleted (manual whisper merged into POST /whisper)', async () => {
    const r = await call('/dsh-pet-7340/whisper/trigger?pet=main');
    assert.notEqual(r.status, 200);
  });
});

describe('/broadcast - Third-party feeding (POST write endpoint, issue #76)', () => {
  // Coverage description: In the source code form of this file, PACKAGE_ROOT is parsed as < pkg >/ src. assets in the
  // package is not reachable, so readAllConfig must throw an error - "Successfully written into pets.< id >. say".
  // That path cannot be tested here. The verification rules (pets exist/images are in the pool) are covered by the
  // single test of broadcast.test.ts's decision-making layer; here only the behavior contract of the route layer is
  // nailed down: methods, JSON parsing, short-circuit order, and explicit failure when the configuration is
  // unreachable.

  test('POST empty text → HTTP 200 + ok:false/bad-request (failure can be determined without reading the configuration first short-circuit)', async () => {
    const r = await call('/dsh-pet-7340/broadcast?pet=main', 'POST', JSON.stringify({ text: '   ' }));
    assert.equal(r.status, 200, 'Business failure takes 200 + ok:false, the same conventions as / chat');
    const body = JSON.parse(r.body) as { ok: boolean; reason: string };
    assert.equal(body.ok, false);
    assert.equal(body.reason, 'bad-request', 'Empty text must be blocked before reading configuration');
  });

  test('text non-character string (number/object/missing field) → Same as bad-request', async () => {
    for (const payload of [{ text: 123 }, { text: {} }, { text: null }, {}]) {
      const r = await call('/dsh-pet-7340/broadcast?pet=main', 'POST', JSON.stringify(payload));
      assert.equal(r.status, 200);
      assert.equal((JSON.parse(r.body) as { reason: string }).reason, 'bad-request', JSON.stringify(payload));
    }
  });

  test('The request body is not valid JSON → 400 (same processing as / config parsing failure)', async () => {
    const r = await call('/dsh-pet-7340/broadcast?pet=main', 'POST', '{ 不是 json');
    assert.equal(r.status, 400);
    assert.match(r.body, /invalid JSON body/);
  });

  test('Do not be silent when the configuration is unreachable: explicit ok:false/generate-error (do not pretend that feeding is successful)', async () => {
    const r = await call('/dsh-pet-7340/broadcast?pet=main', 'POST', JSON.stringify({ text: '该喝水了' }));
    assert.equal(r.status, 200);
    const body = JSON.parse(r.body) as { ok: boolean; reason: string };
    assert.equal(
      body.ok,
      false,
      'If the configuration cannot be read, ok:true must not be returned - otherwise the caller will think that the bubble has been fed.',
    );
    assert.equal(body.reason, 'generate-error');
  });

  test('Invalid duration → bad-request, and short-circuit before reading the configuration (not generate-error)', async () => {
    // In conjunction with the premise of "configuration unreachable" in this file: if the duration verification is
    // placed after the read configuration, these items will become generate-error - assertion reason will verify the
    // short-circuit sequence at the same time.
    for (const duration of [-1, -0.5, '3000', {}, [], true]) {
      const r = await call('/dsh-pet-7340/broadcast?pet=main', 'POST', JSON.stringify({ text: '该喝水了', duration }));
      assert.equal(r.status, 200, `duration=${JSON.stringify(duration)}`);
      assert.equal(
        (JSON.parse(r.body) as { reason: string }).reason,
        'bad-request',
        `duration = ${JSON.stringify(duration)} should be blocked before reading the configuration`,
      );
    }
  });
});

describe('/bubble/clear - clear bubble (POST write endpoint, issue #122 item 5)', () => {
  // Like /broadcast tests, source-mode readAllConfig throws before successful publication to pets.<id>.say can be
  // tested.
  // broadcast.test.ts covers pet selection through decideBubbleClear. Here verify the route method, absent request
  // body and failure response.

  test('GET → 405 (clear is an action endpoint, not a read endpoint)', async () => {
    assert.equal((await call('/dsh-pet-7340/bubble/clear?pet=main')).status, 405);
  });

  test('No request body will be accepted as usual (unlike / broadcast which requires JSON body)', async () => {
    const r = await call('/dsh-pet-7340/bubble/clear?pet=main', 'POST');
    assert.notEqual(
      r.status,
      400,
      'This endpoint does not parse the request body. It should not result in 400 because "body was not given"',
    );
  });

  test('Do not silence when configuration is unreachable: explicit ok:false/generate-error (do not pretend bubble is clear)', async () => {
    const r = await call('/dsh-pet-7340/bubble/clear?pet=main', 'POST');
    assert.equal(r.status, 200);
    const body = JSON.parse(r.body) as { ok: boolean; reason: string };
    assert.equal(
      body.ok,
      false,
      'If the configuration cannot be read, ok:true must not be returned - otherwise the caller will think that the bubble has been closed.',
    );
    assert.equal(body.reason, 'generate-error');
  });
});

describe('/ anim - playback request animation (POST write endpoint)', () => {
  // The coverage is the same as / broadcast: In source code form, PACKAGE_ROOT is parsed as < pkg >/ src, and
  // readAllConfig will inevitably throw an error, so the path "Successfully written into pets.< id >. anim" cannot be
  // tested here (name verification and pet selection are by Decision-making layer single test coverage of
  // anim.test.ts). Only the route layer contracts are nailed here: methods, JSON parsing, failure conventions.

  test('GET → 405 (playback request is an action endpoint, not a read endpoint)', async () => {
    assert.equal((await call('/dsh-pet-7340/anim?pet=main')).status, 405);
  });

  test('The request body is not valid JSON → 400', async () => {
    const r = await call('/dsh-pet-7340/anim?pet=main', 'POST', '{ 不是 json');
    assert.equal(r.status, 400);
    assert.match(r.body, /invalid JSON body/);
  });

  test('Do not be silent when configuration is unreachable: explicit ok:false/generate-error (do not pretend to have playback request)', async () => {
    const r = await call('/dsh-pet-7340/anim?pet=main', 'POST', JSON.stringify({ name: '东张西望' }));
    assert.equal(r.status, 200);
    const body = JSON.parse(r.body) as { ok: boolean; reason: string };
    assert.equal(
      body.ok,
      false,
      'If the configuration cannot be read, ok:true must not be returned - otherwise the caller will think that the animation has been playback request',
    );
    assert.equal(body.reason, 'generate-error');
  });
});

describe('/ position + / throw —— Position and throwing instructions (POST write endpoint)', () => {
  // The coverage is the same as / anim: In source code form, PACKAGE_ROOT is parsed as < pkg >/ src, and readAllConfig
  // must throw an error, so "Successfully written pets .< id >. position / pets .< id >. throw "That path cannot be
  // tested here (parameter verification, coordinate clamping and pet analysis are covered by the single test of the
  // decision-making layer of motion-cue.test.ts). Only the route layer contracts are nailed here: methods, JSON
  // parsing, failure conventions.

  test('GET → 405 (both are action endpoints, not read endpoints)', async () => {
    assert.equal((await call('/dsh-pet-7340/position?pet=main')).status, 405);
    assert.equal((await call('/dsh-pet-7340/throw?pet=main')).status, 405);
  });

  test('The request body is not valid JSON → 400', async () => {
    for (const path of ['position', 'throw']) {
      const r = await call(`/dsh-pet-7340/${path}?pet=main`, 'POST', '{ 不是 json');
      assert.equal(r.status, 400, path);
      assert.match(r.body, /invalid JSON body/);
    }
  });

  test('Not silent when configuration is unreachable: explicit ok:false/generate-error (does not pretend to have been moved/thrown)', async () => {
    const pos = await call(
      '/dsh-pet-7340/position?pet=main',
      'POST',
      JSON.stringify({ x: 0.5, y: 0.5, mode: 'spring' }),
    );
    assert.equal(pos.status, 200);
    const posBody = JSON.parse(pos.body) as { ok: boolean; reason: string };
    assert.equal(
      posBody.ok,
      false,
      'If the configuration cannot be read, ok:true must not be returned - otherwise the caller will think that the pet has moved there.',
    );
    assert.equal(posBody.reason, 'generate-error');

    const thr = await call('/dsh-pet-7340/throw?pet=main', 'POST', JSON.stringify({ angle: 45, power: 1 }));
    assert.equal(thr.status, 200);
    const thrBody = JSON.parse(thr.body) as { ok: boolean; reason: string };
    assert.equal(
      thrBody.ok,
      false,
      'If you cannot read the configuration, you must not return ok:true - otherwise the caller will think that the pet has flown out.',
    );
    assert.equal(thrBody.reason, 'generate-error');
  });

  test('Empty request body (not an object) → Do not throw, fail conventions', async () => {
    const r = await call('/dsh-pet-7340/position?pet=main', 'POST', 'null');
    assert.equal(r.status, 200);
    assert.equal((JSON.parse(r.body) as { ok: boolean }).ok, false);
  });
});

describe('thumb route——The valid path is as usual (no accidental killing during repair)', () => {
  test('pet pack own asset: Chinese name petId returns normally', async () => {
    const r = await call(`/dsh-pet-7340/thumb/${encodeURIComponent(CN_PET)}/test.webm`);
    assert.equal(r.status, 200);
    assert.equal(r.body, OWN);
  });

  test('Main asset chain: main asset root is still readable', async () => {
    const r = await call('/dsh-pet-7340/thumb/main/mainidle.webm');
    assert.equal(r.status, 200);
    assert.equal(r.body, MAIN);
  });

  test('Non-existent asset root → 404 (behavior consistent with "no separate asset directory")', async () => {
    const r = await call('/dsh-pet-7340/thumb/nosuchpet/x.webm');
    assert.equal(r.status, 404);
  });
});

describe('thumb route - petId is an inappropriate path fragment (invariant of PR #53)', () => {
  test('%5 C backslash traversal ( Windows ) → 400, and never read outside the user root', async () => {
    const r = await call('/dsh-pet-7340/thumb/..%5C..%5C..%5Coutside/leak.webm');
    assert.equal(r.status, 400);
    assert.equal(r.body.includes(SECRET), false, 'Unrooted content must not appear in the response body');
  });

  test('%2 F forward slash is cut into multiple segments: petId only ".." is left, the identifier rule is rejected on the spot → 400', async () => {
    // Note the difference with %5 C: forward slashes are involved in split ('/'), petId only has '..'. The dot itself
    // is a valid identifier character, but '.' and '..' as directory names will push the asset root to the upper
    // layer, so isValidPetId is blocked alone - earlier than the root verification of the second layer resolveExisting
    // (the traversal of the name segment is still handled by that layer, see the next use case).
    const r = await call('/dsh-pet-7340/thumb/..%2F..%2F..%2Foutside/leak.webm');
    assert.equal(r.status, 400);
    assert.equal(r.body.includes(SECRET), false);
  });

  test('Colon / control character is also rejected as an invalid identifier', async () => {
    for (const bad of ['C%3A%5CWindows', '%00null']) {
      const r = await call(`/dsh-pet-7340/thumb/${bad}/leak.webm`);
      assert.equal(r.status, 400, `petId = ${bad} should be 400`);
    }
  });

  test('Double encoding will not be decoded twice (only decode once) → 404 and does not exceed the root', async () => {
    // %255 C is solved once as the literal "%5 C" (including %, which is a valid identifier character). join does not constitute a separator → follow the fallback chain
    const r = await call('/dsh-pet-7340/thumb/..%255C..%255C..%255Coutside/leak.webm');
    assert.equal(r.status, 404);
    assert.equal(r.body.includes(SECRET), false);
  });

  test('Section fileName is also impenetrable (the defense line does not only hold petId)', async () => {
    const r = await call('/dsh-pet-7340/thumb/main/..%2F..%2F..%2Foutside%2Fleak.webm');
    assert.equal(r.status, 404);
    assert.equal(r.body.includes(SECRET), false);
  });
});

describe('pic/memes route —— Emoticon asset ownership (same semantics as thumb)', () => {
  test('Type exclusive: The pictures in pet/<asset root>-memes/ can be obtained by pressing <asset root>/<name> (Chinese asset root is as usual)', async () => {
    const r = await call(`/dsh-pet-7340/pic/memes/${encodeURIComponent(CN_PET)}/${encodeURIComponent('自家图')}.png`);
    assert.equal(r.status, 200);
    assert.equal(r.body, OWN_PIC);
  });

  test('Non-exclusive: go through the fallback chain of the user directory → the directory in the package (main has the same conventions as the unknown asset root)', async () => {
    for (const root of ['main', 'nosuchpet']) {
      const r = await call(`/dsh-pet-7340/pic/memes/${root}/${encodeURIComponent('共用图')}.png`);
      assert.equal(r.status, 200, `asset root ${root} should follow the fallback chain`);
      assert.equal(r.body, SHARED_PIC);
    }
  });

  test('The old two-part form / pic/memes /<name>. png is reserved (= fallback chain of asset root main)', async () => {
    const r = await call(`/dsh-pet-7340/pic/memes/${encodeURIComponent('共用图')}.png`);
    assert.equal(r.status, 200);
    assert.equal(r.body, SHARED_PIC);
  });

  test('Exclusive means exclusive: the category does not exist in its own directory → 404, and will never fallback to the user/package directory.', async () => {
    // Shared pictures only exist in the user directory; this type has an independent - memes directory → only check it, do not mix it
    const r = await call(`/dsh-pet-7340/pic/memes/${encodeURIComponent(CN_PET)}/${encodeURIComponent('共用图')}.png`);
    assert.equal(r.status, 404);
    assert.equal(
      r.body.includes(SHARED_PIC),
      false,
      'Do not fallback to the shared directory when the exclusive directory is hit',
    );
  });

  test('Non-existent picture → 404', async () => {
    assert.equal((await call('/dsh-pet-7340/pic/memes/main/nope.png')).status, 404);
  });

  test('The notification icon (/pic/<name>.png) is not affected: it is still only taken from the package assets/pic', async () => {
    // assets in the package in source code form is unreachable → 404 (the key is not to be swallowed by the memes branch)
    assert.equal((await call('/dsh-pet-7340/pic/logo.png')).status, 404);
  });
});

describe('/ logo - plugin logo (pet avatar in dialogue panel)', () => {
  test('Only bare paths are accepted: 400 for one more section, and the assets root is not opened as a static directory.', async () => {
    assert.equal((await call('/dsh-pet-7340/logo/x.png')).status, 400);
  });

  test('assets in the package in source code form is unreachable → 404 (read assets/logo.png in real installation)', async () => {
    assert.equal((await call('/dsh-pet-7340/logo')).status, 404);
  });
});

describe('pic/memes route - asset root is not suitable for path fragment (same invariant as thumb)', () => {
  test('%5 C backslash traversal ( Windows ) → 400, and never read outside the user root', async () => {
    const r = await call('/dsh-pet-7340/pic/memes/..%5C..%5C..%5Coutside-memes/leak.png');
    assert.equal(r.status, 400);
    assert.equal(r.body.includes(SECRET), false, 'Unrooted content must not appear in the response body');
  });

  test('Colon / control character is also rejected as invalid asset root', async () => {
    for (const bad of ['C%3A%5CWindows', '%00null']) {
      const r = await call(`/dsh-pet-7340/pic/memes/${bad}/leak.png`);
      assert.equal(r.status, 400, `asset root = ${bad} should be 400`);
    }
  });

  test('%2 F The forward slash is cut into multiple segments: the asset root only has ".." left, and the identifier rule is rejected on the spot → 400', async () => {
    // The same rule as thumb: the asset root is the directory name, '.'/'..' will be blocked here by isValidPetId.
    // Traversal of the name segment is still handled by resolveExisting (see next item).
    const r = await call('/dsh-pet-7340/pic/memes/..%2F..%2F..%2Foutside-memes/leak.png');
    assert.equal(r.status, 400);
    assert.equal(r.body.includes(SECRET), false);
  });

  test('The name segment is also impenetrable (the defense line does not only guard the asset root)', async () => {
    const r = await call('/dsh-pet-7340/pic/memes/main/..%2F..%2F..%2Foutside-memes%2Fleak.png');
    assert.equal(r.status, 404);
    assert.equal(r.body.includes(SECRET), false);
  });

  test('Double encoding will not be decoded twice (only decode once) → 404 and does not exceed the root', async () => {
    const r = await call('/dsh-pet-7340/pic/memes/..%255C..%255C..%255Coutside-memes/leak.png');
    assert.equal(r.status, 404);
    assert.equal(r.body.includes(SECRET), false);
  });
});

describe('pet is required - the default is always pet-required (issue #122 Article 1: Never return to the first one in the list)', () => {
  // The same situation as duration / broadcast: pet empty string can be rejected without reading the configuration, so
  // this group can still be tested in the source code state of "configuration unreachable" - assertion reason also
  // verified the short-circuit sequence (it is pet-required, not generate-error). The same branches of the 5
  // decision-making layers (/ anim, / broadcast, / bubble/clear, / position, / throw) are controlled by their
  // respective
  // *. test.ts coverage: Their pet parsing lives in the decision-making module, and the route layer cannot get the
  // chance of "unread configuration".

  test('/ lock and / lock/release: do not give pet / empty string / completely blank → pet-required', async () => {
    for (const path of ['lock', 'lock/release']) {
      for (const q of ['', '?pet=', '?pet=%20%20']) {
        const r = await call(`/dsh-pet-7340/${path}${q}`, 'POST', '{}');
        assert.equal(r.status, 200, `${path} ${q} business failure, go to 200 + ok:false`);
        const body = JSON.parse(r.body) as { ok: boolean; reason: string };
        assert.equal(body.ok, false, `${path}${q}`);
        assert.equal(body.reason, 'pet-required', `${path}${q}`);
      }
    }
  });

  test('/ whisper: Do not give pet → pet-required (no longer use empty strings to generate, and then write into leaves that no one consumes)', async () => {
    const r = await call('/dsh-pet-7340/whisper', 'POST');
    assert.equal(r.status, 200);
    const body = JSON.parse(r.body) as { ok: boolean; reason: string };
    assert.equal(body.ok, false);
    assert.equal(body.reason, 'pet-required');
  });

  test('/ chat: Do not give pet → pet-required (both GET and POST)', async () => {
    const g = await call('/dsh-pet-7340/chat');
    assert.equal(g.status, 200);
    assert.equal((JSON.parse(g.body) as { reason: string }).reason, 'pet-required');
    const p = await call('/dsh-pet-7340/chat', 'POST', JSON.stringify({ text: '在吗' }));
    assert.equal(p.status, 200);
    assert.equal((JSON.parse(p.body) as { reason: string }).reason, 'pet-required');
  });

  test('/ chat: Incorrect method is still 405 (pet verification does not get ahead of protocol layer errors)', async () => {
    assert.equal((await call('/dsh-pet-7340/chat', 'PUT')).status, 405);
    // DELETE is a valid method since the memory deletion interface (see chat-delete.test.ts), here we use PATCH which is also not accepted.
    assert.equal((await call('/dsh-pet-7340/chat', 'PATCH')).status, 405);
  });
});

describe('surface is required - the default/invalid value is always bad-request, and short-circuit is before reading the disk (issue #122 Article 1)', () => {
  // Same situation as pet empty string: The parameter-level verification of surface is placed before reading the
  // configuration, so this group can still be tested in the source code state of "configuration unreachable" -
  // assertion reason also verifies the short-circuit sequence (it is bad-request, not generate-error).
  test('/ lock, / whisper, / chat POST: Not given surface / invalid value → bad-request', async () => {
    const cases: Array<[string, string, string | undefined]> = [
      ['lock', 'POST', '{}'],
      ['whisper', 'POST', undefined],
      ['chat', 'POST', JSON.stringify({ text: '在吗' })],
    ];
    for (const [path, method, body] of cases) {
      for (const q of ['', '&surface=nope', '&surface=WEB', '&surface=']) {
        const r = await call(`/dsh-pet-7340/${path}?pet=main${q}`, method, body);
        assert.equal(r.status, 200, `${path} ${q} business failure, go to 200 + ok:false`);
        const b = JSON.parse(r.body) as { ok: boolean; reason: string };
        assert.equal(b.ok, false, `${path}${q}`);
        assert.equal(b.reason, 'bad-request', `${path} ${q} should be bad-request (not generate-error)`);
      }
    }
  });

  test('/ chat GET and / lock/release do not verify surface: still go to the step of reading the configuration (generate-error)', async () => {
    // The release must always be successful (otherwise the lock cannot be removed if the pet is hidden midway); GET is
    // a read memory, regardless of which end it is displayed on. Both ignore surface - even the invalid value
    // bad-request should not be reported.
    const g = await call('/dsh-pet-7340/chat?pet=main&surface=nope');
    assert.equal(g.status, 200);
    assert.equal((JSON.parse(g.body) as { reason: string }).reason, 'generate-error');
    const rel = await call('/dsh-pet-7340/lock/release?pet=main&surface=nope', 'POST', '{}');
    assert.equal(rel.status, 200);
    assert.equal((JSON.parse(rel.body) as { reason: string }).reason, 'generate-error');
  });
});

describe('/ pose ——Desktop live broadcast (GET query / POST report), has nothing to do with surface', () => {
  // The same situation as the "pet required" of / whisper and / chat: these assertions are still established in the
  // source code state of "configuration unreachable", just in the verify short-circuit sequence (pet is reported
  // first, surface is not involved at all).
  test('/ pose: Do not give pet → pet-required; Wrong method → 405', async () => {
    const r = await call('/dsh-pet-7340/pose');
    assert.equal(r.status, 200);
    assert.equal((JSON.parse(r.body) as { reason: string }).reason, 'pet-required');
    assert.equal((await call('/dsh-pet-7340/pose?pet=main', 'POST')).status, 405);
  });

  test('/ pose/report: Wrong method → 405; Invalid JSON → 400 (protocol layer error precedes business)', async () => {
    assert.equal((await call('/dsh-pet-7340/pose/report?pet=main')).status, 405);
    assert.equal((await call('/dsh-pet-7340/pose/report?pet=main', 'POST', '{ 不是 json')).status, 400);
  });

  test('Both items are **not verified** surface: Even invalid values still go to the step of reading the configuration.', async () => {
    // They are read/internal endpoints (same as GET /chat, GET /playback) - surface is only added to action
    // endpoints that will produce effects visible to the renderer. This also verifies "Don't add surface in the
    // future".
    const g = await call('/dsh-pet-7340/pose?pet=main&surface=nope');
    assert.equal(g.status, 200);
    assert.equal((JSON.parse(g.body) as { reason: string }).reason, 'generate-error');
    const p = await call(
      '/dsh-pet-7340/pose/report?pet=main&surface=nope',
      'POST',
      JSON.stringify({ x: 0.5, y: 0.5, facing: 'left' }),
    );
    assert.equal(p.status, 200);
    assert.equal((JSON.parse(p.body) as { reason: string }).reason, 'generate-error');
  });
});

describe('? rounds = —— Invalid value bad-request, valid value does not kill by mistake (issue #141)', () => {
  // The configuration is unreachable in source code form: if it can report bad-request, it proves that the verification precedes disk reading (otherwise it will be generate-error).
  test('Invalid → bad-request (negative number / decimal / non-number / exceeding the upper limit)', async () => {
    for (const bad of ['-1', '1.5', 'abc', '201']) {
      const r = await call(`/dsh-pet-7340/chat?pet=main&rounds=${bad}`);
      const body = JSON.parse(r.body) as { ok: boolean; reason: string };
      assert.equal(body.ok, false, bad);
      assert.equal(body.reason, 'bad-request', bad);
    }
  });

  test('valid / empty string / not transmitted → do not report bad-request (this file goes to generate-error)', async () => {
    for (const q of ['&rounds=0', '&rounds=3', '&rounds=', '']) {
      const r = await call(`/dsh-pet-7340/chat?pet=main${q}`);
      assert.equal((JSON.parse(r.body) as { reason: string }).reason, 'generate-error', q);
    }
  });
});

describe('/ pet-display - Business failure 200 + entities, protocol failure uses real status code', () => {
  test('GET → 405 + method-not-allowed (method error means protocol failure, not determined by handler)', async () => {
    const r = await call('/dsh-pet-7340/pet-display');
    assert.equal(r.status, 405);
    assert.equal((JSON.parse(r.body) as { reason: string }).reason, 'method-not-allowed');
  });

  test('The request body is not valid JSON → 400 + invalid-json (protocol failed)', async () => {
    const r = await call('/dsh-pet-7340/pet-display', 'POST', '{ 不是 json');
    assert.equal(r.status, 400);
    assert.equal((JSON.parse(r.body) as { reason: string }).reason, 'invalid-json');
  });

  test('Missing id → 200 + pet-required (the same pair of words as 9 items ? pet = route)', async () => {
    for (const body of [{ display: 'none' }, { id: '   ', display: 'none' }, { display: 'none' }]) {
      const r = await call('/dsh-pet-7340/pet-display', 'POST', JSON.stringify(body));
      assert.equal(r.status, 200, JSON.stringify(body));
      const parsed = JSON.parse(r.body) as { ok: boolean; reason: string };
      assert.equal(parsed.ok, false);
      assert.equal(parsed.reason, 'pet-required');
    }
  });

  test('display invalid → 200 + bad-request (whitelist web/desktop/both/none)', async () => {
    const r = await call('/dsh-pet-7340/pet-display', 'POST', JSON.stringify({ id: 'main', display: 'nope' }));
    assert.equal(r.status, 200);
    const body = JSON.parse(r.body) as { ok: boolean; reason: string };
    assert.equal(body.ok, false);
    assert.equal(body.reason, 'bad-request');
  });
});

describe('/ work-status —— External writing working status', () => {
  type StateBody = { sections: { workStatus: { data: { state: string | null; task: string | null } } } };
  const work = async () => JSON.parse((await call('/dsh-pet-7340/state')).body) as StateBody;

  test('POST is written to state/task, / state is visible simultaneously', async () => {
    const r = await call('/dsh-pet-7340/work-status', 'POST', JSON.stringify({ state: 'working', task: '编译中' }));
    assert.equal(r.status, 200);
    assert.deepEqual(JSON.parse(r.body), { state: 'working', task: '编译中' });
    assert.deepEqual((await work()).sections.workStatus.data, {
      state: 'working',
      task: '编译中',
      sessionId: null,
    });
  });

  test('Omit task and keep the previous one; explicit null / empty string clear', async () => {
    await call('/dsh-pet-7340/work-status', 'POST', JSON.stringify({ state: 'working', task: '保留我' }));

    const keep = await call('/dsh-pet-7340/work-status', 'POST', JSON.stringify({ state: 'result' }));
    assert.deepEqual(JSON.parse(keep.body), { state: 'result', task: '保留我' });

    const nulled = await call('/dsh-pet-7340/work-status', 'POST', JSON.stringify({ state: 'working', task: null }));
    assert.deepEqual(JSON.parse(nulled.body), { state: 'working', task: null });

    const emptied = await call('/dsh-pet-7340/work-status', 'POST', JSON.stringify({ state: 'working', task: '   ' }));
    assert.deepEqual(JSON.parse(emptied.body), { state: 'working', task: null });
  });

  test('DELETE clear returns idle and idempotent', async () => {
    await call('/dsh-pet-7340/work-status', 'POST', JSON.stringify({ state: 'success', task: '完成' }));

    const del = await call('/dsh-pet-7340/work-status', 'DELETE');
    assert.equal(del.status, 204);
    assert.equal(del.body, '');
    assert.deepEqual((await work()).sections.workStatus.data, { state: null, task: null, sessionId: null });

    const again = await call('/dsh-pet-7340/work-status', 'DELETE');
    assert.equal(again.status, 204);
  });

  test('Bad JSON → 400; invalid business parameters → 200 + bad-request; GET → 405; body over limit → 413', async () => {
    const malformed = await call('/dsh-pet-7340/work-status', 'POST', '{');
    assert.equal(malformed.status, 400, 'Bad JSON is protocol failure');
    assert.equal((JSON.parse(malformed.body) as { reason: string }).reason, 'invalid-json');

    for (const payload of [
      { state: 'nope' },
      { state: 'working', task: 42 },
      { state: 'working', task: 'x'.repeat(41) },
    ]) {
      const body = JSON.stringify(payload);
      const r = await call('/dsh-pet-7340/work-status', 'POST', body);
      assert.equal(r.status, 200, body.slice(0, 60));
      const parsed = JSON.parse(r.body) as { ok: boolean; reason: string };
      assert.equal(parsed.ok, false);
      assert.equal(parsed.reason, 'bad-request');
    }
    assert.equal((await call('/dsh-pet-7340/work-status')).status, 405);
    const big = await call(
      '/dsh-pet-7340/work-status',
      'POST',
      JSON.stringify({ state: 'working', task: 'x'.repeat(9000) }),
    );
    assert.equal(big.status, 413);
  });
});

describe('External Cordis service - third-party register balance inquiry', () => {
  interface BalanceApi {
    register: (def: { id: string; fetch: (ctx: { provider: string }) => Promise<unknown> }) => () => void;
    list: () => { builtin: string[]; external: string[] };
  }
  const api = (): BalanceApi => {
    const value = provided.get('petApi7340') as { balance?: BalanceApi } | undefined;
    assert.ok(value?.balance, 'apply () must hang out petApi7340.balance');
    return value.balance;
  };

  test('The output is register + list (without unregister: log out and take the return value of register)', () => {
    const balance = api() as unknown as Record<string, unknown>;
    assert.equal(typeof balance.register, 'function');
    assert.equal(typeof balance.list, 'function');
    assert.equal('unregister' in balance, false);
  });

  test('list is visible after registering with the service and disappears after calling disposer', () => {
    const dispose = api().register({
      id: 'route-test-plugin',
      fetch: async ({ provider }) => ({ ok: true, provider, shape: 'points', data: { unit: '积分', total: '1' } }),
    });
    try {
      assert.ok(api().list().external.includes('route-test-plugin'));
    } finally {
      dispose();
    }
    assert.equal(api().list().external.includes('route-test-plugin'), false);
  });
});

describe('External Cordis service - third-party register memory', () => {
  interface MemoryApi {
    register: (def: { id: string; recall?: () => Promise<{ userText?: string }> }) => () => void;
    list: () => { builtin: string[]; external: string[] };
  }
  const api = (): MemoryApi => {
    const value = provided.get('petApi7340') as { memory?: MemoryApi } | undefined;
    assert.ok(value?.memory, 'apply () must hang out petApi7340.memory');
    return value.memory;
  };

  test('The output is register + list (without unregister: log out and take the return value of register)', () => {
    const memory = api() as unknown as Record<string, unknown>;
    assert.equal(typeof memory.register, 'function');
    assert.equal(typeof memory.list, 'function');
    assert.equal('unregister' in memory, false);
  });

  test('After registering through the service, list and the chat path can be seen, and after disposer, fallback is native', () => {
    const def = { id: 'route-test-memory', recall: async () => ({ userText: '改后的问题' }) };
    const dispose = api().register(def);
    try {
      assert.ok(api().list().external.includes('route-test-memory'));
      assert.equal(activeChatMemoryProvider(), def, 'The chat path must read the copy of the service register');
    } finally {
      dispose();
    }
    assert.equal(api().list().external.includes('route-test-memory'), false);
    assert.equal(activeChatMemoryProvider(), null);
  });
});

describe('/ todos - A complete round trip to the to-do list', () => {
  test('New → List → Check → Delete', async () => {
    const create = await call('/dsh-pet-7340/todos', 'POST', JSON.stringify({ text: '交周报', dueAt: 1793000000000 }));
    assert.equal(create.status, 200);
    const created = JSON.parse(create.body) as { ok: boolean; todo: { id: string; text: string; dueAt: number } };
    assert.equal(created.ok, true);
    assert.equal(created.todo.text, '交周报');
    assert.equal(created.todo.dueAt, 1793000000000);

    const listed = JSON.parse((await call('/dsh-pet-7340/todos')).body) as { todos: Array<{ id: string }> };
    assert.ok(
      listed.todos.some((todo) => todo.id === created.todo.id),
      'The newly created to-do must appear in the list',
    );

    const patched = JSON.parse(
      (await call('/dsh-pet-7340/todos/' + created.todo.id, 'PATCH', JSON.stringify({ done: true }))).body,
    ) as { ok: boolean; todo: { done: boolean } };
    assert.equal(patched.ok, true);
    assert.equal(patched.todo.done, true);

    const removed = JSON.parse((await call('/dsh-pet-7340/todos/' + created.todo.id, 'DELETE')).body) as {
      removed: number;
    };
    assert.equal(removed.removed, 1);
    const after = JSON.parse((await call('/dsh-pet-7340/todos')).body) as { todos: Array<{ id: string }> };
    assert.equal(
      after.todos.some((todo) => todo.id === created.todo.id),
      false,
      'After deletion, it cannot appear in the list again.',
    );
  });
});
