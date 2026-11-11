/**
 * system tray "exits" contract test (issue #178): GET /quit detection capability → POST /quit is handed over to the
 * host for shutdown.
 *
 * Why it must be exited by the host: In BRIDGE mode, Helper is pulled up by the host. `app.quit()` itself will be
 * regarded as a crash and will be restarted according to the index (it just flashes when clicked); the real exit
 * requires host cleanup (stop Helper → turn off the service → exit 0). This capability is only provided in standalone
 * mode (standalone pseudo ctx's `shutdownApp` ) - DSH host does not have this field, turning off the entire DSH should
 * not be determined by a pet's system tray, so the menu item does not appear there.
 *
 * Verify three things here: ① The capability is determined upon request: there is no shutdownApp → canQuit:false on
 * ctx, and POST does not trigger any shutdown; ② There is the capability → canQuit:true, POST triggers and reason is
 * correct; ③ Desktop terminal wiring (source code guard): BRIDGE cannot be withdrawn by oneself, it must be POST /
 * quit; withdrawal cannot be adjusted to syncDesktop.
 *
 * Use `DSH_PET_IN_PROCESS=1` to make `launchHelper` short-circuit: This test only cares about route and will never
 * actually pull up Electron. Use Node to build test runner (node:test) without introducing any npm dependencies.
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { Writable } from 'node:stream';

import { apply } from './index.ts';

/** Source code of files in the package (for guarding; relative to src/host / parsing) */
const readSource = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const hostSource = readSource('./index.ts') + '\n' + readSource('./routes/desktop.ts');

type Result = { status: number; body: string };

let dir = '';
let call: (url: string, method?: string, body?: string) => Promise<Result> = () =>
  Promise.reject(new Error('未初始化'));
let savedHome: string | undefined;
let savedElectron: string | undefined;
let savedInProcess: string | undefined;
/** All effect release functions of apply() register (called in after: resident timer otherwise the test process will not exit) */
const disposers: Array<() => void> = [];
/** False ctx: shutdownApp is deleted/hanged back between use cases to verify "decision at request time" instead of "decision at apply time" */
const hostCtx: Record<string, unknown> = {};
/** The reason why shutdownApp is called every time ("it was not triggered by mistake" also depends on its assertion) */
const quitReasons: string[] = [];
const shutdownSpy = (reason: string): void => {
  quitReasons.push(reason);
};

