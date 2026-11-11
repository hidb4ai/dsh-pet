/**
 * helper-process unit test - Focus on retained Electron parsing/locating pure logic.
 *
 * Downloading (@electron / get) and decompression (@electron - internal/extract-zip) have been taken over by the
 * official library. There is no longer a handwritten zip parsing/platform command chain, so the original
 * extractAttempts/extractZipWithNode test is deleted with the code. What is tested here is the candidate priority of
 * resolveElectronPath, the environment variable coverage of DSH_PET_ELECTRON_PATH, and the path assemble of
 * dshHomeDir/defaultElectronExe - these are the parts that this file still implements itself.
 *
 * Use Node to build test runner (node:test) without introducing any npm dependencies: node --experimental-strip-types
 * --test src/host/helper-process.test.ts
 */
import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  HELPER_STABLE_MS,
  HELPER_STOP_GRACE_MS,
  HelperProcess,
  crashLoopAdvice,
  describeExit,
  dshHomeDir,
  defaultElectronExe,
  ensureElectronDownload,
  hasGraphicalDisplay,
  helperLaunchArgs,
  helperRunIsStable,
  helperSpawnEnv,
  readElectronVersion,
  restartBackoffDelayMs,
  resolveElectronPath,
  shouldCircuitBreak,
  shouldFallbackToNoSandbox,
} from './helper-process.ts';

test('undefined is returned when the Electron installation directory cannot be created, and no unhandled rejection is generated.', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-pet-install-'));
  const savedHome = process.env.DSH_HOME;
  t.after(() => {
    if (savedHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = savedHome;
    rmSync(dir, { recursive: true, force: true });
  });
  process.env.DSH_HOME = dir;
  // Cross-platform recurrence: Ordinary files with the same name prevent directory creation, regardless of chmod or administrator privileges.
  writeFileSync(join(dir, 'electron'), 'occupied');
  const warnings: string[] = [];
  t.mock.method(console, 'warn', (message: string) => warnings.push(message));
  t.mock.method(console, 'log', () => {});
  assert.equal(await ensureElectronDownload(), undefined);
  assert.ok(warnings.some((message) => message.includes('ensure failed:')));
  assert.ok(warnings.some((message) => message.includes('DSH_PET_ELECTRON_PATH')));
});

