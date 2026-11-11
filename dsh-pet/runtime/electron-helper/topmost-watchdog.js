/**
 * The always-on-top watchdog of desktop Helper (pure judgment, can be loaded directly by node:test). `WS_EX_TOPMOST`
 * is just a style bit: without SetWindowPos (HWND_TOPMOST), it is not really dropped, and click-through
 * read-modify-write will write the bit back - the bit check will always get true, but the pet has sunk to the bottom.
 * The watchdog is re-pinned once per beat without moving, zooming, redrawing, or grabbing focus; the price is that the
 * pet will be lifted above all always-on-top windows, interrupting full-screen games and screenshots. Closed by
 * default: Do not hang a background action with high side effect for a long time until the cause is identified, and
 * accept the above price before reopening.
 * @module dsh-pet/runtime/electron-helper/topmost-watchdog
 */

'use strict';

/** watchdog beat (ms): how often to make a judgment. Determine yourself not to touch the window, only decide whether to re-pin this shot */
const TOPMOST_WATCHDOG_TICK_MS = 1000;

/** Minimum interval in milliseconds between SetWindowPos calls that reassert always-on-top, avoiding contention with other pinned windows. */
const TOPMOST_REASSERT_MS = 5000;

/** macOS uses a normal floating layer to make way for a higher-level screenshot window; other platforms maintain the original behavior */
function topmostLevel(platform) {
  return platform === 'darwin' ? 'floating' : 'screen-saver';
}

/**
 * always-on-top watchdog master switch (only switch). Currently closed: SetWindowPos is not sent even once.
 *
 * After closing, the timer still idles on a tick basis (one pure decision per second, negligible overhead) because the
 * source code guard test is anchored on `topmostTimer = setInterval(...)` .
 */
const TOPMOST_WATCHDOG_ENABLED = false;

/**
 * Do you want to re-always-on-top this shot?
 *
 * true is only returned when the window is alive, visible, not suspended by the smoke self-check, and it has been long
 * enough since the last re-pin: it is meaningless to pin it during the hidden period, and it will interfere with the
 * assertion during the self-check; these conditions can change at any time, so it is judged once every second. If this
 * beat is blocked, it will be filled in the next tick.
 *
 * @param state - nowMs/lastAssertMs/destroyed/visible/paused.
 * @param enabled - Default is true, which is the convention of the decision logic itself; production is passed
 * explicitly to the master switch by main.js.
 * @returns Whether to re-pin.
 */
function shouldReassertTopmost(state, enabled = true) {
  if (!enabled) return false;
  const { nowMs, lastAssertMs, destroyed, visible, paused } = state || {};
  if (destroyed || !visible || paused) return false;
  const elapsed = nowMs - lastAssertMs;
  // Only if "time passes normally and has not reached the end yet" will it not be pinned; clock rollback/timestamp exceptions will be handled as if the time has passed (re-pinning has no side effect)
  return !(elapsed >= 0 && elapsed < TOPMOST_REASSERT_MS);
}

module.exports = {
  TOPMOST_WATCHDOG_TICK_MS,
  TOPMOST_REASSERT_MS,
  TOPMOST_WATCHDOG_ENABLED,
  shouldReassertTopmost,
  topmostLevel,
};
