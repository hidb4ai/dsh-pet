#!/usr/bin/env node
/**
 * Pre-release health check, triggered by prepack of package.json, any failure will block release with a non-zero exit
 * code.
 *
 * Check the required files, standby animation assets, whether the original master is mistakenly included in the
 * package, the official bundle form of client.js, the dsh.bundle and dsh.client declarations of package.json, whether
 * the meme image is aligned with the configuration key, the upper limit of the package size, and whether the
 * build output has introduced undeclared @oxc - project/runtime helper. read-only check, no building, no packaging, no
 * modification of any files, relying on the already built lib and assets.
 * @module dsh-pet/scripts/prepack-check
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContext, runInContext } from 'node:vm';
import { load } from 'js-yaml';

// Package root directory (one level above scripts/)
const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
// Helper function for both failed and passed outputs.
const fail = (msg) => {
  console.error(`[prepack-check] FAIL: ${msg}`);
  process.exitCode = 1;
};
const ok = (msg) => console.log(`[prepack-check] ok: ${msg}`);
/** JSONC → JSON: character string-aware stripping of line comments and block comments (there are end-of-line comments in config.jsonc). */
const stripJsonc = (s) => {
  let out = '';
  let inStr = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      out += c;
      if (c === '\\') out += s[++i] ?? '';
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') {
      inStr = true;
      out += c;
      continue;
    }
    if (c === '/' && s[i + 1] === '/') {
      while (i < s.length && s[i] !== '\n') i++;
      out += '\n';
      continue;
    }
    if (c === '/' && s[i + 1] === '*') {
      i += 2;
      while (i < s.length && !(s[i] === '*' && s[i + 1] === '/')) i++;
      i++;
      continue;
    }
    out += c;
  }
  return out;
};

// If any one of them is missing, an error will be reported during runtime if it is installed, so please name them one by one before publishing.
const required = [
  'lib/index.js', // host side
  'lib/client.js', // Browser side
  'lib/standalone.js', // npm command entry point
  'lib/chat-panel.js', // Standalone mode dialogue interface
  'README.zh.md', // Chinese instructions for use
  'ASSET-LICENSE.md', // Authorization and signature instructions released with the asset
  'lib/types/index.d.ts', // host type declaration
  'lib/types/client/index.d.ts', // Client type declaration
  'cordis.patch.yml', // bundle patch (mount statement)
  'runtime/electron-helper/main.js', // Desktop mode Electron main process
  'runtime/electron-helper/main/smoke.js', // Smoke self-test in desktop mode (main.js require, crashes if not started)
  'runtime/electron-helper/main/dpi.js', // Desktop mode DPI and pointer (main.js require, if missing, it will crash at startup)
  'runtime/electron-helper/main/bridge.js', // Desktop mode and host channel (same as above)
  'runtime/electron-helper/main/tray.js', // Desktop mode system tray (same as above)
  'runtime/electron-helper/main/windows.js', // Desktop mode window with two real-time pumps (same as above)
  'runtime/electron-helper/main/ipc.js', // Desktop mode ipc processor (same as above)
  'runtime/electron-helper/main/displays.js', // Desktop mode monitor hot update (same as above)
  'runtime/electron-helper/main/user-data.js', // Desktop mode userData rollback decision (main.js require, if missing, it will crash at startup)
  'runtime/electron-helper/pointer-target.js', // Click-through fallback judgment in desktop mode (main.js require, if it is missing, it will crash at startup)
  'runtime/electron-helper/host-liveness.js', // Desktop mode host survival determination (main.js require, if it is missing, it will crash at startup)
  'runtime/electron-helper/topmost-watchdog.js', // Desktop mode always-on-top watchdog judgment (main.js require, if it is missing, it will crash at startup)
  'runtime/electron-helper/taskbar-watchdog.js', // Desktop mode taskbar watchdog judgment (main.js require, if it is missing, it will crash at startup)
  'runtime/electron-helper/dpi-linearization.js', // Desktop mode DPI linearization judgment and conversion (main.js require, if it is missing, it will crash at startup)
  'runtime/electron-helper/tray-platform.js', // Desktop mode system tray platform difference determination (main.js require, if missing, it will crash at startup)
  'runtime/electron-helper/desktop-geometry.js', // Activity border separated from menu workspace
  'runtime/electron-helper/preload.js', // Desktop Mode preload Bridge
  'runtime/electron-helper/renderer.js', // Desktop mode renderer (pet body)
  'runtime/electron-helper/sprite/bubble.js', // Desktop mode bubble and prompt rendering (prototype extension of sprite.js, must be loaded later)
  'runtime/electron-helper/sprite/menu.js', // Desktop mode right-click menu (prototype extension of sprite.js, must be loaded later)
  'runtime/electron-helper/sprite/playback.js', // Desktop mode playback state machine (same as above)
  'runtime/electron-helper/sprite/motion.js', // Desktop mode motion driver (same as above)
  'runtime/electron-helper/sprite/input.js', // Desktop mode pointers and hits (same as above)
  'runtime/electron-helper/sprite/init.js', // Initialization during desktop mode build period (same as above)
  'runtime/electron-helper/sprite/window-fit.js', // Desktop mode window placement and clamping compensation (prototype extension of sprite.js, must be loaded later)
  'runtime/electron-helper/shared-core.js', // Desktop mode sharing pure logic (src/shared build output, window.PetShared)
  'runtime/electron-helper/index.html', // Desktop mode page shell
];
for (const f of required) {
  existsSync(join(ROOT, f)) ? ok(`exists ${f}`) : fail(`missing ${f}`);
}