/** Create an isolated temporary directory and restore the original DSH_HOME / DSH_PET_ELECTRON_PATH environment variables */
function withIsolatedHome(fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-pet-test-'));
  const savedHome = process.env.DSH_HOME;
  const savedPath = process.env.DSH_PET_ELECTRON_PATH;
  try {
    process.env.DSH_HOME = join(dir, 'dshhome');
    process.env.DSH_PET_ELECTRON_PATH = '';
    fn(dir);
  } finally {
    if (savedHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = savedHome;
    if (savedPath === undefined) delete process.env.DSH_PET_ELECTRON_PATH;
    else process.env.DSH_PET_ELECTRON_PATH = savedPath;
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('dshHomeDir —— $DSH_HOME analysis', () => {
  test('Prioritize DSH_HOME environment variable', () => {
    withIsolatedHome((dir) => {
      process.env.DSH_HOME = join(dir, 'custom');
      assert.equal(dshHomeDir(), join(dir, 'custom'));
    });
  });

  test('fallback to ~/.dsh when DSH_HOME is not set', () => {
    withIsolatedHome(() => {
      delete process.env.DSH_HOME;
      const userProfile = process.env.USERPROFILE || process.env.HOME || '';
      assert.equal(dshHomeDir(), join(userProfile, '.dsh'));
    });
  });
});

describe('defaultElectronExe ——Path of landing executable file', () => {
  test('Build executable files by platform under $DSH_HOME/electron', () => {
    withIsolatedHome((dir) => {
      process.env.DSH_HOME = join(dir, 'custom');
      const rel =
        process.platform === 'win32'
          ? 'electron.exe'
          : process.platform === 'darwin'
            ? join('Electron.app', 'Contents', 'MacOS', 'Electron')
            : 'electron';
      assert.equal(defaultElectronExe(), join(dir, 'custom', 'electron', rel));
    });
  });
});

describe('resolveElectronPath - Candidate priority', () => {
  test('Electron cache validation: skips empty files and directories before a usable candidate', () => {
    withIsolatedHome((dir) => {
      const empty = join(dir, 'empty');
      const directory = join(dir, 'folder');
      const usable = join(dir, 'usable');
      writeFileSync(empty, '');
      mkdirSync(directory);
      writeFileSync(usable, 'executable fixture');
      assert.equal(resolveElectronPath([empty, directory, usable]), usable);
    });
  });

  test('Electron cache validation: does not resolve an empty managed cache', () => {
    withIsolatedHome(() => {
      const path = defaultElectronExe();
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, '');
      assert.equal(resolveElectronPath(), undefined);
    });
  });
  test('Return directly when an explicit candidate hits (without reading environment variables)', () => {
    withIsolatedHome((dir) => {
      const fake = join(dir, 'fake-electron.exe');
      writeFileSync(fake, 'executable fixture');
      const other = join(dir, 'other-electron.exe');
      writeFileSync(other, 'executable fixture');
      assert.equal(resolveElectronPath([fake, other]), fake);
    });
  });

  test('Candidate order: the first one to exist wins', () => {
    withIsolatedHome((dir) => {
      const fake = join(dir, 'fake-electron.exe');
      writeFileSync(fake, 'executable fixture');
      assert.equal(resolveElectronPath([join(dir, 'missing.exe'), fake]), fake);
    });
  });

  test('DSH_PET_ELECTRON_PATH environment variable candidate (after explicit candidate)', () => {
    withIsolatedHome((dir) => {
      const viaEnv = join(dir, 'env-electron.exe');
      writeFileSync(viaEnv, 'executable fixture');
      process.env.DSH_PET_ELECTRON_PATH = viaEnv;
      assert.equal(resolveElectronPath([]), viaEnv);
    });
  });

  test('Return undefined when none exists', () => {
    withIsolatedHome((dir) => {
      assert.equal(resolveElectronPath([join(dir, 'missing-1.exe'), join(dir, 'missing-2.exe')]), undefined);
    });
  });

  test('Candidate deduplicate: Duplicate paths are only retained once (the result can still be hit)', () => {
    withIsolatedHome((dir) => {
      const fake = join(dir, 'fake-electron.exe');
      writeFileSync(fake, 'executable fixture');
      assert.equal(resolveElectronPath([fake, fake, join(dir, 'missing.exe')]), fake);
    });
  });

  test('Empty character string / null candidate is skipped', () => {
    withIsolatedHome((dir) => {
      const fake = join(dir, 'fake-electron.exe');
      writeFileSync(fake, 'executable fixture');
      assert.equal(resolveElectronPath(['', undefined, fake] as Array<string | undefined>), fake);
    });
  });

  test('The landing path of $DSH_HOME/electron is among the local candidates (it can be hit when DSH_HOME is isolated)', () => {
    withIsolatedHome((dir) => {
      process.env.DSH_HOME = join(dir, 'dshhome');
      const rel =
        process.platform === 'win32'
          ? 'electron.exe'
          : process.platform === 'darwin'
            ? join('Electron.app', 'Contents', 'MacOS', 'Electron')
            : 'electron';
      const landed = join(dir, 'dshhome', 'electron', rel);
      mkdirSync(dirname(landed), { recursive: true });
      writeFileSync(landed, 'executable fixture');
      assert.equal(resolveElectronPath([]), landed);
    });
  });
});

test('Electron cache validation: an existing non-empty file avoids a download', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-pet-cache-'));
  const previous = process.env.DSH_HOME;
  t.after(() => {
    if (previous === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previous;
    rmSync(home, { recursive: true, force: true });
  });
  process.env.DSH_HOME = home;
  const path = defaultElectronExe();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, 'executable fixture');
  let logs = 0;
  assert.equal(
    await ensureElectronDownload({
      onLog: () => {
        logs++;
      },
    }),
    path,
  );
  assert.equal(logs, 0);
});

test('Electron cache validation: an empty file enters the download path and reports failure', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-pet-cache-'));
  const previous = process.env.DSH_HOME;
  t.after(() => {
    if (previous === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previous;
    rmSync(home, { recursive: true, force: true });
  });
  process.env.DSH_HOME = home;
  const path = defaultElectronExe();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, '');
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'warn', () => {});
  const logs: string[] = [];
  // Invalid version + loopback-only image: This use case must not actually download the runtime.
  const result = await ensureElectronDownload({
    version: 'invalid-version',
    mirror: 'http://127.0.0.1:1/',
    timeoutMs: 200,
    onLog: (e) => logs.push(e.text),
  });
  assert.equal(result, undefined);
  assert.ok(logs.some((m) => m.includes('缓存无效')));
  assert.ok(logs.some((m) => m.includes('下载失败')));
});

