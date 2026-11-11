'use strict';
/**
 * Desktop pet window: window creation, full window click-through mirroring, pet status broadcast, taskbar retention,
 * and two real-time pumps.
 *
 * The window table and several tables indexed by window are exclusively used by this module (`state` is only used by
 * the assembly root and ipc of the same process, not as an external interface). The lifecycle of the two pumps follows
 * the window: it starts when the window is built, stops and clears the handle at `closed` - the pump itself is not
 * clear because there are other cleanups on the same window.
 * @module dsh-pet/runtime/electron-helper/main/windows
 */
const path = require('node:path');
const { pointerZone, decideWindowIgnore } = require('../pointer-target.js');
const { TOPMOST_WATCHDOG_ENABLED, TOPMOST_WATCHDOG_TICK_MS } = require('../topmost-watchdog.js');
const { TASKBAR_WATCHDOG_TICK_MS, shouldRunTaskbarWatchdog } = require('../taskbar-watchdog.js');

/** Cursor polling interval for fallback channel (ms). */
const POINTER_POLL_MS = 60;

/**
 * Create desktop window capabilities.
 *
 * @param deps.BrowserWindow - Electron BrowserWindow constructor.
 * @param deps.screen - Electron screen service for per-display geometry.
 * @param deps.buildDeskGeometry - Pure screen-list-to-geometry function from desktop-geometry.js.
 * @param deps.dpi - DPI and pointer helpers: petScale and currentPointer.
 * @param deps.helperDir - Absolute runtime/electron-helper directory containing index.html, preload.js and icons.
 * @param deps.isBridge - Whether the renderer should use the bridge protocol.
 * @param deps.openTarget - First menu item destination: desktop app, standalone settings or website.
 * @param deps.platform - Platform-specific tray and always-on-top decisions from tray-platform.js.
 * @param deps.shouldReassertTopmost - Pure watchdog predicate.
 * @param deps.topmostLevel - Platform-specific always-on-top level.
 * @param deps.taskbarWatchdogEnabled - Watchdog switch passed by main.js from DSH_PET_TASKBAR_WATCHDOG.
 */
