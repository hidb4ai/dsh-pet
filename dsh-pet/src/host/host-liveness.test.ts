/**
 * Judgment test of issue #56 - "After the host exits, Electron helper crashes due to stdout EPIPE pop-up window/stays
 * on".
 *
 * Fact chain: helper's stdout/stderr is the pipe given by the host. The host disappears as soon as it exits the
 * reading end. The next write (bridge protocol line) gets EPIPE (Windows measured `EPIPE: broken pipe, write` );
 * unhandled 'error' event = uncaught exception, Electron main process Only the modal box pops up and does not exit;
 * the job object (KILL_ON_JOB_CLOSE) of Windows will kill the child process when the host exits, so that scene cannot
 * be fully seen on Windows, and macOS does not have this layer of fallback.
 *
 * Three things are nailed in this document: ① Pure determination rules (only recognize ESRCH when the host is gone;
 * only recognize EPIPE / ERR_STREAM_DESTROYED when the pipe is disconnected); ② Wiring of main.js: Pipe guard + host
 * detection are both in place, only go through the only exit, and the guard is written earlier than any time; ③ The
 * host side does pid It has been injected, and the new file is in the release required list (main.js will crash at
 * startup if it is missing).
 *
 * helper is the handwritten JS released with the package. Electron cannot be run on the development machine. The
 * wiring can only rely on source code assertion + pure function testing; use Node to build test runner (node:test)
 * without introducing any npm dependencies.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const helper = '../../runtime/electron-helper/';
const { HOST_POLL_MS, parseHostPid, hostIsGone, isBrokenPipeError } = require(helper + 'host-liveness.js');

/** Source code of files in the package (for guarding; relative to src/host / parsing) */
const readSource = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('parseHostPid —— host PID analysis', () => {
  test('Normal numbers are returned as they are (including leading and trailing blanks)', () => {
    assert.equal(parseHostPid('12345'), 12345);
    assert.equal(parseHostPid(' 42 '), 42);
  });

  test('Not set / empty / not a number / a non-positive number → 0 (the caller does not detect accordingly)', () => {
    for (const raw of [undefined, null, '', '   ', 'abc', 'abc123', '0', '-7', 'NaN']) {
      assert.equal(parseHostPid(raw as string), 0, 'raw=' + String(raw));
    }
  });
});

describe('hostIsGone - Only ESRCH is considered "host gone"', () => {
  test('Survival: kill ( pid , 0) normal return → false', () => {
    assert.equal(
      hostIsGone(4242, () => undefined),
      false,
    );
  });

  test('Only existence check: signal must be 0 (never actually sends a signal to the host)', () => {
    const calls: Array<[number, number]> = [];
    hostIsGone(4242, (pid: number, signal: number) => {
      calls.push([pid, signal]);
    });
    assert.deepEqual(calls, [[4242, 0]]);
  });

  test('ESRCH → true (the process is indeed gone)', () => {
    assert.equal(
      hostIsGone(4242, () => {
        throw Object.assign(new Error('kill ESRCH'), { code: 'ESRCH' });
      }),
      true,
    );
  });

  test('EPERM / Other error codes should be treated as alive (the process is alive, but we should not touch it)', () => {
    for (const code of ['EPERM', 'EINVAL', 'EACCES', 'ECONNREFUSED']) {
      assert.equal(
        hostIsGone(4242, () => {
          throw Object.assign(new Error(code), { code });
        }),
        false,
        'code=' + code,
      );
    }
    // If the throw is not Error (there is no code), it will not be sentenced to death.
    assert.equal(
      hostIsGone(4242, () => {
        throw 'boom';
      }),
      false,
    );
  });

  test('**Never** will result in death when pid is invalid (not injected/parsed failed) - even if the detection function says ESRCH', () => {
    const esrch = () => {
      throw Object.assign(new Error('kill ESRCH'), { code: 'ESRCH' });
    };
    assert.equal(hostIsGone(0, esrch), false);
    assert.equal(hostIsGone(-1, esrch), false);
    assert.equal(hostIsGone(Number.NaN, esrch), false);
  });
});

describe('isBrokenPipeError - Only "the peer end of the pipe is gone" counts', () => {
  test('EPIPE / ERR_STREAM_DESTROYED → true (the real machine is EPIPE: broken pipe, write)', () => {
    assert.equal(isBrokenPipeError(Object.assign(new Error('write EPIPE'), { code: 'EPIPE' })), true);
    assert.equal(isBrokenPipeError(Object.assign(new Error('destroyed'), { code: 'ERR_STREAM_DESTROYED' })), true);
  });

  test('Other errors / non-Error / character string with the same name → false (cannot be fooled by "look-alike")', () => {
    for (const value of [
      Object.assign(new Error('reset'), { code: 'ECONNRESET' }),
      Object.assign(new Error('invalid'), { code: 'EINVAL' }),
      new Error('no code'),
      'EPIPE',
      null,
      undefined,
    ]) {
      assert.equal(isBrokenPipeError(value), false, String(value));
    }
  });

  test('The detection interval is still 2 s (the host has gone up to 2 s to converge)', () => {
    assert.equal(HOST_POLL_MS, 2000);
  });
});

