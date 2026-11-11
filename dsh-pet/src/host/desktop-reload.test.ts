/**
 * Desktop "overload configuration" contract test: right-click menu → POST /dsh-pet-7340/reload → host syncDesktop().
 *
 * Background: The configuration of the desktop pet is only pulled once when Helper starts (boot of renderer.js → GET /
 * config). After manually changing the configuration, the desktop will not keep up; the menu item "Reload
 * Configuration" explicitly exposes this path (just refresh the page on the browser side, so it is exclusive to the
 * desktop).
 *
 * Reloading must reuse syncDesktop() (serial queue + wait for the old process to actually exit), and you must not
 * implement a set of stop/start by yourself: ① Each desktop pet has a window, which is created by DSH_PET_PETS when
 * the host starts - re-pushing in place cannot change the number of pets / display / size; ② Global polling such as
 * balance / trigger count / working status is by events.js's loopsStarted one-time startup, rebuilding sprite in place
 * will miss starting a new cycle or leave the old timer behind.
 *
 * This file verifies the cross-side contract (the two halves are built separately and cannot import each other, and
 * can only read the source code assertion): ① The host has POST /reload route, and it calls syncDesktop() without
 * writing any configuration file; ② The desktop menu item is consistent with the host route name (extract the route
 * name from the desktop source code and check back the host : If the name is changed and one side is omitted, it will
 * fail); ③ This item must not be injected on the browser side.
 *
 * Use Node to build test runner (node:test) without introducing any npm dependencies.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Source code of files in the package (for guarding; relative to src/host / parsing) */
const readSource = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

/** route source code: scan the entire directory instead of hard-coding the file name - domain splitting and relocation should not let the guard false positive */
const routeSource = readdirSync(fileURLToPath(new URL('./routes/', import.meta.url)))
  .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
  .map((name) => readSource('./routes/' + name))
  .join('\n');
const host = readSource('./index.ts') + '\n' + routeSource;
/** The source code of the renderer pet body: has been split into sprite.js and sprite -*.js according to responsibilities. Guards must read the entire copy. */
const sprite = [
  readSource('../../runtime/electron-helper/sprite.js'),
  ...readdirSync(fileURLToPath(new URL('../../runtime/electron-helper/sprite/', import.meta.url))).map((name) =>
    readSource('../../runtime/electron-helper/sprite/' + name),
  ),
].join('\n');
const clientPet = readSource('../client/pet.ts');
const menu = readSource('../shared/menu.ts') + readSource('../shared/menu/types.ts');

describe('Desktop "Reload Configuration" - Menu → Host Restart Helper', () => {
  test('host: POST /reload reuse syncDesktop(), and only restarts without writing the configuration file', () => {
    const block = /if \(rest === 'reload'\) \{([\s\S]*?)\n {2}\}/.exec(routeSource);
    assert.ok(block, 'host must have / reload route');
    const body = block[1];
    assert.ok(
      /method !== 'POST'/.test(body),
      'reload only accepts POST (overloading is an action, not a cacheable resource)',
    );
    assert.ok(
      /void requestRestart\(\)/.test(body),
      'reload must reuse requestRestart (): the same restart path as saved',
    );
    assert.ok(
      !/writeFile|saveUserConfig|syncUserConfigFromDefault/.test(body),
      'reload only restarts Helper and never touches the configuration file (writing to the disk is the responsibility of PUT / config)',
    );
  });

  test('Desktop: The menu item exists, the action has branches, and the requested route name is consistent with the host.', () => {
    assert.ok(
      /label: '重载配置', action: 'reload'/.test(sprite),
      'The desktop right-click menu must have the "Reload Configuration" item',
    );
    assert.ok(
      /leaf\.action === 'reload'/.test(sprite),
      'onMenuAction must have the reload branch (otherwise there will be no response when clicking)',
    );
    const m = /fetch\(BASE \+ '\/([a-z-]+)', \{ method: 'POST' \}\)/.exec(sprite);
    assert.ok(
      m,
      "reloadDesktop () must be POST to BASE + '/<route name>' (bridge already supports POST, no need to add IPC)",
    );
    const route = m[1];
    assert.ok(
      new RegExp(`rest === '${route}'`).test(host),
      `The route / ${route} requested by the desktop does not exist in the host (only one side was changed when the name was changed)`,
    );
  });

  test('This item is not injected on the browser side: just refresh the web page, reloading is exclusive to the desktop', () => {
    assert.ok(
      !/action: 'reload'/.test(clientPet),
      'There must be no reload menu item on the browser side (it will restart the entire desktop Helper)',
    );
  });

  test('requestRestart is the only restart entry point: all four write interfaces and "overload configuration" use it', () => {
    // According to the module assertion "there are calls in this route", instead of counting the call points of the
    // whole warehouse: new write interfaces in the future should not make the use case red, and if an existing
    // interface is lost and restarted, it must be red. The call site might be written `void requestRestart()` or
    // `void deps.requestRestart()` .
    const call = /void (?:deps\.)?requestRestart\(\)/;
    for (const rel of [
      './routes/config/save.ts',
      './routes/config/display.ts',
      './routes/config/entry.ts',
      './routes/desktop.ts',
    ]) {
      assert.ok(call.test(readSource(rel)), rel + ' 必须经 requestRestart() 重启 Helper（自己停/起会与串行队列打架）');
    }
  });

  test('shared menu contract release reload (desktop shell injects this action, the type must contain it)', () => {
    assert.ok(/'reload'/.test(menu), "MenuLeaf.action of shared/menu.ts must contain ' reload '");
  });
});