function createWindows({
  BrowserWindow,
  screen,
  buildDeskGeometry,
  dpi,
  helperDir,
  isBridge,
  openTarget,
  platform,
  shouldReassertTopmost,
  topmostLevel,
  taskbarWatchdogEnabled,
}) {
  /** Window table: petId -> BrowserWindow */
  const windows = new Map();
  /** win.id -> Last requested content area rectangle (" x , y , w , h "): deduplicate benchmark of pet:set-bounds */
  const lastRequestedBounds = new Map();
  /** win.id -> Window margin `{ l, t }` reported by renderer: After the top margin is increased by bubble, the margin is no longer equal to the four sides, and the hit area cannot be reversed by width. */
  const winMargins = new Map();
  /** Mirror of the current click-through state of each window (Electron has no value API): all flips go through setWindowIgnore */
  const windowIgnore = new Map();
  /** The "renderer is holding the mouse to input" mark in each window is reported by the renderer via pet:input-busy */
  const inputBusy = new Map();
  /** The new renderer reports the local rectangle of the menu/chat box separately to avoid the entire window transparency margin swallowing up clicks in busy state. */
  const inputRegions = new Map();
  /** The continuous duration of "the cursor stops in the margin area and is not busy" in each window (ms): at the point where click-through is forced to resume by the fallback channel */
  const offBodyMs = new Map();
  /** Collision between pets broker status: petId -> { x , y , vx , vy , size , bottomPad } */
  const petStates = new Map();
  /** Pausing the fallback pump during smoke: it flips by the real cursor, which interferes with smoke's assertion on the renderer channel */
  let pointerFallbackPaused = false;

  /** The collision site is broadcast at most once every 16 ms, and the position is still submitted immediately by IPC frame by frame. */
  let petStateTimer = null;

  /** Broadcast the current full pet status to all windows (shared site for collision detection). */
  function broadcastPetStates() {
    if (petStateTimer !== null) {
      clearTimeout(petStateTimer);
      petStateTimer = null;
    }
    const states = {};
    for (const [pid, s] of petStates) {
      states[pid] = { x: s.x, y: s.y, vx: s.vx, vy: s.vy, size: s.size, bottomPad: s.bottomPad };
    }
    for (const win of windows.values()) {
      if (!win.isDestroyed()) win.webContents.send('pet:flight-states', states);
    }
  }

  /** Record/update the status of a pet and broadcast it. */
  function updatePetState(petId, partial) {
    const prev = petStates.get(petId) || { x: 0, y: 0, vx: 0, vy: 0, size: 0, bottomPad: 0 };
    const next = Object.assign({}, prev, partial);
    if (petStates.has(petId) && Object.keys(next).every((key) => Object.is(next[key], prev[key]))) return;
    petStates.set(petId, next);
    // There is no collision object in a single window; multiple windows merge updates within the same time period, and a scheduled callback reads the latest status and retains the last frame.
    if (windows.size < 2 || petStateTimer !== null) return;
    petStateTimer = setTimeout(broadcastPetStates, 16);
    petStateTimer.unref?.();
  }

  /** The only exit for flipping the entire window click-through: the status and image are always updated together (forward is retained during click-through). */
  function setWindowIgnore(win, ignore) {
    win.setIgnoreMouseEvents(ignore, { forward: true });
    windowIgnore.set(win.id, ignore);
  }

  /** Desktop geometry: screen-by-screen workspace, circumscribed rectangle, main screen subscript; boundary determination must be the union of areas instead of hull. */
  function deskGeometry() {
    return buildDeskGeometry(screen.getAllDisplays(), screen.getPrimaryDisplay().id, process.platform);
  }

  /** Desktop pet list ([{ id , size , index }]): host is transparently transmitted via DSH_PET_PETS; an empty array indicates that no window is explicitly created. */
  function petsFromEnv() {
    try {
      const arr = JSON.parse(process.env.DSH_PET_PETS || '');
      if (Array.isArray(arr)) {
        return arr.map((pet, index) => ({
          id: String(pet?.id ?? `pet-${index}`),
          size: Number(pet?.size) > 0 ? Number(pet.size) : 462,
          index,
        }));
      }
    } catch {
      /* fallthrough */
    }
    return [{ id: 'main', size: 462, index: 0 }];
  }

  /** The initial size of the window = pet bounding box + surrounding expansion margin; the first frame of the renderer will be accurately covered according to the real configuration. */
  function petWindowSize(size) {
    const height = (size * 9) / 16;
    const bottomPad = (size * (9 / 16) * (360 - 330)) / 360;
    const m = Math.round(size * 0.5);
    return { width: Math.round(size) + m * 2, height: Math.round(height + bottomPad) + m * 2 };
  }

  /** Single restatement (idempotent): The asynchronous reconstruction path of show is shared with watchdog. */
  function reassertTaskbar(win) {
    if (!win || win.isDestroyed()) return;
    win.setSkipTaskbar(true);
  }

  /** Remove the window from the taskbar: show followed by Shell will rebuild the button asynchronously, and the second call of 0 ms will count. */
  function keepOffTaskbar(win) {
    reassertTaskbar(win);
    setTimeout(() => reassertTaskbar(win), 0);
  }

  /** watchdog timer handle; null means not started. */
  let taskbarWatchdogTimer = null;

  /** Start taskbar watchdog: only Windows and the main switch is on; repeated calls have no side effect. */
  function startTaskbarWatchdog() {
    if (taskbarWatchdogTimer || !shouldRunTaskbarWatchdog(process.platform, taskbarWatchdogEnabled)) return;
    taskbarWatchdogTimer = setInterval(() => {
      for (const win of windows.values()) reassertTaskbar(win);
    }, TASKBAR_WATCHDOG_TICK_MS);
    taskbarWatchdogTimer.unref?.();
  }

  /** Stop watchdog: Called before the process exits to avoid the timer dragging the exit. */
  function stopTaskbarWatchdog() {
    if (!taskbarWatchdogTimer) return;
    clearInterval(taskbarWatchdogTimer);
    taskbarWatchdogTimer = null;
  }

  /** click-through fallback pump: The regular flip link only has the forward mouse hook, which may fail silently on Windows. */
  function startPointerFallback(win) {
    const pointerTimer = setInterval(() => {
      if (pointerFallbackPaused || win.isDestroyed()) return;
      const bounds = win.getBounds();
      if (bounds.width < 8 || bounds.height < 8) return; // The size has not yet been determined (before the first frame is reported)
      const ignoring = windowIgnore.get(win.id) !== false;
      const busy = inputBusy.get(win.id) === true;
      const point = dpi.currentPointer();
      const margin = winMargins.get(win.id);
      const zone = pointerZone(bounds, point, margin);
      const nextMs = !busy && zone === 'margin' ? (offBodyMs.get(win.id) ?? 0) + POINTER_POLL_MS : 0;
      offBodyMs.set(win.id, nextMs);
      const next = decideWindowIgnore(bounds, point, ignoring, busy, nextMs, inputRegions.get(win.id), margin);
      if (next !== ignoring) setWindowIgnore(win, next);
    }, POINTER_POLL_MS);
    return () => clearInterval(pointerTimer);
  }

  /** always-on-top watchdog: The fact that the WS_EX_TOPMOST bit is still there does not mean that it is really in the always-on-top band. Reset the low frequency (see TOPMOST_WATCHDOG_ENABLED for the main switch). */
  function startTopmostWatchdog(win) {
    let lastTopmostAssertMs = Date.now();
    const topmostTimer = setInterval(() => {
      const nowMs = Date.now();
      const due = shouldReassertTopmost(
        {
          nowMs,
          lastAssertMs: lastTopmostAssertMs,
          destroyed: win.isDestroyed(),
          visible: win.isVisible(),
          paused: pointerFallbackPaused,
        },
        TOPMOST_WATCHDOG_ENABLED,
      );
      if (!due) return;
      lastTopmostAssertMs = nowMs;
      win.setAlwaysOnTop(true, topmostLevel(process.platform));
    }, TOPMOST_WATCHDOG_TICK_MS);
    return () => clearInterval(topmostTimer);
  }

  /** Fixed parameters when building a window (transparent always-on-top small window agreed with renderer). */
  function windowOptions(size, area) {
    return {
      ...size,
      x: area.x, // Initial upper left corner; renderer first frame is corrected according to the configured corner/position
      y: area.y,
      show: false,
      useContentSize: true,
      // macOS will clamp the displayed window y to the lower edge of the menu bar by default; the transparent margin of the local canvas must be allowed to extend out of the screen
      enableLargerThanScreen: true,
      transparent: true,
      frame: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      // If the taskbar button still pops up (rebuild after waking up), at least display the pet icon instead of the Electron default atom map
      icon: path.join(helperDir, '..', '..', 'assets', 'logo.png'),
      resizable: false,
      hasShadow: false,
      // Focusable: The dialog input box/menu requires focus to type; use showInactive() to display without interrupting other applications
      focusable: true,
      webPreferences: {
        preload: path.join(helperDir, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        paintWhenInitiallyHidden: false,
        spellcheck: false,
      },
    };
  }

  /** One pet per window; return to the window, where the pump and cleaning are installed. */
  function createPetWindow(pet, geo, scale) {
    const win = new BrowserWindow(windowOptions(petWindowSize(pet.size * scale), geo.hull));
    win.setAlwaysOnTop(true, topmostLevel(process.platform));
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    // The occluded window pauses rendering by default and appears to "disappear"; turn off background throttling to allow it to continue rendering.
    win.webContents.setBackgroundThrottling(false);
    // Shield Electron default right-click menu: the right-click menu is uniformly self-drawn by the renderer, and there is no double menu.
    win.webContents.on('context-menu', (event) => event.preventDefault());
    // Page-level scaling has the same origin as renderer CONFIG.scale; window zoomFactor of show:false does not take effect and must be set after loading.
    win.webContents.on('did-finish-load', () => win.webContents.setZoomFactor(scale));
    setWindowIgnore(win, true);
    win.on('show', () => keepOffTaskbar(win));
    win.once('ready-to-show', () => {
      keepOffTaskbar(win);
      win.showInactive();
    });
    // fallback display: paintWhenInitiallyHidden:false may not generate the first frame, ready-to-show will never trigger
    win.webContents.once('did-finish-load', () => {
      setTimeout(() => {
        if (!win.isDestroyed() && !win.isVisible()) win.showInactive();
      }, 400);
    });
    const stopPointerFallback = startPointerFallback(win);
    const stopTopmostWatchdog = startTopmostWatchdog(win);
    win.on('closed', () => {
      stopPointerFallback();
      stopTopmostWatchdog();
      windows.delete(pet.id);
      petStates.delete(pet.id);
      broadcastPetStates();
      lastRequestedBounds.delete(win.id);
      winMargins.delete(win.id);
      windowIgnore.delete(win.id);
      inputBusy.delete(win.id);
      inputRegions.delete(win.id);
      offBodyMs.delete(win.id);
    });
    win.loadFile(path.join(helperDir, 'index.html'), { query: windowQuery(pet, geo, scale) }).catch((error) => {
      console.error(`[dsh-pet-desktop-helper] page load failed (${pet.id}):`, error);
      win.destroy();
    });
    return win;
  }

  /** All parameters required for the first frame of the renderer: geometry is injected screen by screen, and changes during runtime are pushed through pet:displays. */
  function windowQuery(pet, geo, scale) {
    return {
      configUrl: process.env.DSH_PET_CONFIG_URL || 'http://127.0.0.1:3080/dsh-pet-7340/config',
      bridge: isBridge ? '1' : '0',
      openTarget,
      scale: String(scale),
      petIndex: String(pet.index),
      workAreaW: String(geo.hull.width),
      workAreaH: String(geo.hull.height),
      workAreaX: String(geo.hull.x),
      workAreaY: String(geo.hull.y),
      areas: JSON.stringify(geo.areas),
      workAreas: JSON.stringify(geo.workAreas),
      topInsetRatio: String(geo.topInsetRatio),
      panels: JSON.stringify(geo.panels),
      primaryIndex: String(geo.primaryIndex),
      // The window manager of X11 clamps the ordinary window in the work area, and the window cannot protrude from the
      // screen; Windows / macOS does not have this restriction. The renderer decides based on this whether to convert
      // the clipped amount into the offset of the body within the window (see fitWindow).
      isWindowClampedToWorkArea: process.platform === 'linux' ? '1' : '0',
    };
  }

  /** Press DSH_PET_PETS to build all windows. */
  function createPetWindows() {
    const geo = deskGeometry();
    const scale = dpi.petScale();
    for (const pet of petsFromEnv()) windows.set(pet.id, createPetWindow(pet, geo, scale));
    startTaskbarWatchdog();
  }

  /**
   * Close all current pet windows.
   *
   * Only used for rebuilding in application mode: there is no "restart helper process" in the same process. To change
   * the display position, you can only close the window and rebuild it; if you don't close it first, the old window
   * will remain on the desktop (only the reference is overwritten in Map). Dual-process mode achieves the same goal by
   * restarting the process without adjusting it.
   */
  function closeAllPetWindows() {
    for (const win of windows.values()) {
      try {
        win.destroy();
      } catch (e) {
        console.error('[dsh-pet-desktop-helper] window destroy failed:', String(e && e.message ? e.message : e));
      }
    }
    windows.clear();
    petStates.clear();
    if (petStateTimer !== null) {
      clearTimeout(petStateTimer);
      petStateTimer = null;
    }
  }

  return {
    state: { windows, lastRequestedBounds, winMargins, windowIgnore, inputBusy, inputRegions, offBodyMs, petStates },
    create: createPetWindows,
    closeAll: closeAllPetWindows,
    geometry: deskGeometry,
    setWindowIgnore,
    updatePetState,
    broadcastPetStates,
    keepOffTaskbar,
    stopTaskbarWatchdog,
    setPointerFallbackPaused: (paused) => {
      pointerFallbackPaused = paused;
    },
  };
}

module.exports = { createWindows };