describe('Guard: Both paths of main.js must be in place (helper is released with the package, only the source code assertion can be read)', () => {
  const main = readSource(helper + 'main.js');

  test('Pipe guard (A): Both streams are linked to error, and the only exit is taken when disconnected', () => {
    assert.ok(/require\('\.\/host-liveness\.js'\)/.test(main), 'Required require host-liveness.js');
    assert.ok(
      /for \(const stream of \[process\.stdout, process\.stderr\]\)/.test(main),
      'Both stdout and stderr need to be hung (both are pipes provided by the host)',
    );
    assert.ok(/stream\.on\('error'/.test(main), 'error monitoring must be really installed');
    assert.ok(
      /if \(isBrokenPipeError\(error\)\) exitForDeadHost\(\)/.test(main),
      'Pipe disconnected = host is dead → exit immediately',
    );
  });

  test('The only exit and only one return: hostGone deduplicate + app.exit (0)', () => {
    assert.ok(/let hostGone = false;/.test(main), 'must have deduplicate flag');
    assert.ok(
      /function exitForDeadHost\(\) \{\s*if \(hostGone\) return;/.test(main),
      'Repeated triggering only returns once',
    );
    assert.ok(/app\.exit\(0\)/.test(main), 'Use app.exit (process.exit in Electron main process is not clean)');
  });

  test('host detection (B): pid comes from env, only ESRCH returns, and the detection instance does not participate', () => {
    assert.ok(
      /const HOST_PID = parseHostPid\(process\.env\.DSH_PET_HOST_PID\)/.test(main),
      'pid must come from env injected by the host (not injected → 0 → not detected)',
    );
    assert.ok(
      /if \(!DPI_PROBE && HOST_PID > 0\)/.test(main),
      'pid illegal or DPI detection instances cannot be polled.',
    );
    assert.ok(
      /if \(hostIsGone\(HOST_PID\)\) exitForDeadHost\(\)/.test(main),
      'Determination of pure function, the export is the same',
    );
    assert.ok(/HOST_POLL_MS/.test(main), 'Interval must be a named constant (from host-liveness.js)');
  });

  test('The guard must be written earlier than **any time** (DPI will write to stderr if the detection fails)', () => {
    const guardAt = main.indexOf("stream.on('error'");
    // DPI detection has been split into main-dpi.js: main.js The first possible action to write stderr here is to build it
    const firstWriteAt = main.indexOf('createDpi({');
    assert.ok(guardAt > 0, 'Pipe guard not found');
    assert.ok(
      firstWriteAt > 0,
      'The DPI factory call point cannot be found (the file structure has changed, please synchronize this assertion)',
    );
    assert.ok(guardAt < firstWriteAt, 'Pipe guards must be installed before any possible write');
  });

  test('It is not allowed to add the global uncaughtException processor (it will override the behavior of Electron and swallow the real crash)', () => {
    assert.ok(
      !/process\.on\('uncaughtException'/.test(main),
      'Only treat "disconnected pipes", don\'t swallow the real crash - that will make troubleshooting more difficult',
    );
  });
});

describe('Guard: The host side must inject pid (otherwise B will never take effect)', () => {
  test('helper/child.ts: The only spawn point is injected into DSH_PET_HOST_PID via helperSpawnEnv', () => {
    const src = readSource('./helper/child.ts');
    assert.ok(
      /env: helperSpawnEnv\(process\.pid, this\.options\.env\)/.test(src),
      'env of spawn must be injected into host pid through helperSpawnEnv (placed at the only spawn point, all callers automatically obtain it)',
    );
  });

  test('helperSpawnEnv: Remove ELECTRON_RUN_AS_NODE that hijacks Electron boot mode (issue #63)', () => {
    const src = readSource('./helper/child.ts');
    assert.ok(
      /delete env\.ELECTRON_RUN_AS_NODE;/.test(src),
      'Must **delete key**: Transparent transmission of this variable by host (such as DSH Desktop) will cause helper to degenerate into pure Node mode, and require (" electron ") will crash directly.',
    );
    assert.ok(
      !/ELECTRON_RUN_AS_NODE: ''/.test(src),
      'It is not allowed to set it to an empty character string - actually measured under Electron 43.3.0, the empty string will be directly abort (exit 134)',
    );
  });

  test('start-desktop.mjs: The development stream also injects pid and deletes the variable.', () => {
    const src = readSource('../../scripts/start-desktop.mjs');
    assert.ok(/DSH_PET_HOST_PID: String\(process\.pid\)/.test(src), 'Development flow must also be followed');
    assert.ok(
      /delete env\.ELECTRON_RUN_AS_NODE;/.test(src),
      'This variable must also be guarded against when pulling up manually (issue #63)',
    );
  });
});

describe('Guard: host-liveness.js must be in the release required list', () => {
  test('required of prepack-check.js contains it (main.js require, if it is missing, it will crash at startup)', () => {
    const src = readSource('../../scripts/prepack-check.js');
    assert.ok(
      /'runtime\/electron-helper\/host-liveness\.js'/.test(src),
      'If it is missing, the npm package is missing a necessary module for main.js',
    );
  });
});
