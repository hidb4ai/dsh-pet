#!/usr/bin/env node
/**
 * The packaged desktop pet application that can be run by double-clicking is a thin package of electron-builder. The
 * product only has one form: "unpackage directory". Only the unpacking directory is displayed: portable is the NSIS
 * self-extracting shell. Every time it is started, the entire application directory must be decompressed to % TEMP %,
 * which is not worth the loss in terms of size of Electron; the nsis installation package has no incremental value for
 * self-use and green distribution, so it is not provided. Do not download Electron: By default, it will only recognize
 * the decompressed directory of the local machine. If it cannot be found, it will fail explicitly to avoid local
 * development being silently pulled away for more than 100 megabytes; only when DSH_PET_ALLOW_ELECTRON_DOWNLOAD =1 is
 * set, electron-builder will be returned for self-download (for CI). The packaged binary uses the npmmirror image,
 * because the local github.com cannot be accessed.
 * @module dsh-pet/scripts/dist
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

/** The path of the Electron executable file relative to the decompression directory (by platform). */
const ELECTRON_REL =
  process.platform === 'win32'
    ? 'electron.exe'
    : process.platform === 'darwin'
      ? join('Electron.app', 'Contents', 'MacOS', 'Electron')
      : 'electron';

/**
 * When parsing the local Electron decompression directory, not a single bytes is downloaded.
 *
 * The candidates are DSH_PET_ELECTRON_DIST, the directory where DSH_PET_ELECTRON_PATH is located, and
 * $DSH_HOME/electron; when none of them exist on this machine: if downloading is enabled, undefined will be returned
 * (electronDist will not be transmitted), otherwise the process will be exited directly.
 *
 * @returns unzip directory, or undefined (leave it to electron-builder to download).
 */
function resolveElectronDist() {
  const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh');
  const candidates = [
    process.env.DSH_PET_ELECTRON_DIST,
    process.env.DSH_PET_ELECTRON_PATH ? dirname(process.env.DSH_PET_ELECTRON_PATH) : undefined,
    join(dshHome, 'electron'),
  ].filter((value) => Boolean(value));
  for (const dir of candidates) {
    if (existsSync(join(dir, ELECTRON_REL))) return dir;
  }
  if (process.env.DSH_PET_ALLOW_ELECTRON_DOWNLOAD === '1') {
    console.warn('[dist] No local Electron distribution; electron-builder will download one (CI mode).');
    return undefined;
  }
  console.error(
    '[dist] Extracted Electron distribution not found. Run `npm run ensure:electron`,' +
      'or set DSH_PET_ELECTRON_DIST to its extracted directory.',
  );
  process.exit(1);
}

const target = process.argv[2] ?? 'dir';
if (target !== 'dir') {
  console.error(`[dist] Unknown target: ${target} (only unpacked output is supported; run node scripts/dist.mjs)`);
  process.exit(2);
}

const electronDist = resolveElectronDist();
/** mirror defaults to npmmirror: github.com cannot be accessed on this machine; environment variables can be used on CI to overwrite the official source */
const env = {
  ...process.env,
  ELECTRON_BUILDER_BINARIES_MIRROR:
    process.env.ELECTRON_BUILDER_BINARIES_MIRROR || 'https://npmmirror.com/mirrors/electron-builder-binaries/',
  ELECTRON_MIRROR: process.env.ELECTRON_MIRROR || 'https://npmmirror.com/mirrors/electron/',
  // The code signing identity is not automatically discovered: the machine does not have a certificate, so signature detection is skipped to avoid failure at the end of the package.
  CSC_IDENTITY_AUTO_DISCOVERY: 'false',
};
// The download of Electron is prohibited when there is a local decompression directory; the fallback path of CI must allow the download in turn.
if (electronDist) {
  env.DSH_PET_ELECTRON_DIST = electronDist;
  env.ELECTRON_SKIP_BINARY_DOWNLOAD = '1';
} else {
  delete env.DSH_PET_ELECTRON_DIST;
  delete env.ELECTRON_SKIP_BINARY_DOWNLOAD;
}

console.log(`[dist] electron dist: ${electronDist ?? '(missing; electron-builder will download it)'}`);
console.log(`[dist] target:        win:${target}`);
// Directly call the CLI file of electron-builder without passing `pnpm exec` : the installation path may contain
// single quotes, and the parameters passed through shell will be chopped; node directly spawn does not have this layer
// of escaping problems.
const cli = join(root, 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js');
const args = [cli, '--win', target];
if (electronDist) args.push(`--config.electronDist=${electronDist}`);
const child = spawn(process.execPath, args, {
  cwd: root,
  env,
  stdio: 'inherit',
});
child.on('exit', (code) => process.exit(code ?? 0));
