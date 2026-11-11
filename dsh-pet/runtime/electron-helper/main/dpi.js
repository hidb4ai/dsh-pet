'use strict';
/**
 * DPI and pointer: detection and caching of main screen zoom, forced zoom switch, renderer scale conversion, cursor
 * position.
 *
 * Linearization must precede ready with appendSwitch, so the factory is called at the top level of main.js; the
 * detection subprocess reuses the same main.js (mainPath is passed in), and only types one line of scaleFactor to
 * exit.
 * @module dsh-pet/runtime/electron-helper/main-dpi
 */

const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { readFileSync, writeFileSync } = require('node:fs');
const { shouldLinearize, resolveForcedScale, resolvePetScale } = require('../dpi-linearization.js');

/**
 * Create DPI/pointer ability.
 *
 * @param deps.app - Electron app (userData path and command line switches).
 * @param deps.screen - Electron screen (main screen zoom and cursor fallback).
 * The absolute path of @param deps.mainPath - main.js: detect that the child process needs to restart the same script.
 * @param deps.linuxPointer - X11 pointer provider for Linux; other platforms pass null.
 * @param deps.dpiProbe - Whether this is the detection sub-process of "Print Zoom Only".
 * @param deps.dpiMark - Marker prefix in probe output.
 * @param deps.forceDsf - DSH_PET_FORCE_DSF Original value (unset i.e. undefined).
 */
function createDpi({ app, screen, mainPath, linuxPointer, dpiProbe, dpiMark, forceDsf }) {
  /**
   * Current cursor position (DIP). Linux : X11 Live value (physical pixels ÷ scale) of QueryPointer; not yet ready for
   * other platforms or queries: Electron native API .
   */
  function currentPointer() {
    const raw = linuxPointer && linuxPointer.get();
    if (!raw) return screen.getCursorScreenPoint();
    const scale = screen.getPrimaryDisplay().scaleFactor || 1;
    return scale === 1 ? raw : { x: Math.round(raw.x / scale), y: Math.round(raw.y / scale) };
  }

  /** Home screen zoom cache file (userData is available before ready) */
  function dpiCacheFile() {
    return path.join(app.getPath('userData'), 'primary-scale.json');
  }

  function readCachedPrimaryScale() {
    try {
      const v = Number(JSON.parse(readFileSync(dpiCacheFile(), 'utf8')).scaleFactor);
      return Number.isFinite(v) && v > 0 ? v : 0;
    } catch {
      return 0; // First startup/file corruption: Treat as no cache, re-detect
    }
  }

  function writeCachedPrimaryScale(value) {
    try {
      writeFileSync(dpiCacheFile(), JSON.stringify({ scaleFactor: value }), 'utf8');
    } catch (e) {
      console.error('[dsh-pet-desktop-helper] write dpi cache failed:', String(e && e.message ? e.message : e));
    }
  }

  /** Catch scaleFactor from the output of the probing child process (0 = not caught) */
  function parseProbeOutput(text) {
    const m = new RegExp(dpiMark + '([0-9.]+)').exec(String(text || ''));
    const v = m ? Number(m[1]) : 0;
    return Number.isFinite(v) && v > 0 ? v : 0;
  }

  /** Start the detection sub-process to read the main screen scaleFactor (the same electron + the same main.js, take the dpiProbe branch) */
  function probePrimaryScale() {
    const opts = {
      env: { ...process.env, DSH_PET_DPI_PROBE: '1', DSH_PET_BRIDGE: '0', DSH_PET_SMOKE: '0' },
      timeout: 20000,
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    };
    let out = '';
    try {
      // The detection sub-process must use the same set of switches as the main process: the automatic fallback of the
      // host on a machine that cannot be started from the sandbox will use --no-sandbox instead. Without it, the
      // detection sub-process will be 0x80000003 as soon as it is started. The main process is alive and cached but
      // can never be written out. It will be detected in vain every time it is turned on.
      const sandboxArgs = app.commandLine.hasSwitch('no-sandbox') ? ['--no-sandbox'] : [];
      out = execFileSync(process.execPath, [...sandboxArgs, mainPath, '--dsh-pet-dpi-probe'], opts);
    } catch (e) {
      // Only stdout is recognized, but the exit code is not recognized: The Electron process call app.exit() without
      // opening a window occasionally produces 0xC0000005 (exit period access violation) on Windows, but the value
      // has already been written out at that time, and throwing it away is a waste of a cold start.
      out = e && e.stdout ? String(e.stdout) : '';
      if (!parseProbeOutput(out)) {
        const detail = [
          e && e.status !== undefined ? 'status=' + e.status : '',
          e && e.stderr ? 'stderr=' + String(e.stderr).trim().slice(0, 300) : '',
        ]
          .filter(Boolean)
          .join(' ');
        console.error(
          '[dsh-pet-desktop-helper] dpi probe failed:',
          String(e && e.message ? e.message : e).split('\n')[0],
          detail,
        );
        return 0; // Detection failed: switch is not added and returns to screen-by-screen DIP behavior
      }
    }
    const v = parseProbeOutput(out);
    if (v > 0) writeCachedPrimaryScale(v);
    return v;
  }

  /** Real home screen scaleFactor (detected; 0 = unknown). After linearization is turned on, screen API will only report 1, so you can only rely on it. */
  let PRIMARY_SCALE = 0;
  /** Actual forced scaling (0 = not enabled, the coordinate system maintains the screen-by-screen DIP before repair) */
  let FORCED_SCALE = 0;
  if (shouldLinearize({ platform: process.platform, dpiProbe, forceDsf })) {
    // Detection failure can only be degraded to "no compensation", and the entire helper cannot be taken away: under
    // restricted token
    // Both getPath (' userData ') and the detection subprocess may fail, and the process will end directly before
    // ready without logs.
    try {
      PRIMARY_SCALE = readCachedPrimaryScale() || probePrimaryScale();
      const forced = resolveForcedScale({ forceDsf, primaryScale: PRIMARY_SCALE });
      if (forced > 0) {
        app.commandLine.appendSwitch('force-device-scale-factor', String(forced));
        FORCED_SCALE = forced;
      }
    } catch (error) {
      console.error(
        '[dsh-pet-desktop-helper] DPI detection failed; continuing without compensation:',
        String(error && error.message ? error.message : error),
      );
      PRIMARY_SCALE = 0;
      FORCED_SCALE = 0;
    }
  }

  /**
   * CONFIG.scale of renderer: Baseline × physical pixel compensation given by host. After linearization is turned on,
   * 1 logical pixel = 1 physical pixel, and the pet zooms back to the original look and feel according to the home
   * screen.
   */
  function petScale() {
    return resolvePetScale({
      baseScale: process.env.DSH_PET_SCALE,
      primaryScale: PRIMARY_SCALE,
      forcedScale: FORCED_SCALE,
    });
  }

  return {
    currentPointer,
    petScale,
    probePrimaryScale,
    readCachedPrimaryScale,
    get primaryScale() {
      return PRIMARY_SCALE;
    },
    get forcedScale() {
      return FORCED_SCALE;
    },
  };
}

module.exports = { createDpi };
