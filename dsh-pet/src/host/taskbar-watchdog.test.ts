/**
 * Determination of "taskbar watchdog" on desktop helper.
 *
 * `skipTaskbar` on Windows is just `ITaskbarList::DeleteTab` once, do not write `WS_EX_TOOLWINDOW` ; after explorer
 * crashes and restarts or wakes up, shell rebuilds the taskbar, the button will be re-registered, and the timing
 * cannot be enumerated - it can only be reiterated at a low frequency. This document specifies the judgment rules:
 * polling is only performed when Windows and the main switch is turned on; the environment variable is turned off only
 * when `0` / `false` is explicitly set.
 *
 * Use Node to build test runner (node:test) without introducing any npm dependencies.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const helper = '../../runtime/electron-helper/';
const {
  TASKBAR_WATCHDOG_ENABLED,
  TASKBAR_WATCHDOG_TICK_MS,
  shouldRunTaskbarWatchdog,
  taskbarWatchdogEnabledFromEnv,
} = require(helper + 'taskbar-watchdog.js');

describe('shouldRunTaskbarWatchdog - only polling when Windows is enabled', () => {
  test('Windows + Turn on: polling', () => {
    assert.equal(shouldRunTaskbarWatchdog('win32', true), true);
  });

  test('Windows + Close: Do not pick it off even once', () => {
    assert.equal(
      shouldRunTaskbarWatchdog('win32', false),
      false,
      'The event drive must be completely returned when the main switch is turned off',
    );
  });

  test('macOS / Linux: No polling', () => {
    assert.equal(shouldRunTaskbarWatchdog('darwin', true), false, 'macOS has no taskbar');
    assert.equal(
      shouldRunTaskbarWatchdog('linux', true),
      false,
      'skipTaskbar of Linux depends on WM and behaves differently',
    );
  });

  test('Default compile-time default switch', () => {
    assert.equal(shouldRunTaskbarWatchdog('win32'), TASKBAR_WATCHDOG_ENABLED);
  });
});

describe('taskbarWatchdogEnabledFromEnv - only closed if explicit 0/false', () => {
  test('Not set: On', () => {
    assert.equal(
      taskbarWatchdogEnabledFromEnv(undefined),
      true,
      'Keep it open when it is missing. It cannot be removed just because the environment variable is not matched.',
    );
  });

  test("Explicit '0' / ' false ': off", () => {
    assert.equal(taskbarWatchdogEnabledFromEnv('0'), false);
    assert.equal(taskbarWatchdogEnabledFromEnv('false'), false);
  });

  test("'1' / ' true ' / Others: On", () => {
    assert.equal(taskbarWatchdogEnabledFromEnv('1'), true);
    assert.equal(taskbarWatchdogEnabledFromEnv('true'), true);
    assert.equal(
      taskbarWatchdogEnabledFromEnv('yes'),
      true,
      'Watchdog cannot be turned off accidentally after writing a bad value',
    );
  });
});

test('Beat: integer milliseconds, and falls within a reasonable range', () => {
  assert.ok(Number.isInteger(TASKBAR_WATCHDOG_TICK_MS), 'The beat must be an integer millisecond');
  assert.ok(
    TASKBAR_WATCHDOG_TICK_MS > 0 && TASKBAR_WATCHDOG_TICK_MS <= 10000,
    'The beat should be between 0–10 s: too short wastes COM calls, too long the button takes too long',
  );
});
