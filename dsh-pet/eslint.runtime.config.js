/**
 * Validation check configuration of desktop Helper: only check no-undef.
 *
 * This batch is a classic script (non-ESM, non-TS), without tsc and no type to rely on; they rely on the loading order
 * of index.html to share top-level globals (constants.js provides configuration and constants, sprite.js provides
 * PetSprite, and events.js provides loops). Therefore, the real ** sharing in the ** contract is explicitly declared
 * globally, and the rest will report an error - the three "pets are not visible" incidents are all after splitting. A
 * certain name no longer has any definition, and only no-undef can be discovered before startup.
 *
 * When adding a new shared global, add it to globals below; do not use fallbacks such as `/* global *\/` , which is
 * equivalent to turning off validation check.
 * @module dsh-pet/eslint.runtime.config
 */
import { defineConfig } from 'eslint/config';

/** host and Node globally (main process side). */
const nodeGlobals = {
  require: 'readonly',
  process: 'readonly',
  module: 'writable',
  __dirname: 'readonly',
  __filename: 'readonly',
  Buffer: 'readonly',
  setImmediate: 'readonly',
  console: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
};

/** Browser global (renderer and preload). */
const browserGlobals = {
  window: 'readonly',
  document: 'readonly',
  navigator: 'readonly',
  location: 'readonly',
  Audio: 'readonly',
  // Voice input: shared/hear Open 16 kHz collection context in renderer (enter bundle via shared-core.js)
  AudioContext: 'readonly',
  Image: 'readonly',
  getComputedStyle: 'readonly',
  requestAnimationFrame: 'readonly',
  cancelAnimationFrame: 'readonly',
  MutationObserver: 'readonly',
  ResizeObserver: 'readonly',
  Blob: 'readonly',
  FileReader: 'readonly',
  btoa: 'readonly',
  CustomEvent: 'readonly',
  performance: 'readonly',
  fetch: 'readonly',
  Response: 'readonly',
  Request: 'readonly',
  Headers: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  AbortController: 'readonly',
  AbortSignal: 'readonly',
};

/**
 * Top-level globals shared between scripts: defined in constants.js (configuration and constants), sprite.js (classes
 * and prompts), events.js (polling loop). See each file for definition; only names are registered here, their values
 * are not repeated.
 */
const scriptGlobals = {
  // constants.js
  S: 'readonly',
  CONFIG: 'readonly',
  config: 'writable',
  toScreen: 'readonly',
  toLocal: 'readonly',
  OPEN_TARGET: 'readonly',
  VIEW: 'readonly',
  AREAS: 'readonly',
  WORK_AREAS: 'readonly',
  PANELS: 'readonly',
  PRIMARY_AREA: 'readonly',
  applyDeskGeometry: 'readonly',
  BASE: 'readonly',
  ORIGIN: 'readonly',
  STATE_URL: 'readonly',
  BALANCE_URL: 'readonly',
  FOCUS_SESSION_URL: 'readonly',
  WHISPER_URL: 'readonly',
  POSE_REPORT_URL: 'readonly',
  POSE_THROTTLE_MS: 'readonly',
  BUBBLE_DURATION_MS: 'readonly',
  BALANCE_FADE_MS: 'readonly',
  STATE_WAIT_MS: 'readonly',
  WINDOW_MARGIN_RATIO: 'readonly',
  rootEl: 'readonly',
  errorEl: 'readonly',
  sprites: 'writable',
  balance: 'writable',
  balanceTick: 'writable',
  balanceNoticeKey: 'writable',
  workTick: 'writable',
  bootTimer: 'writable',
  loopsStarted: 'writable',
  // sprite.js
  PetSprite: 'readonly',
  OPEN_SHORTCUT_HINT: 'readonly',
  isOpenShortcut: 'readonly',
  playClickSound: 'readonly',
  // events.js
  startLoops: 'readonly',
};

export default defineConfig([
  {
    files: ['runtime/electron-helper/**/*.js'],
    languageOptions: { globals: { ...nodeGlobals, ...browserGlobals, ...scriptGlobals } },
    rules: { 'no-undef': 'error' },
  },
]);