describe('hasGraphicalDisplay —— Electron is not pulled up when there is no graphics environment', () => {
  const saved = { ...process.env };
  afterEach(() => {
    for (const key of ['DISPLAY', 'WAYLAND_DISPLAY', 'DSH_PET_DESKTOP_FORCE']) delete process.env[key];
    Object.assign(process.env, saved);
  });

  test('linux None DISPLAY / WAYLAND_DISPLAY: It is judged as a non-graphical environment (to avoid crashing when pulling up core dump)', () => {
    delete process.env.DISPLAY;
    delete process.env.WAYLAND_DISPLAY;
    // Non-linux (win32/darwin) desktop systems are always allowed, so the assertion is based on the platform
    assert.equal(hasGraphicalDisplay(), process.platform !== 'linux');
  });

  test('Release when there is DISPLAY', () => {
    process.env.DISPLAY = ':0';
    assert.equal(hasGraphicalDisplay(), true);
  });

  test('Release when there is WAYLAND_DISPLAY', () => {
    process.env.WAYLAND_DISPLAY = 'wayland-0';
    assert.equal(hasGraphicalDisplay(), true);
  });

  test('DSH_PET_DESKTOP_FORCE =1 is the escape hatch (Xvfb / remote desktop scenario)', () => {
    delete process.env.DISPLAY;
    delete process.env.WAYLAND_DISPLAY;
    process.env.DSH_PET_DESKTOP_FORCE = '1';
    assert.equal(hasGraphicalDisplay(), true);
  });
});

describe('restartBackoffDelayMs——Exponential backoff (starting from 750 ms, 2 x, capped at 30 s)', () => {
  test('Backoff sequence: 750 → 1500 → 3000 → 6000 → 12000 → 24000 → 30000 (no more doubling after capping)', () => {
    // Be careful not to write . map ( restartBackoffDelayMs ): map will pass the index as baseMs
    const seq = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((n) => restartBackoffDelayMs(n));
    assert.deepEqual(seq, [750, 1500, 3000, 6000, 12000, 24000, 30000, 30000, 30000]);
  });

  test('DSH_PET_RESTART_BASE_MS adjustable base value (same as 2 x, capped at 30 s)', () => {
    assert.equal(restartBackoffDelayMs(0, 1000), 1000);
    assert.equal(restartBackoffDelayMs(5, 1000), 30000);
  });
});

describe('shouldCircuitBreak —— After crashing 12 times (about 3 minutes), the circuit fuse', () => {
  test('The fuse does not blow out for the first 11 times, but fuses after the 12th time.', () => {
    assert.equal(shouldCircuitBreak(0), false);
    assert.equal(shouldCircuitBreak(10), false);
    assert.equal(shouldCircuitBreak(11), false);
    assert.equal(shouldCircuitBreak(12), true);
    assert.equal(shouldCircuitBreak(50), true);
  });
});

