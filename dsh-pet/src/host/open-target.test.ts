/**
 * The first menu item is a contract test automatically assigned according to the host state (host = DSH desktop
 * application / dsh web / standalone mode).
 *
 * Requirements: The same tool item in the three forms must have three destinations and text - desktop
 * application "Open the software" (call the main window back to the foreground), standalone mode "Open AI settings"
 * (local settings page), dsh web "Open website" (DSH site). The judgment logic has been extracted into a pure function
 * {@link resolveOpenTarget} , with direct assertion behavior; the assembly on both sides (host injection and helper
 * parsing) are constructed separately and cannot be import mutually, and the source code assertion is still used to
 * guard the wiring.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolveOpenTarget } from './plugin/desktop/spawn.ts';

/** Source code of files in the package (for guarding; relative to src/host / parsing) */
const readSource = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const host =
  readSource('./index.ts') +
  '\n' +
  readSource('./plugin/desktop-helper.ts') +
  '\n' +
  readSource('./plugin/desktop/spawn.ts');
/** main process source code: main.js is the assembly root, and the behaviors are scattered in modules under main /. The guard must read the entire copy. */
const mainSource = (dir: string): string =>
  [
    readSource(dir + 'main.js'),
    ...readdirSync(fileURLToPath(new URL(dir + 'main/', import.meta.url)))
      .filter((name) => name.endsWith('.js'))
      .map((name) => readSource(dir + 'main/' + name)),
  ].join('\n');
const main = mainSource('../../runtime/electron-helper/');
const constants = readSource('../../runtime/electron-helper/constants.js');
/** The source code of the renderer pet body: has been split into sprite.js and sprite -*.js according to responsibilities. Guards must read the entire copy. */
const sprite = [
  readSource('../../runtime/electron-helper/sprite.js'),
  ...readdirSync(fileURLToPath(new URL('../../runtime/electron-helper/sprite/', import.meta.url))).map((name) =>
    readSource('../../runtime/electron-helper/sprite/' + name),
  ),
].join('\n');
const appMain = readSource('../app/main.ts');
const standaloneContext = readSource('../standalone/context.ts');

describe('resolveOpenTarget: Form determination', () => {
  test('Electron host: No matter where the address points to, it is desktop', () => {
    assert.equal(resolveOpenTarget('http://127.0.0.1:3080/', true), 'desktop');
    assert.equal(
      resolveOpenTarget('http://127.0.0.1:31380/standalone-ai/#token=test-only', true),
      'desktop',
      'In desktop applications, the setting page address should not be misjudged as independent mode.',
    );
  });

  test('Standalone mode: The address falls on the local settings page → standalone', () => {
    assert.equal(resolveOpenTarget('http://127.0.0.1:31380/standalone-ai/#token=test-only', false), 'standalone');
  });

  test('web host: site root address → web, cannot be incidentally judged to be in standalone mode', () => {
    assert.equal(
      resolveOpenTarget('http://127.0.0.1:3080/#token=test-only', false),
      'web',
      'dsh web opens the DSH site, and the menu should display "Open website"',
    );
  });
});

describe('Assembly wiring: host injection → helper analysis → renderer text', () => {
  test('host: desktop application determination + three-state injection', () => {
    assert.ok(
      /const isDesktopHost = \(\): boolean => Boolean\(process\.versions\.electron\)/.test(host),
      'The host must use process.versions.electron to determine the state (desktop applications run as ELECTRON_RUN_AS_NODE, this field is still there; dsh web is pure Node)',
    );
    assert.ok(
      /DSH_PET_OPEN_TARGET: resolveOpenTarget\(siteUrl, isDesktopHost\(\)\)/.test(host),
      'launchHelper must be injected into tri-state (only injecting desktop/site will make web share the same level with independent mode)',
    );
  });

  test('helper main process: three-state resolution, fallback web not injected (old behavior)', () => {
    assert.ok(
      /const OPEN_TARGET_RAW = process\.env\.DSH_PET_OPEN_TARGET;\s*const OPEN_TARGET = OPEN_TARGET_RAW === 'desktop' \|\| OPEN_TARGET_RAW === 'standalone' \? OPEN_TARGET_RAW : 'web'/.test(
        main,
      ),
      "Non-desktop/standalone will always fallback ' web ' (the behavior of handwritten start-desktop without this variable shall not change)",
    );
    assert.ok(
      /openTarget: OPEN_TARGET/.test(main),
      'The shape should be transmitted to the renderer along the window query (the copywriting is decided there)',
    );
    assert.ok(
      /shell\.openExternal\('dsh:\/\/open'\)/.test(main),
      'The desktop host must go to dsh :// open to wake up the application window.',
    );
    assert.ok(
      /(?:OPEN_TARGET|openTarget) === 'desktop'\) \{[\s\S]*?openSite\(url\)/.test(main),
      'dsh:// fails and needs to fallback to open the site (when the protocol is not registered, it cannot be "no response after clicking")',
    );
    assert.ok(
      /const openSite = \(url\) => \{[\s\S]*?shell\.openExternal\(target\)/.test(main),
      'The site path (including fallback) must still be the original implementation of opening the site',
    );
    assert.ok(
      (main.match(/dsh:\/\/open/g) ?? []).length === 1,
      'dsh :// open is only allowed to appear in the desktop branch (standalone/web cannot be changed to invoke the application incidentally)',
    );
  });

  test('helper renderer: Three-state text table lookup, the action name remains unchanged', () => {
    assert.ok(
      /const OPEN_TARGET_RAW = params\.get\('openTarget'\);\s*const OPEN_TARGET = OPEN_TARGET_RAW === 'desktop' \|\| OPEN_TARGET_RAW === 'standalone' \? OPEN_TARGET_RAW : 'web'/.test(
        constants,
      ),
      "constants.js must read tri-state from query and defaults to 'web'",
    );
    assert.ok(
      /\{ desktop: '打开软件', standalone: '打开 AI 设置', web: '打开网站' \}/.test(sprite),
      'Three forms must have three types of copywriting. web must no longer display "Open AI settings"',
    );
    assert.ok(
      /label: OPEN_LABEL\[OPEN_TARGET\],\s*action: 'open-site'/.test(sprite),
      'The copywriting is determined by looking up the table, but action is still open-site (the other end only recognizes this action name; hint is just a visual reminder, allowing line breaks to be sandwiched in the middle)',
    );
  });

  test('Standalone mode: App explicitly marks standalone, CLI is determined by the address, and no additional form is injected.', () => {
    assert.ok(
      /process\.env\.DSH_PET_OPEN_TARGET = 'standalone'/.test(appMain),
      'Independent App without passing through spawn, you must mark the form as standalone yourself (otherwise fallback web, the copy will change back to "Open the website")',
    );
    assert.ok(
      !/DSH_PET_OPEN_TARGET/.test(standaloneContext),
      'Independent mode pseudo ctx non-injection form: App belongs to main.ts, CLI belongs to spawn address determination',
    );
  });
});
