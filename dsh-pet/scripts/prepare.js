#!/usr/bin/env node
/**
 * Fine-tuning before release: run the complete build (tsdown → lib, shared layer → shared-core.js, tsc → type
 * declaration), and then converge package.json and files into a release list. Idempotent: Run it once and it will
 * freeze, and the results will remain unchanged if you run it again, no need to back up or restore.
 *
 * Only a single webm format (VP9-alpha) is released. The browser and desktop Helper are shared. The source code is
 * hard-coded. webm will not be injected during the release period; Safari/HEVC is compatible with the pipeline support
 * retained by the warehouse and needs to be enabled after fork. It does not participate in this plugin release chain.
 * Depends on the three scripts bundle / build:desktop-core / types in package.json and the local node_modules.
 * @module dsh-pet/scripts/prepare
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PKG = join(ROOT, 'package.json');

// Use cmd / c to run the entire npm command: npm under Windows is npm.cmd, spawnSync cannot be executed directly. cmd
// (the command line is fixed, no user input, no injection risk).
console.log('[prepare] building (tsdown)...');
const npmRun = process.platform === 'win32' ? 'cmd /c npm run bundle' : 'npm run bundle';
const build = spawnSync(npmRun, { cwd: ROOT, stdio: 'inherit', shell: true });
if (build.status !== 0) {
  console.error(`[prepare] Build failed (exit ${build.status})`);
  process.exit(1);
}

// Desktop shared core and browser bundle are taken from the same src/shared and produce window.PetShared (see build-desktop-core.mjs for details).
console.log('[prepare] building desktop shared-core...');
const coreRun = process.platform === 'win32' ? 'cmd /c npm run build:desktop-core' : 'npm run build:desktop-core';
const buildCore = spawnSync(coreRun, { cwd: ROOT, stdio: 'inherit', shell: true });
if (buildCore.status !== 0) {
  console.error(`[prepare] Desktop shared-core build failed (exit ${buildCore.status})`);
  process.exit(1);
}

// The type declaration is build output and does not include git. This step is required to complete it after cloning; if it is missing, the types path declared by exports is completely empty.
console.log('[prepare] generating types (npm run types)...');
const typesRun = process.platform === 'win32' ? 'cmd /c npm run types' : 'npm run types';
const buildTypes = spawnSync(typesRun, { cwd: ROOT, stdio: 'inherit', shell: true });
if (buildTypes.status !== 0) {
  console.error(`[prepare] Declaration generation failed (exit ${buildTypes.status})`);
  process.exit(1);
}

// files converges to release list: This is the only write operation of this script, idempotent, and does not back up old values.
const pkg = JSON.parse(readFileSync(PKG, 'utf8'));
const keep = [
  'lib',
  'src',
  'assets/webm',
  'runtime/electron-helper',
  'assets/fonts',
  'assets/pic',
  // Meme: The host side only reads the picture from assets/memes in the package and pairs it with the
  // configured memes key. If it is omitted, the picture matching function will be invalid. This array covers files of
  // package.json every time it is released, so it must be added here. Adding only one row to package.json is invalid.
  'assets/memes',
  // Click sound effect: Host side's / sound route read-only package, if missing, click to mute; same as memes, must be added to this array.
  'assets/sound',
  'assets/config.jsonc',
  // Plugin icon: package.json The top level icon points to this picture; when the picture is missing, the iconOf of the reader dsh-app-boot will throw an error and return to the default illustration.
  'assets/logo.png',
  // Character reference picture: / character in the package fallback read-only `<asset-root>-character.<ext>` . If it is
  // missing, the third party will not be able to get the official reference picture. When adding a built-in character,
  // add a line here (the asset root in the file name follows the character).
  'assets/main-character.png',
  'scripts/ensure-electron.mjs',
  'cordis.patch.yml',
  'README.zh.md',
  'ASSET-LICENSE.md',
];
writeFileSync(PKG, JSON.stringify({ ...pkg, files: keep }, null, 2) + '\n', 'utf8');
console.log(`[prepare] ✓ package.json files=[${keep.join(', ')}]`);
console.log('[prepare] ready to pack; release workflow selects the npm dist-tag from package.json version');
