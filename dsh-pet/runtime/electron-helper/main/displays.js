'use strict';
/**
 * Monitor hot update: resolution, scaling, plugging and rotating will invalidate the desktop geometry. Here it is
 * recalculated and pushed to all windows.
 *
 * Events will occur continuously, and will only be recalculated once after debouncing; the main screen zoom may change
 * at the same time, and when linearization takes effect, only the cache will be refreshed and a restart will be
 * prompted.
 * @module dsh-pet/runtime/electron-helper/main/displays
 */

/**
 * subscribe display changes and push.
 *
 * @param deps.screen - Electron screen.
 * @param deps.petWindows - Window capabilities (geometry, window table, taskbar).
 * @param deps.dpi - DPI capabilities (forcedScale / primaryScale / probePrimaryScale).
 * @returns recalculates once and debouncing two entry points immediately.
 */
function createDisplaySync({ screen, petWindows, dpi }) {
  // Monitor hot update: resolution/scaling changes, screen insertion and removal, and rotation will cause the desktop
  // geometry to become invalid (originally it was only injected once by query when building the window, and was never
  // updated during runtime). This is recalculated and pushed to all windows, and the renderer is resuspended in place.
  let displaysTimer = null;
  const pushDisplays = () => {
    const geo = petWindows.geometry();
    petWindows.state.lastRequestedBounds.clear(); // The coordinate system has changed, the deduplicate cache is invalid, and it must be reset in the next frame.
    for (const win of petWindows.state.windows.values()) {
      if (win.isDestroyed()) continue;
      // Monitor topology changes also trigger taskbar button rebuilding
      petWindows.keepOffTaskbar(win);
      win.webContents.send('pet:displays', geo);
    }
    console.error('[dsh-pet-desktop-helper] displays changed: ' + JSON.stringify(geo));
    // The main screen zoom may have changed at the same time: during the linearization period, screen API only reports
    // the forced value, and the real value can only be obtained by detecting the sub-process; if it is inconsistent,
    // refresh the cache and use it automatically next time it is started.
    if (dpi.forcedScale > 0) {
      setTimeout(() => {
        const real = dpi.probePrimaryScale();
        if (real > 0 && Math.abs(real - dpi.primaryScale) > 1e-6) {
          console.error(
            '[dsh-pet-desktop-helper] primary scaleFactor changed ' +
              dpi.primaryScale +
              ' -> ' +
              real +
              '; restart the desktop pet to resize',
          );
        }
      }, 1000).unref?.();
    }
  };
  /** Display events will be sent continuously (several events can occur at one time), and will only be recalculated once after debouncing. */
  const scheduleDisplays = () => {
    if (displaysTimer) clearTimeout(displaysTimer);
    displaysTimer = setTimeout(() => {
      displaysTimer = null;
      pushDisplays();
    }, 300);
  };
  screen.on('display-metrics-changed', scheduleDisplays);
  screen.on('display-added', scheduleDisplays);
  screen.on('display-removed', scheduleDisplays);

  return { push: pushDisplays, schedule: scheduleDisplays };
}

module.exports = { createDisplaySync };