// The standby animation is the starting point of the playback chain, and it cannot stand up without the pet; the browser and desktop Helper share this webm.
const idleWebm = join(ROOT, 'assets', 'webm', '待机呼吸休闲.webm');
existsSync(idleWebm) ? ok('idle webm present') : fail('missing 待机呼吸休闲.webm thumb');

// The original master (1200×1200) volume exceeds the limit, GitHub Releases should be placed, and npm package should
// not be included. assets / If there is . webm under the root, it is the original master, and the playback asset is in
// the assets/webm | mov subdirectory.
const originals = [];
const assetsRoot = join(ROOT, 'assets');
for (const name of readdirSync(assetsRoot)) {
  if (name.endsWith('.webm')) originals.push(name);
}
if (originals.length > 0)
  fail(`original masters must not ship in npm package: ${originals.join(', ')} (move them to GitHub Releases)`);
else ok('no original masters in assets/');

// The host loader only recognizes the official bundle form; the form is wrong and the plugin cannot be registered on the browser side at all.
const client = readFileSync(join(ROOT, 'lib', 'client.js'), 'utf8');
client.includes('__ModuleLoader__.load')
  ? ok('client bundle shell OK')
  : fail('client.js missing __ModuleLoader__.load');
const exportsPlugin =
  /exports\.(apply|inject|name)/.test(client) || /module\.exports\s*=\s*\{[^}]*apply[^}]*inject[^}]*name/.test(client);
exportsPlugin ? ok('client exports apply/inject/name') : fail('client.js missing apply/inject/name exports');

// Neither of the two declarations can be installed into the host: the bundle declaration determines the mounting declaration, and the client declaration determines the browser side injection.
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const patch = load(readFileSync(join(ROOT, 'cordis.patch.yml'), 'utf8'));
const entry = patch?.[0]?.insert?.[0];
entry?.id === pkg.name && entry?.name === pkg.name
  ? ok('bundle patch resolves the published package')
  : fail('bundle patch id/name must match package.json name');
try {
  const registrations = [];
  const context = createContext({
    navigator: { userAgent: 'package-check' },
    window: { __ModuleLoader__: { load: (registration) => registrations.push(registration) } },
  });
  // The host will load the same bundle repeatedly; the release package name must be registered in both executions, and the old module name cannot be left behind.
  runInContext(client, context, { timeout: 5000 });
  runInContext(client, context, { timeout: 5000 });
  registrations.length === 2 &&
  registrations.every(({ id, factory }) => id === pkg.name && typeof factory === 'function')
    ? ok('client registers the published package on initial load and reload')
    : fail('client module registration must match package.json name');
} catch (error) {
  fail(`client bundle could not register: ${error.message}`);
}
if (pkg.dsh?.bundle?.patch) ok('dsh.bundle.patch declared');
else fail('package.json missing dsh.bundle.patch');
if (pkg.dsh?.client?.platform === 'web') ok('dsh.client.web declared');
else fail('package.json missing dsh.client platform web');

