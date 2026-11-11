/**
 * Desktop taskbar watchdog (pure judgment, can be loaded directly by node:test). `skipTaskbar` on Windows is just
 * `ITaskbarList::DeleteTab` once, do not write `WS_EX_TOOLWINDOW` : shell Once the taskbar is rebuilt (explorer crash
 * restarts, wakes up, monitor topology changes), the button will be re-registered, and the rebuild time cannot be
 * enumerated. watchdog is picked again according to a fixed beat - `DeleteTab` is idempotent and has no visual side
 * effect. Repeated calls will not interrupt the full screen or grab focus.
 * @module dsh-pet/runtime/electron-helper/taskbar-watchdog
 */

'use strict';

/** watchdog beat (ms): shell After rebuilding the taskbar, take off the button at the latest */
const TASKBAR_WATCHDOG_TICK_MS = 3000;

/** watchdog default switch; production is covered by main.js by DSH_PET_TASKBAR_WATCHDOG environment variable */
const TASKBAR_WATCHDOG_ENABLED = true;

/**
 * Do you want to reiterate skipTaskbar for this shot?
 *
 * @param platform - process.platform.
 * @param enabled - main switch; the default is TASKBAR_WATCHDOG_ENABLED.
 * @returns is only Windows and when turned on is true .
 */
function shouldRunTaskbarWatchdog(platform, enabled = TASKBAR_WATCHDOG_ENABLED) {
  return enabled && platform === 'win32';
}

/**
 * Parse environment variable switch: only explicit `0` / `false` is turned off, and remains on when missing or written
 * bad.
 *
 * @param raw - The original value of `DSH_PET_TASKBAR_WATCHDOG` .
 * @returns Whether watchdog is enabled.
 */
function taskbarWatchdogEnabledFromEnv(raw) {
  return raw !== '0' && raw !== 'false';
}

module.exports = {
  TASKBAR_WATCHDOG_ENABLED,
  TASKBAR_WATCHDOG_TICK_MS,
  shouldRunTaskbarWatchdog,
  taskbarWatchdogEnabledFromEnv,
};