describe('shouldFallbackToNoSandbox - Automatically switch to no-sandbox when the sandbox cannot be started. Try again.', () => {
  const base = {
    code: 0x80000003,
    sawOutput: false,
    ranMs: 300,
    alreadyApplied: false,
    customCommand: false,
    sandboxOptOut: false,
  };

  test('Retreat in seconds, no output, 0x80000003 → Retreat once', () => {
    assert.equal(shouldFallbackToNoSandbox(base), true);
  });

  test('Both reporting methods of Node are recognized: 2147483651 and -2147483645 point to the same 0x80000003', () => {
    assert.equal(shouldFallbackToNoSandbox({ ...base, code: 2147483651 }), true);
    assert.equal(shouldFallbackToNoSandbox({ ...base, code: -2147483645 }), true);
  });

  test('There is stdout/stderr, indicating that JS has been run, and the cause is not the sandbox → no refund', () => {
    assert.equal(shouldFallbackToNoSandbox({ ...base, sawOutput: true }), false);
  });

  test('It crashed after running for a while (≥5 s). It is another problem → No refund', () => {
    assert.equal(shouldFallbackToNoSandbox({ ...base, ranMs: 6000 }), false);
  });

  test('Only retreat once: return to normal retreat/circuit after retreating', () => {
    assert.equal(shouldFallbackToNoSandbox({ ...base, alreadyApplied: true }), false);
  });

  test('The user explicitly requested to retain the sandbox (DSH_PET_GPU_SANDBOX =1) → no refund', () => {
    assert.equal(shouldFallbackToNoSandbox({ ...base, sandboxOptOut: true }), false);
  });

  test('Custom command (test/user script) no guess → no return', () => {
    assert.equal(shouldFallbackToNoSandbox({ ...base, customCommand: true }), false);
  });

  test('Other exit codes (including 0xC0000005 access violation, normal exit 1) → no exit', () => {
    assert.equal(shouldFallbackToNoSandbox({ ...base, code: 3221225477 }), false);
    assert.equal(shouldFallbackToNoSandbox({ ...base, code: 1 }), false);
    assert.equal(shouldFallbackToNoSandbox({ ...base, code: null }), false);
  });
});

describe('helperLaunchArgs - The fallback switch must precede the app path', () => {
  test('Rolled back: --no-sandbox is the first item', () => {
    assert.deepEqual(helperLaunchArgs(['main.js'], { sandboxFallback: true, customCommand: false }), [
      '--no-sandbox',
      'main.js',
    ]);
  });

  test('Not rolled back: parameters remain as they are, not injected', () => {
    assert.deepEqual(helperLaunchArgs(['main.js'], { sandboxFallback: false, customCommand: false }), ['main.js']);
  });

  test('Custom command: not injected even if it has been rolled back (that is not the real Electron)', () => {
    assert.deepEqual(helperLaunchArgs(['main.js'], { sandboxFallback: true, customCommand: true }), ['main.js']);
  });
});

describe('helperRunIsStable ——The count will be cleared after ≥3 minutes of stable operation.', () => {
  test('Less than 3 minutes: unstable, not cleared', () => {
    assert.equal(helperRunIsStable(2 * 60 * 1000), false);
  });

  test('reaches 3 minutes: stable, should be cleared', () => {
    assert.equal(helperRunIsStable(HELPER_STABLE_MS), true);
    assert.equal(helperRunIsStable(10 * 60 * 1000), true);
  });
});

describe('describeExit - crash exit code translated into readable fragments', () => {
  test('Access violation: both unsigned and signed reporting methods point to the same 0xC0000005', () => {
    assert.equal(describeExit(3221225477, null), 'code=3221225477 (0xC0000005 access violation), signal=null');
    assert.equal(describeExit(-1073741819, null), 'code=-1073741819 (0xC0000005 access violation), signal=null');
  });

  test('Breakpoint: 0x80000003 marked as sandbox initialization failure', () => {
    assert.equal(
      describeExit(2147483651, null),
      'code=2147483651 (0x80000003 breakpoint (sandbox initialization failed)), signal=null',
    );
  });

  test('Ordinary exit codes do not complement hexadecimal: avoid writing exit 1 as 0x1', () => {
    assert.equal(describeExit(1, null), 'code=1, signal=null');
    assert.equal(describeExit(0, null), 'code=0, signal=null');
  });

  test('Uncollected NTSTATUS: only give hexadecimal, do not make up the meaning', () => {
    assert.equal(describeExit(3221225725, null), 'code=3221225725 (0xC00000FD), signal=null');
  });

  test('Terminated by signal: code = null, the signal is carried as it is', () => {
    assert.equal(describeExit(null, 'SIGKILL'), 'code=null, signal=SIGKILL');
  });
});

