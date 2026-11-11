/**
 * Determination of desktop helper "always-on-top watchdog" + source code guard.
 *
 * Background: Windows dual screen + DSH When the main window is maximized, the desktop pet sinks completely below the
 * main window - the process is alive and the rendering is normal, but it is invisible; z The normal window is on top
 * of the desktop pet window, but the `WS_EX_TOPMOST` bit of the desktop pet window is still true.
 *
 * Root cause shape: `WS_EX_TOPMOST` is just the style bit, which does not mean that the window is in the always-on-top
 * band. This bit must rely on `SetWindowPos(HWND_TOPMOST/HWND_NOTOPMOST)` to really drop the tape. Directly writing to
 * `GWL_EXSTYLE` write-only bit will not drop the tape; and Electron flips and clicks on Windows to read-modify-write
 * `SetWindowLong(GWL_EXSTYLE)` . Therefore, "bit present, tape absent" may appear but cannot be found out. There is no
 * review after the `setAlwaysOnTop` when the window was created. An external z program disturbance can make the
 * desktop pet permanently invisible until helper restarts.
 *
 * Three things are nailed in this document: ① Judgment rules: Re-pin only when the point is reached; Do not pin during
 * the hide/destroy/self-test suspension period (next tick will be added); ② Constant invariant: The beat must be
 * faster than the re-pin interval, otherwise it will degenerate into "pin every tick"; ③ Source code guard: main.js
 * must be wired according to this set of rules, and watchdog can only re-pin always-on-top. , must not
 * move/scale/disappear/steal focus (those are the responsibilities of the renderer and other channels).
 *
 * Use Node to build test runner (node:test) without introducing any npm dependencies.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const helper = '../../runtime/electron-helper/';
const {
  TOPMOST_WATCHDOG_TICK_MS,
  TOPMOST_REASSERT_MS,
  TOPMOST_WATCHDOG_ENABLED,
  shouldReassertTopmost,
  topmostLevel,
} = require(helper + 'topmost-watchdog.js');

/** Source code of files in the package (for guarding; relative to src/host / parsing) */
const readSource = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

/** A baseline status of "window alive, visible, not suspended" */
const alive = { destroyed: false, visible: true, paused: false };

test('macOS makes way for the screenshot floating layer, while other platforms maintain the original always-on-top layer.', () => {
  assert.equal(topmostLevel('darwin'), 'floating');
  assert.equal(topmostLevel('win32'), 'screen-saver');
  assert.equal(topmostLevel('linux'), 'screen-saver');
});

describe('shouldReassertTopmost - Re-pin at the specified time, ask once every tick', () => {
  test('Don’t nail it before reaching the point, nail it when it reaches the point.', () => {
    assert.equal(
      shouldReassertTopmost({ ...alive, nowMs: 1000, lastAssertMs: 1000 }),
      false,
      'You cannot pin again immediately after being pinned (otherwise SetWindowPos will be used once per tick)',
    );
    assert.equal(
      shouldReassertTopmost({ ...alive, nowMs: 1000 + TOPMOST_REASSERT_MS - 1, lastAssertMs: 1000 }),
      false,
      'Bad 1 ms Not nailed',
    );
    assert.equal(
      shouldReassertTopmost({ ...alive, nowMs: 1000 + TOPMOST_REASSERT_MS, lastAssertMs: 1000 }),
      true,
      'It must be nailed when the point is reached',
    );
  });

  test('Never nail it during the period of hiding/destroy/self-test suspension, even if it is already done.', () => {
    const due = { nowMs: 1000 + TOPMOST_REASSERT_MS * 10, lastAssertMs: 1000 };
    assert.equal(
      shouldReassertTopmost({ ...due, ...alive, visible: false }),
      false,
      'It makes no sense to pin the window without show',
    );
    assert.equal(
      shouldReassertTopmost({ ...due, ...alive, destroyed: true }),
      false,
      'The window has been destroyed and cannot be touched again.',
    );
    assert.equal(
      shouldReassertTopmost({ ...due, ...alive, paused: true }),
      false,
      'Do not insert a pin during the smoke self-test suspension (same switch as fallback polling)',
    );
    assert.equal(shouldReassertTopmost({ ...due, visible: true }), true, 'Still on target but not stopped');
  });

  test('Timestamp exception (clock rollback/missing parameters) is handled according to the point; if visible is not declared, it will not be pinned', () => {
    assert.equal(
      shouldReassertTopmost({ ...alive, nowMs: 1000, lastAssertMs: 10_000 }),
      true,
      'Setting the clock back does not make the watchdog permanently misfired',
    );
    assert.equal(shouldReassertTopmost({ ...alive, nowMs: Number.NaN, lastAssertMs: 1000 }), true);
    assert.equal(
      shouldReassertTopmost({ destroyed: false, paused: false }),
      false,
      'You cannot pin without declaring visible',
    );
    assert.equal(shouldReassertTopmost(undefined), false, 'Missing status will be treated as unpinned.');
  });

  test('Constant invariant: beat must be faster than re-pin interval', () => {
    assert.ok(TOPMOST_WATCHDOG_TICK_MS > 0, 'The beat must be a positive number');
    assert.ok(
      TOPMOST_WATCHDOG_TICK_MS < TOPMOST_REASSERT_MS,
      'When the beat >= the re-pin interval, the judgment degenerates into fixing each tick, and the pure function is written in vain.',
    );
  });

  test('When the main switch is turned off, the nail is not nailed once even if it is already in place.', () => {
    const longDue = { ...alive, nowMs: 1000 + TOPMOST_REASSERT_MS * 10, lastAssertMs: 1000 };
    assert.equal(
      shouldReassertTopmost(longDue, false),
      false,
      'The main switch is the only entry point for disabling watchdog. It cannot be adjusted after it is turned off. SetWindowPos',
    );
    assert.equal(
      shouldReassertTopmost(longDue, true),
      true,
      'When it is explicitly turned on, it will be judged as usual (fixed when the point is reached)',
    );
    assert.equal(
      typeof TOPMOST_WATCHDOG_ENABLED,
      'boolean',
      'The master switch must be a Boolean value (cannot be undefined / character string, otherwise the early exit judgment will be released)',
    );
  });
});

