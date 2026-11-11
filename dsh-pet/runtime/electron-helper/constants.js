/**
 * dsh-pet desktop Helper infrastructure: startup parameters, desktop geometry, global status and debugging hooks.
 *
 * Classic script: Loaded sequentially by index.html, before sprite.js / events.js / renderer.js, the top-level
 * declaration enters the global lexical environment. Not responsible for behavior and rendering. Depends on the
 * window.PetShared of shared-core.js and the query parameters injected by the main process.
 * @module dsh-pet/runtime/electron-helper/constants
 */
'use strict';

const S = window.PetShared;

const params = new URLSearchParams(location.search);
const CONFIG = {
  configUrl: params.get('configUrl') || 'http://127.0.0.1:3080/dsh-pet-7340/config',
  scale: Number(params.get('scale') || '1'),
  petIndex: Number(params.get('petIndex') || '0'),
  topInsetRatio: Number(params.get('topInsetRatio') || '0'),
  // Is the window clamped in the work area by the system: The window manager of X11 is like this (Windows / macOS
  // allows the window to stick out of the screen), and is injected by the main process according to the platform. When
  // it is turned on, the window cannot stick out of the screen, and the main body is offset within the window (see
  // fitWindow).
  isWindowClampedToWorkArea: params.get('isWindowClampedToWorkArea') === '1',
};

// Coordinate system convention: After the main process pairs the window setZoomFactor ( CONFIG.scale ), the DOM
// measurement, event coordinates, desktop geometry and all shared components are in the CSS pixels; the physical
// pixels exchanged with the main process are only converted in toScreen/toLocal, and multiplication and division are
// not allowed elsewhere (the only entry point for geometry import is applyDeskGeometry).
function toScreen(v) {
  return v * CONFIG.scale;
}
function toLocal(v) {
  return v / CONFIG.scale;
}
// bridge mode (DSH_PET_BRIDGE =1): The request goes through the custom scheme through the main process to the host
// pipeline, bypassing the browser access gate of the DSH desktop application (it only allows requests with tokens, and
// the bare HTTP of the plugin self-pull process will always get 403).
const BRIDGE = params.get('bridge') === '1';
// The destination of the first menu item (main process is injected in host form): desktop activates the desktop application, standalone opens the local AI settings page, and web opens the site.
const OPEN_TARGET_RAW = params.get('openTarget');
const OPEN_TARGET = OPEN_TARGET_RAW === 'desktop' || OPEN_TARGET_RAW === 'standalone' ? OPEN_TARGET_RAW : 'web';
// Viewport = the enclosing rectangle of all monitor workspaces, which is just the origin of the coordinate system and
// the scale conversion basis; the boundary determination is always the union of AREAS (in an irregular layout, the
// enclosing rectangle contains large holes that do not belong to any screen). The main process issues physical pixels,
// and VIEW is the CSS system after ÷ scale.
const VIEW_SCREEN = {
  x: Number(params.get('workAreaX') || 0),
  y: Number(params.get('workAreaY') || 0),
  w: Number(params.get('workAreaW') || (window.screen && window.screen.availWidth) || 1920),
  h: Number(params.get('workAreaH') || (window.screen && window.screen.availHeight) || 1080),
};
const VIEW = {
  x: toLocal(VIEW_SCREEN.x),
  y: toLocal(VIEW_SCREEN.y),
  w: toLocal(VIEW_SCREEN.w),
  h: toLocal(VIEW_SCREEN.h),
};
/** Per-monitor workspace, viewport relative coordinates (= screen coordinates − VIEW origin): throw/roam/menu gripper takes their union */
let AREAS = [];
/** The menu/chat box/prompts are still limited to the workspace and cannot be entered into the menu bar or Dock with pets. */
let WORK_AREAS = [];
/**
 * Per-monitor complete panel (including taskbar area, same sequence as AREAS): detect whether there is an adjacent
 * screen on the out-of-bounds side when throwing - the workspace strip dug out by the taskbar at the seam is not a
 * wall (see shared/physics.ts)
 */
let PANELS = [];
/** Main screen work area (viewport relative coordinates): use it for corner positioning and "return to initial position" - the corners of the enclosing rectangle may fall into the holes */
let PRIMARY_AREA = null;

/** Hang the desktop geometry ({ hull , areas , panels , primaryIndex }, screen coordinates) issued by the main process to VIEW / AREAS / PANELS. */
function applyDeskGeometry(geo) {
  const hull = geo && geo.hull;
  const list = geo && Array.isArray(geo.areas) ? geo.areas.filter((a) => a && a.width > 0 && a.height > 0) : [];
  if (!hull || !(hull.width > 0) || !(hull.height > 0) || list.length === 0) return false;
  // main process geometry is physical pixels: one by one ÷ scale into CSS system (the only centralize of geometry import)
  VIEW.x = toLocal(hull.x);
  VIEW.y = toLocal(hull.y);
  VIEW.w = toLocal(hull.width);
  VIEW.h = toLocal(hull.height);
  AREAS = S.translateRects(
    list.map((a) => ({ x: toLocal(a.x), y: toLocal(a.y), width: toLocal(a.width), height: toLocal(a.height) })),
    -VIEW.x,
    -VIEW.y,
  );
  const workAreas = geo && Array.isArray(geo.workAreas) && geo.workAreas.length === list.length ? geo.workAreas : list;
  WORK_AREAS = S.translateRects(
    workAreas.map((a) => ({ x: toLocal(a.x), y: toLocal(a.y), width: toLocal(a.width), height: toLocal(a.height) })),
    -VIEW.x,
    -VIEW.y,
  );
  CONFIG.topInsetRatio = Number(geo.topInsetRatio) || 0;
  // Panels are in the same order as the workspace; missing or inconsistent in length (old main process) degenerates into the workspace and maintains the original behavior
  const panelsList =
    geo && Array.isArray(geo.panels) && geo.panels.length === list.length
      ? geo.panels.filter((p) => p && p.width > 0 && p.height > 0)
      : null;
  PANELS = S.translateRects(
    (panelsList || list).map((a) => ({
      x: toLocal(a.x),
      y: toLocal(a.y),
      width: toLocal(a.width),
      height: toLocal(a.height),
    })),
    -VIEW.x,
    -VIEW.y,
  );
  const pi = Number(geo.primaryIndex);
  PRIMARY_AREA = AREAS[Number.isInteger(pi) && pi >= 0 && pi < AREAS.length ? pi : 0];
  return true;
}

