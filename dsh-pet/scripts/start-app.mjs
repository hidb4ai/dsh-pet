#!/usr/bin/env node
/**
 * During the development period, the "single-process desktop pet application" is launched directly without packaging.
 *
 * The only difference from the packaged product is where Electron comes from: here we use the local decompressed
 * Electron to run lib/app.js, while the packaged product stuffs the same batch of files into its own exe; the
 * environment variables are consistent with the packaged version, which facilitates comparison and troubleshooting. Do
 * not download Electron and do not build: the decompression directory and lib/app.js must be prepared in advance. If
 * Electron is missing, an error will be reported and exited directly. MUST ALWAYS clear ELECTRON_RUN_AS_NODE,
 * otherwise Electron will start in pure Node mode.
 * @module dsh-pet/scripts/start-app
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

const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh');
const electron = [process.env.DSH_PET_ELECTRON_PATH, join(dshHome, 'electron', ELECTRON_REL)].find(
  (value) => value && existsSync(value),
);
if (!electron) {
  console.error('[start-app] Electron not found. Run npm run ensure:electron or set DSH_PET_ELECTRON_PATH.');
  process.exit(1);
}

const env = { ...process.env };
// The host may have it: it will cause Electron to start in pure Node mode, and the application of entry point require (' electron ') will fail directly.
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electron, [join(root, 'lib', 'app.js')], { cwd: root, env, stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));