describe('Source code guard - always-on-top watchdog must be wired according to this set of rules in main.js', () => {
  /** main process source code: main.js is the assembly root, and the behaviors are scattered in modules under main /. The guard must read the entire copy. */
  const mainSource = (dir: string): string =>
    [
      readSource(dir + 'main.js'),
      ...readdirSync(fileURLToPath(new URL(dir + 'main/', import.meta.url)))
        .filter((name) => name.endsWith('.js'))
        .map((name) => readSource(dir + 'main/' + name)),
    ].join('\n');
  const main = mainSource(helper);
  /** watchdog timer body (anchored on the assignment of topmostTimer to avoid matching earlier setInterval) */
  const watchdogBody = (): string => {
    const m = /topmostTimer = setInterval\(\(\) => \{([\s\S]*?)\}, TOPMOST_WATCHDOG_TICK_MS\);/.exec(main);
    assert.ok(m, 'watchdog timer not found (beat must be named constant TOPMOST_WATCHDOG_TICK_MS)');
    return m[1];
  };

  test('always-on-top cannot be deleted when creating a window, and watchdog uses the same platform level', () => {
    assert.ok(
      /win\.setAlwaysOnTop\(true, topmostLevel\(process\.platform\)\);/.test(main),
      'When building a window, you must first always-on-top once (watchdog is only responsible for review and cannot be used as the only source of always-on-top)',
    );
    assert.ok(
      (main.match(/win\.setAlwaysOnTop\(true, topmostLevel\(process\.platform\)\)/g) ?? []).length >= 2,
      'The watchdog must be nailed to the same gear again (HWND_TOPMOST depends on it for falling belt; HWND_TOP of moveTop is invalid for the window that has sunk to the bottom)',
    );
    assert.ok(
      /require\('\.\.\/topmost-watchdog\.js'\)/.test(main),
      'The watchdog judgment must reuse runtime/electron-helper/topmost-watchdog.js (pure logic has a single test)',
    );
    assert.ok(
      !/win\.moveTop\(/.test(main),
      'moveTop ()= HWND_TOP does not fall into the always-on-top band and must not be used as fallback.',
    );
  });

  test('watchdog runs according to the decision function + named beat, and stops when the window is closed', () => {
    assert.ok(/shouldReassertTopmost\(/.test(main), 'Pure judgment must be called');
    assert.ok(
      /TOPMOST_WATCHDOG_ENABLED/.test(watchdogBody()),
      'The judgment must explicitly pass in the main switch, otherwise the switch will not take effect if it is changed.',
    );
    const body = watchdogBody();
    assert.ok(/win\.isDestroyed\(\)/.test(body), 'The judgment must include "Window has been destroyed"');
    assert.ok(/win\.isVisible\(\)/.test(body), 'The judgment must include "window visible" (not nailed when not show)');
    assert.ok(/pointerFallbackPaused/.test(body), 'It is determined that a self-test suspend switch must be provided');
    assert.ok(/lastAssertMs: lastTopmostAssertMs/.test(body), 'The last re-pin time must be brought into the judgment');
    assert.ok(/clearInterval\(topmostTimer\)/.test(main), 'watchdog must be stopped when the window is closed');
  });

  test('watchdog only re-pins always-on-top: it is not allowed to move/zoom/show/hide/grab the focus easily', () => {
    const body = watchdogBody();
    for (const forbidden of [
      'setContentBounds',
      'setBounds',
      'win.show(',
      'win.hide(',
      'win.focus(',
      'setIgnoreMouseEvents',
    ]) {
      assert.ok(
        !body.includes(forbidden),
        `${forbidden} must not appear in the watchdog body (position/hidden/input transparent transmission each has its own dedicated channel, and if it gets mixed in, it will conflict with each other)`,
      );
    }
  });
});