// The first frame geometry is URL query (position() is used when determining the corner), and the changes during the
// runtime are pushed through pet:displays. When areas/panels is missing (manual start-desktop / old main process), it
// degrades to "the entire viewport is one screen".
applyDeskGeometry({
  hull: { x: VIEW_SCREEN.x, y: VIEW_SCREEN.y, width: VIEW_SCREEN.w, height: VIEW_SCREEN.h },
  areas: (() => {
    try {
      const parsed = JSON.parse(params.get('areas') || '[]');
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch {
      /* single rectangle fallback */
    }
    return [{ x: VIEW_SCREEN.x, y: VIEW_SCREEN.y, width: VIEW_SCREEN.w, height: VIEW_SCREEN.h }];
  })(),
  panels: (() => {
    try {
      const parsed = JSON.parse(params.get('panels') || '[]');
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch {
      /* Panel fallback (= workspace) */
    }
    return null;
  })(),
  primaryIndex: Number(params.get('primaryIndex') || 0),
  workAreas: (() => {
    try {
      return JSON.parse(params.get('workAreas') || 'null');
    } catch {
      return null;
    }
  })(),
  topInsetRatio: CONFIG.topInsetRatio,
});
const ORIGIN = new URL(CONFIG.configUrl).origin;
/** host / dsh-pet-7340 prefix: bridge uses customized scheme (main process forwarding), otherwise HTTP directly connects to host */
const BASE = BRIDGE ? 'dsh-pet-bridge://dsh-pet/dsh-pet-7340' : ORIGIN + '/dsh-pet-7340';
const STATE_URL = BASE + '/state'; // Polling unified status S: The only data source for front-end 1 s polling (balance/working status/notification/talk)
const BALANCE_URL = BASE + '/balance'; // Balance refresh action (POST, write S; the data itself is read from / state)
const FOCUS_SESSION_URL = BASE + '/focus-session'; // Jump session action (POST, write sections.focusSession; the page will be cut accordingly)
const WHISPER_URL = BASE + '/whisper';
// Live reporting (renderer → host, internal channel): The third party uses GET /pose to read the snapshot saved by the host
const POSE_REPORT_URL = BASE + '/pose/report';
// Throttling interval for live reporting (ms). sendBounds is called frame by frame during movement/throwing and must
// be merged; and must bring trailing edge (read the current value and push it once at the point), otherwise the third
// party will always read the position in the middle of the movement without any error.
const POSE_THROTTLE_MS = 400;
const BUBBLE_DURATION_MS = 10 * 1000; // Balance/whisper bubble display duration (consistent with browsers: timed disappearance, decoupled from animation)
// Balance bubble wait before content change (ms): same as . pet-bubble's opacity transition is .25 s, fade out and
// then change, otherwise the content will be replaced when semi-transparent = visible hard cut (in line with browser
// bubble.ts (same value)
const BALANCE_FADE_MS = 250;
// / state Long polling hang time (same value as the browser side): The host can hang for this long at most when the version does not change, and return immediately when the leaf changes.
const STATE_WAIT_MS = 1000;
// Expansion around the window = the ratio × pet size: reserve display space for bubbles and possible pop-up windows, the expansion area is transparent and click-through.
const WINDOW_MARGIN_RATIO = 0.5;

const rootEl = document.getElementById('root');
const errorEl = document.getElementById('pet-error');
let config = null; // { pets: resolved value instance list after flattening, physics, confineToScreen, clickSoundEnabled} (loadConfig filled)
let sprites = []; // PetSprite [] (Only one pet is installed in this window)
let balance = null; // BalanceState (shared by single pet in this window)
let balanceTick = 0;
let balanceNoticeKey = null; // The reason for unavailability that was prompted last time (reason:provider): only play again when the reason changes (determined at shared)
let workTick = 0; // Working status linkage tick: / state is incremented only when sections.workStatus counter changes
let bootTimer = null;
let loopsStarted = false;

// Debugging hook: used for smoke self-test and troubleshooting (error/configuration/bubble/menu status)
window.__dshPetDebug = {
  errors: [],
  configOk: false,
  spriteCount: 0,
  lastBubbleTitle: '',
  lastBalanceOk: null,
  menuOpen: false,
  chatOpen: false,
  bootAt: Date.now(),
};
window.addEventListener('error', (event) => {
  window.__dshPetDebug.errors.push(String(event.message || event.error));
});