// The picture matching function is read-only in the package assets/memes. If it is not sent, the whole package will be
// invalid. scripts/prepare.js uses a hard-coded whitelist to cover files of package.json every time it is released.
// Just adding one line to package.json is invalid, so an explicit assertion is made here to prevent silent leakage
// again.
const memesDir = join(ROOT, 'assets', 'memes');
if (Array.isArray(pkg.files) && pkg.files.includes('assets/memes')) ok('files includes assets/memes');
else fail('package.json files must include assets/memes (meme images would not ship)');
const memePngs = existsSync(memesDir) ? readdirSync(memesDir).filter((n) => n.endsWith('.png')) : [];
if (memePngs.length > 0) ok(`meme images present (${memePngs.length} png)`);
else fail('no png in assets/memes (whisper/chat images would all be unavailable)');
// memes key ↔ Image file alignment: Missing image entries will be silently eliminated by host (this is designed to not
// block publishing), but the numbers do not match and it is worth taking a look before publishing, so it only prompts
try {
  const conf = JSON.parse(stripJsonc(readFileSync(join(ROOT, 'assets', 'config.jsonc'), 'utf8')));
  const keys = Object.keys(conf.memes ?? {});
  const onDisk = new Set(memePngs.map((n) => n.slice(0, -'.png'.length)));
  const missing = keys.filter((k) => !onDisk.has(k));
  const extra = [...onDisk].filter((k) => !keys.includes(k));
  if (!missing.length && !extra.length) ok(`memes mapping aligned (${keys.length} keys = ${memePngs.length} png)`);
  else
    console.log(
      `[prepack-check] note: meme configuration and images differ: ${missing.length} missing images${missing.length ? ` (${missing.join(', ')})` : ''}; ${extra.length} unconfigured images${extra.length ? ` (${extra.join(', ')})` : ''}`,
    );
} catch (e) {
  console.log(`[prepack-check] note: skipping meme alignment check (config.jsonc parse failed: ${e.message})`);
}

// Character reference picture: / character's package fallback read-only this picture, if it is not released, third
// parties will not be able to get any official reference picture. The same type of problem as memes - the whitelist of
// prepare.js is the real source. The explicit assertion here prevents silent leakage again.
const characterFile = 'assets/main-character.png';
if (Array.isArray(pkg.files) && pkg.files.includes(characterFile)) ok(`files includes ${characterFile}`);
else fail(`package.json files must include ${characterFile} (character reference would not ship)`);

// Estimate the total size of the incoming package: skipping node_modules, . git, scripts, master directory and
// preview, excluding sourcemap, npm, pack and tarball left behind.
let total = 0;
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip the directory that will not be included in the npm package. dist-app is a local product of
      // electron-builder (. gitignore has been ignored and not included in the package) and does not participate in
      // volume estimation.
      if (
        !['node_modules', '.git', 'scripts', 'step01', 'step02', 'step03', 'preview', 'dist-app'].includes(entry.name)
      ) {
        walk(p);
      }
    } else if (!entry.name.endsWith('.map')) {
      // Packaged product tarball (npm pack legacy) is not included in the self-checking conventions
      if (!entry.name.endsWith('.tgz')) total += statSync(p).size; // sourcemap does not count
    }
  }
};
walk(ROOT);
const mb = (total / 1e6).toFixed(1);
if (total > 200e6) fail(`package too large: ${mb}MB (limit 200MB)`);
else ok(`package size ${mb}MB`);

// rolldown will produce downgrade syntax for "class field with initializer" under target es2020, and
// `import _defineProperty from "@oxc-project/runtime/helpers/defineProperty"` will appear in the packaging result;
// this package is neither in dependencies nor released with the package. When the host loads the plugin tree, it will
// produce ERR_MODULE_NOT_FOUND, and the entire profile cannot be loaded. The convention is that class fields should
// always be declare plus constructor assignment to avoid downgrading to external helper (see
// src/host/helper-process.ts).
const OXC_RUNTIME = '@oxc-project/runtime';
const oxcBundles = ['lib/index.js', 'lib/client.js'].filter((f) => {
  const p = join(ROOT, f);
  return existsSync(p) && readFileSync(p, 'utf8').includes(OXC_RUNTIME);
});
if (oxcBundles.length > 0)
  fail(
    `bundle imports undeclared helper ${OXC_RUNTIME} (${oxcBundles.join(', ')}) — ` +
      'Use declare fields and assign them in the constructor (see src/host/helper-process.ts)',
  );
else ok(`no undeclared ${OXC_RUNTIME} import in bundles`);

if (process.exitCode) console.error('\n[prepack-check] fix the failures above before publishing.');
else console.log('\n[prepack-check] all checks passed — ready to pack/publish.');