/** Minimum response pile: writeHead records status code, Writable collects body */
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
  dir = mkdtempSync(join(tmpdir(), 'dsh-pet-quit-'));
  savedHome = process.env.DSH_HOME;
  savedElectron = process.env.DSH_PET_ELECTRON_PATH;
  savedInProcess = process.env.DSH_PET_IN_PROCESS;
  process.env.DSH_HOME = join(dir, 'home');
  // Hit an existing file; add the following IN_PROCESS double insurance - this test will never spawn
  process.env.DSH_PET_ELECTRON_PATH = process.execPath;
  process.env.DSH_PET_IN_PROCESS = '1';

  let handler: ((req: unknown, res: unknown) => Promise<void>) | undefined;
  const noop = (): void => {};
  hostCtx.shutdownApp = shutdownSpy;
  // Must be the same reference as hostCtx (cannot be expanded into a new object): delete must be replaced by
  // shutdownApp between use cases, and the capability should be fixed when verifying that quit is "determined on
  // request" instead of apply.
  Object.assign(hostCtx, {
    effect: (fn: () => unknown) => {
      try {
        const dispose = fn();
        if (typeof dispose === 'function') disposers.push(dispose as () => void);
        return dispose;
      } catch {
        /* The built-in configuration is unreachable in source code form. refreshDesktop will be thrown and swallowed without affecting the route register. */
      }
    },
    provide: () => noop,
    on: () => noop,
    webServer: {
      register: (spec: { handler: typeof handler }) => ((handler = spec.handler), noop),
    },
    commands: { register: () => noop },
    logger: { warn: () => {}, info: () => {}, debug: () => {}, error: () => {} },
    agentDefaultModel: { currentSelection: () => ({ provider: 'standalone', model: '' }) },
    credentials: { resolve: async () => undefined },
    llm: { listProviders: () => [], listModels: async () => [] },
  });
  apply(hostCtx);
  assert.ok(handler, 'apply () should register / dsh-pet-7340 prefix handler');

  call = (url, method = 'GET', body) =>
    new Promise<Result>((done) => {
      const res = new FakeRes();
      res.on('finish', () => done({ status: res.status, body: Buffer.concat(res.chunks).toString('utf8') }));
      void handler?.(
        {
          method,
          url,
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
  if (savedInProcess === undefined) delete process.env.DSH_PET_IN_PROCESS;
  else process.env.DSH_PET_IN_PROCESS = savedInProcess;
  rmSync(dir, { recursive: true, force: true });
});

describe('GET /quit - Check "whether the host is allowed to exit"', () => {
  test('host provides shutdownApp → canQuit:true', async () => {
    const r = await call('/dsh-pet-7340/quit');
    assert.equal(r.status, 200);
    assert.deepEqual(JSON.parse(r.body), { canQuit: true });
  });

  test('DSH host does not have this capability → canQuit:false (the desktop side therefore does not display the exit item)', async () => {
    delete hostCtx.shutdownApp;
    try {
      const r = await call('/dsh-pet-7340/quit');
      assert.equal(r.status, 200);
      assert.deepEqual(JSON.parse(r.body), { canQuit: false });
    } finally {
      hostCtx.shutdownApp = shutdownSpy;
    }
  });
});

describe('POST /quit - hand over the exit to the host for shutdown', () => {
  test('Capable host → ok:true, the reason is recorded as "system tray exit"', async () => {
    quitReasons.length = 0;
    const r = await call('/dsh-pet-7340/quit', 'POST');
    assert.equal(r.status, 200);
    assert.deepEqual(JSON.parse(r.body), { ok: true });
    // Only in setImmediate can the machine be truly debugged (let 200 be written out first)
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(quitReasons, ['托盘退出']);
  });

  test('No ability → Structure failure, never shut down the host by mistake', async () => {
    delete hostCtx.shutdownApp;
    quitReasons.length = 0;
    try {
      const r = await call('/dsh-pet-7340/quit', 'POST');
      const body = JSON.parse(r.body) as { ok: boolean; reason: string };
      assert.equal(r.status, 200, 'Exiting is not supported is a business conclusion, not a protocol layer error.');
      assert.equal(body.ok, false);
      assert.equal(body.reason, 'unsupported');
      await new Promise((resolve) => setImmediate(resolve));
      assert.deepEqual(quitReasons, [], 'Even a shutdown is not allowed to be triggered when there is no ability.');
    } finally {
      hostCtx.shutdownApp = shutdownSpy;
    }
  });

  test('PUT → 405 (Exit is an action endpoint, not a saveable resource)', async () => {
    const r = await call('/dsh-pet-7340/quit', 'PUT');
    assert.equal(r.status, 405);
  });
});

describe('Wiring between desktop and standalone mode (source code guard: the two halves are built separately and cannot mutually import)', () => {
  // The exit item and click behavior of the system tray have been changed to behavior testing (see
  // desktop-tray.test.ts): the source code guard will turn red as soon as the indentation is changed, and the real
  // contract cannot be maintained. Only the standalone mode wiring that cannot be overridden by behavior is left
  // here.
  const cli = readSource('../standalone/cli.ts');
  const context = readSource('../standalone/context.ts');

  test('Standalone mode: shutdown capability hooked to pseudo ctx, and reuse / shutdown of forwardShutdown', () => {
    assert.match(context, /options\.shutdown \? \{ shutdownApp: options\.shutdown \} : \{\}/);
    assert.match(cli, /shutdown: \(reason\) => forwardShutdown\(reason\)/);
  });

  test('Exit is not a restart: / quit call syncDesktop() must not be called within the route block', () => {
    const block = /if \(rest === 'quit'\) \{([\s\S]*?)\n {2}\}/.exec(hostSource);
    assert.ok(block, 'host must have / quit route');
    assert.ok(!/syncDesktop/.test(block[1]), 'Exit not restart: reload guard requested syncDesktop exactly 4 times');
  });
});