describe('crashLoopAdvice - circuit breakers are recommended to branch by platform', () => {
  test('Windows: Change the version and point to the ready-made executable file, without mentioning DISPLAY', () => {
    const advice = crashLoopAdvice('win32');
    assert.match(advice, /DSH_PET_ELECTRON_VERSION/);
    assert.match(advice, /DSH_PET_ELECTRON_PATH/);
    assert.match(advice, /DSH_PET_RESTART_MAX_FAILURES/);
    assert.ok(!advice.includes('DISPLAY'), 'It is misleading to recommend DISPLAY on Windows');
  });

  test('Linux: Give the display environment and Xvfb escape hatch', () => {
    const advice = crashLoopAdvice('linux');
    assert.match(advice, /DISPLAY/);
    assert.match(advice, /DSH_PET_DESKTOP_FORCE=1/);
  });

  test('macOS: Points to a ready-made executable file without mentioning the display environment', () => {
    const advice = crashLoopAdvice('darwin');
    assert.match(advice, /DSH_PET_ELECTRON_PATH/);
    assert.ok(!advice.includes('DISPLAY'));
  });
});

describe('readElectronVersion - Read the version file in the landing directory', () => {
  test('Normal reading: the content is returned after removing line breaks.', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-pet-version-'));
    try {
      writeFileSync(join(dir, 'version'), '43.3.0\n');
      assert.equal(readElectronVersion(join(dir, 'electron.exe')), '43.3.0');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('The file is missing or the content is not a version number: return undefined, do not make it up', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-pet-version-'));
    try {
      assert.equal(readElectronVersion(join(dir, 'electron.exe')), undefined);
      writeFileSync(join(dir, 'version'), 'not-a-version');
      assert.equal(readElectronVersion(join(dir, 'electron.exe')), undefined);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('HelperProcess - Backoff/fuse **wiring** (outside pure functions, the call point itself)', () => {
  const sleep = (ms: number) => new Promise((resolve2) => setTimeout(resolve2, ms));

  /**
   * Build an instance that "collapses when pulled up": spawn cannot be true in the test process (stdio goes to pipe),
   * so start() is replaced by "set timestamp → return to scheduleRestart immediately", which is equivalent to the
   * child process exit The real path taken later (counting, backoff, circuit breaker, and logs are all real code).
   */
  function makeCrashing(logs: string[]): HelperProcess {
    const hp = new HelperProcess(
      {},
      {
        warn: (m: unknown) => logs.push(String(m)),
        error: (m: unknown) => logs.push(String(m)),
      },
    );
    const internals = hp as unknown as { lastStartAt: number; scheduleRestart(): void; start(): void };
    internals.start = () => {
      internals.lastStartAt = Date.now(); // Every time it is started anew and crashes immediately → it can never be considered "stable operation"
      internals.scheduleRestart();
    };
    return hp;
  }

  /** Run a crash loop and return the logs generated during the period; the value of env is restored in finally */
  async function runCrashLoop(env: Record<string, string>, windowMs: number): Promise<string[]> {
    const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
    for (const [k, v] of Object.entries(env)) process.env[k] = v;
    const logs: string[] = [];
    const hp = makeCrashing(logs);
    try {
      hp.start();
      await sleep(windowMs);
    } finally {
      hp.stop('test-done');
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
    return logs;
  }

  test('First crash waiting for base (default 750 ms), not 2× base', async () => {
    // The first delay must be base: the count cannot be incremented before calculating the delay (otherwise, count 1 takes 2^1 = 2× base, and the first delay becomes 1500 ms)
    const logs = await runCrashLoop({ DSH_PET_RESTART_BASE_MS: '1' }, 20);
    const first = logs.find((l) => l.includes('restarting in'));
    assert.ok(first, 'There should be a restart alarm');
    assert.match(first, /restarting in 1ms/);
  });

  test('DSH_PET_RESTART_MAX_FAILURES true access judgment: Set 3 → the fuse will be blown on the third time', async () => {
    // DSH_PET_RESTART_MAX_FAILURES must be connected to the judgment: it cannot only appear in the log copy, and the judgment still uses the default value 12
    const logs = await runCrashLoop({ DSH_PET_RESTART_BASE_MS: '1', DSH_PET_RESTART_MAX_FAILURES: '3' }, 60);
    const tripped = logs.find((l) => l.includes('circuit breaker tripped'));
    assert.ok(tripped, 'The fuse should be blown according to the user-set threshold.');
    assert.match(tripped, /crashed 3 consecutive times/);
  });
});

describe('helperSpawnEnv - spawn environment structure (issue #63: ELECTRON_RUN_AS_NODE key must be deleted)', () => {
  test('The host environment is contaminated → There is no such key in the constructed env', () => {
    // The host ( DSH Desktop ) itself is a Electron application, and process.env may carry it; if passed through,
    // helper will start in pure Node mode, and require (' electron ') will directly MODULE_NOT_FOUND (crash → restart
    // → 12 meltdowns)
    const saved = process.env.ELECTRON_RUN_AS_NODE;
    process.env.ELECTRON_RUN_AS_NODE = '1';
    try {
      const env = helperSpawnEnv(1234);
      assert.equal(
        'ELECTRON_RUN_AS_NODE' in env,
        false,
        'The key must be deleted: setting an empty string will make Electron directly abort',
      );
      assert.equal(env.DSH_PET_HOST_PID, '1234');
    } finally {
      if (saved === undefined) delete process.env.ELECTRON_RUN_AS_NODE;
      else process.env.ELECTRON_RUN_AS_NODE = saved;
    }
  });

  test('caller explicitly gives this key in extra → delete it as well (what we want is always the real Electron main process)', () => {
    const env = helperSpawnEnv(7, { ELECTRON_RUN_AS_NODE: '1', DSH_PET_BRIDGE: '1' });
    assert.equal('ELECTRON_RUN_AS_NODE' in env, false);
    assert.equal(env.DSH_PET_BRIDGE, '1');
    assert.equal(env.DSH_PET_HOST_PID, '7');
  });

  test('The remaining host environment variables are inherited as usual, extra overwrites the key with the same name', () => {
    const saved = process.env.DSH_PET_TEST_MARKER;
    process.env.DSH_PET_TEST_MARKER = 'from-host';
    try {
      const env = helperSpawnEnv(1, { DSH_PET_TEST_MARKER: 'from-extra' });
      assert.equal(env.DSH_PET_TEST_MARKER, 'from-extra');
      assert.equal(helperSpawnEnv(1).DSH_PET_TEST_MARKER, 'from-host');
    } finally {
      if (saved === undefined) delete process.env.DSH_PET_TEST_MARKER;
      else process.env.DSH_PET_TEST_MARKER = saved;
    }
  });
});

describe('HelperProcess.stopAndWait - To stop, wait for the process to actually exit (issue #64)', () => {
  /** Fake child process: Only the three kill/exitCode/exit events are needed to avoid the real spawn in the test (stdio is replaced by pipe) */
  class FakeChild extends EventEmitter {
    exitCode: number | null = null;
    signalCode: NodeJS.Signals | null = null;
    signals: string[] = [];
    kill(signal?: string): boolean {
      this.signals.push(signal ?? 'SIGTERM');
      return true;
    }
    exit(): void {
      this.exitCode = 0;
      this.emit('exit', 0, null);
    }
  }

  function fakeHelper(timeoutMs: number) {
    const logs: string[] = [];
    const hp = new HelperProcess({}, { warn: (m: unknown) => logs.push(String(m)) });
    const fake = new FakeChild();
    (hp as unknown as { child?: FakeChild }).child = fake;
    return { fake, logs, stop: () => hp.stopAndWait('test', timeoutMs) };
  }

  test('Normal exit: only SIGTERM is sent, no upgrade is performed, Promise is resolve when exit', async () => {
    const { fake, stop } = fakeHelper(1000);
    const p = stop();
    setTimeout(() => fake.exit(), 10);
    await p;
    assert.deepEqual(fake.signals, ['SIGTERM']);
  });

  test('Timeout failed → Upgrade SIGKILL (not infinite wait)', async () => {
    const { fake, logs, stop } = fakeHelper(20);
    const p = stop();
    setTimeout(() => fake.exit(), 40); // Simulation "exits only after SIGKILL"
    await p;
    assert.deepEqual(fake.signals, ['SIGTERM', 'SIGKILL']);
    assert.ok(
      logs.some((l) => l.includes('SIGKILL')),
      'There must be a log for the upgrade action',
    );
  });

  test('Even SIGKILL will not be returned → Still resolve after the grace period (never hang the configuration save)', async (t) => {
    // FakeChild does not have a real process handle to support the event loop (the produced watchdog is unref), so the
    // two deadlines are explicitly advanced here.
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { fake, stop } = fakeHelper(20);
    let settled = false;
    const pending = stop().then(() => {
      settled = true;
    });
    t.mock.timers.tick(20);
    assert.deepEqual(fake.signals, ['SIGTERM', 'SIGKILL']);
    await Promise.resolve();
    assert.equal(settled, false);
    t.mock.timers.tick(HELPER_STOP_GRACE_MS);
    await pending;
    assert.equal(settled, true);
  });

  test('The child process that has exited → resolve immediately, no monitoring', async () => {
    const { fake, stop } = fakeHelper(1000);
    fake.exitCode = 0;
    const started = Date.now();
    await stop();
    assert.ok(Date.now() - started < 50);
    assert.deepEqual(fake.signals, ['SIGTERM']);
  });
});

describe('HelperProcess failed spawn recovery', () => {
  test('keeps a running child after a non-spawn error', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-pet-live-child-'));
    const hp = new HelperProcess(
      { command: process.execPath, args: ['-e', 'setInterval(() => {}, 1000)'], cwd: dir },
      {},
    );
    try {
      const child = hp.start()!;
      await once(child, 'spawn');
      child.emit('error', Object.assign(new Error('kill denied'), { code: 'EPERM' }));
      assert.equal(hp.start(), child, 'a live child must not be replaced after a failed operation');
    } finally {
      await hp.stopAndWait('test-cleanup', 100);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  for (const code of ['ENOENT', 'EACCES']) {
    test(
      `retries ${code} after the executable is repaired`,
      { skip: code === 'EACCES' && process.platform === 'win32', timeout: 10000 },
      async () => {
        const dir = mkdtempSync(join(tmpdir(), 'dsh-pet-spawn-'));
        const command = join(dir, 'electron');
        if (code === 'EACCES') writeFileSync(command, '#!/bin/sh\nexit 0\n', { mode: 0o600 });
        const options = { command, args: ['-e', 'console.log("helper-recovered")'], cwd: dir };
        const logs: string[] = [];
        let recovered!: () => void;
        const ready = new Promise<void>((resolve) => {
          recovered = resolve;
        });
        const hp = new HelperProcess(options, {
          warn: (message) => {
            logs.push(String(message));
          },
          error: (message) => {
            logs.push(String(message));
          },
          debug: (message) => {
            if (String(message).includes('helper-recovered')) recovered();
          },
        });
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
          const child = hp.start()!;
          const [error] = await once(child, 'error');
          assert.equal(error.code, code);
          // Fix configured executable before existing backoff expires.
          options.command = process.execPath;
          await Promise.race([
            ready,
            new Promise<never>((_, reject) => {
              timeout = setTimeout(() => reject(new Error('helper did not recover after failed spawn')), 5000);
            }),
          ]);
          assert.equal(logs.filter((line) => line.includes('failed to start')).length, 1);
          assert.equal(logs.filter((line) => line.includes('restarting in')).length, 1);
        } finally {
          clearTimeout(timeout);
          await hp.stopAndWait('test-cleanup', 100);
          rmSync(dir, { recursive: true, force: true });
        }
      },
    );
  }
});
