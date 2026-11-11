/**
 * Smoke test of main process assembly: given a pet, the window must actually be built and index.html loaded.
 *
 * Why this article is needed: The module under runtime is not included in the type check. If the assembly is wrong
 * (the parameters are not destructuring, the path is written incorrectly), it will only appear as "nothing on the
 * desktop", and the guard who presses the text assertion cannot see this error. Here we use the stand-in electron to
 * run main.js for real. Do not start the real Electron and do not open the window: only the assertion window object is
 * created and the existing page is loaded.
 */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import Module from 'node:module';
import { tmpdir } from 'node:os';
import { test } from 'node:test';

const require = createRequire(import.meta.url);

/** Substitute electron: Any unimplemented method is treated as an empty function to avoid filling it in one by one. */
function createFakeElectron(created: Array<{ loaded?: { file: string } }>): unknown {
  const noop = (): void => {};
  const makeWindow = (): unknown => {
    const win = {
      id: created.length + 1,
      loadFile: async (file: string) => {
        record.loaded = { file };
      },
      isDestroyed: () => false,
      isVisible: () => false,
      getBounds: () => ({ x: 0, y: 0, width: 924, height: 700 }),
      getContentBounds: () => ({ x: 0, y: 0, width: 640, height: 360 }),
      webContents: new Proxy({ executeJavaScript: async () => ({}) }, { get: () => noop }),
    };
    const record = win as unknown as { loaded?: { file: string } };
    created.push(record);
    return new Proxy(win, { get: (target, prop) => (prop in target ? target[prop as keyof typeof target] : noop) });
  };
  const display = {
    id: 1,
    scaleFactor: 1,
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    workArea: { x: 0, y: 0, width: 1920, height: 1040 },
  };
  const plain = {
    app: {
      whenReady: () => Promise.resolve(),
      getPath: () => tmpdir(),
      getAppPath: () => process.cwd(),
      requestSingleInstanceLock: () => true,
      isPackaged: false,
      commandLine: { appendSwitch: noop },
      dock: { hide: noop },
    },
    BrowserWindow: Object.assign(
      function BrowserWindow() {
        return makeWindow();
      },
      { fromWebContents: () => null, getAllWindows: () => [] },
    ),
    Menu: { buildFromTemplate: () => ({}) },
    Tray: function Tray() {
      return new Proxy({}, { get: () => noop });
    },
    nativeImage: { createFromPath: () => ({ resize: () => ({}) }) },
    screen: {
      getPrimaryDisplay: () => display,
      getAllDisplays: () => [display],
      on: noop,
      getCursorScreenPoint: () => ({ x: 0, y: 0 }),
    },
  };
  const fallback = (obj: object): unknown =>
    new Proxy(obj, { get: (target, prop) => (prop in target ? target[prop as keyof typeof target] : noop) });
  const wrapped = Object.fromEntries(Object.entries(plain).map(([key, value]) => [key, fallback(value as object)]));
  return new Proxy(wrapped, {
    get: (target, prop) => (prop in target ? target[prop as keyof typeof target] : fallback({})),
  });
}

test('Given a pet: the main process will create a window and load the existing index.html', async () => {
  const created: Array<{ loaded?: { file: string } }> = [];
  const originalLoad = (Module as unknown as { _load: (...args: unknown[]) => unknown })._load;
  const originalSetInterval = globalThis.setInterval;
  const originalEnv = { ...process.env };
  // After the window is created, each window will have two resident timers: replace them with empty functions in the test, otherwise the process will not exit.
  globalThis.setInterval = (() => 0) as unknown as typeof setInterval;
  (Module as unknown as { _load: (...args: unknown[]) => unknown })._load = function patched(
    request: unknown,
    ...rest: unknown[]
  ) {
    if (request === 'electron') return createFakeElectron(created);
    return originalLoad.call(this, request, ...rest);
  };
  process.env.DSH_PET_PETS = JSON.stringify([{ id: 'main', size: 462 }]);
  process.env.DSH_PET_ELECTRON_PATH = process.execPath;
  delete process.env.DSH_PET_BRIDGE;
  delete process.env.DSH_PET_APP_MODE;

  try {
    require(fileURLToPath(new URL('../../runtime/electron-helper/main.js', import.meta.url)));
    // The callback of whenReady is a microtask chain: wait for the macrotask to finish running
    await new Promise((resolve) => setTimeout(resolve, 50));
  } finally {
    (Module as unknown as { _load: (...args: unknown[]) => unknown })._load = originalLoad;
    globalThis.setInterval = originalSetInterval;
    process.env = originalEnv;
  }

  assert.equal(created.length, 1, 'A pet must create a window (0 means there is nothing on the desktop)');
  const loaded = created[0]?.loaded;
  assert.ok(loaded, 'The window must call loadFile (otherwise the window is empty)');
  assert.match(loaded.file, /index\.html$/, 'The renderer page must be loaded');
  assert.ok(existsSync(loaded.file), 'The page file must actually exist');
});
