#!/usr/bin/env node
/**
 * Local development or manual startup of desktop Helper without host pull up.
 *
 * The parameter is a resolved configuration address, which by default points to the local port 3080 /
 * dsh-pet-7340/config; the remaining endpoints are deduced from configUrl by the renderer, and this script is only
 * responsible for transparent transmission. Do not download Electron: If the executable file cannot be found, you will
 * be prompted to run npm run ensure:electron first. The environment variables are the same as when the host is pulled
 * up: configuration address, scaling factor, and Electron path. Must always: delete ELECTRON_RUN_AS_NODE and bring
 * DSH_PET_HOST_PID, let Helper cleanup itself after this process exits.
 * @module dsh-pet/scripts/start-desktop
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const helperMain = resolve(here, '..', 'runtime', 'electron-helper', 'main.js');
const defaultConfigUrl =
  process.env.DSH_PET_CONFIG_URL || process.argv[2] || 'http://127.0.0.1:3080/dsh-pet-7340/config';

// The path of the Electron executable file relative to the decompression directory (by platform).
const PLAT = process.platform;
const electronRel =
  PLAT === 'win32'
    ? 'electron.exe'
    : PLAT === 'darwin'
      ? join('Electron.app', 'Contents', 'MacOS', 'Electron')
      : 'electron';

// Parse the Electron executable file; it will not be downloaded automatically. If it is missing, you will be prompted to run ensure:electron first.
const candidates = [
  process.env.DSH_PET_ELECTRON_PATH,
  process.env.ELECTRON_PATH,
  join(
    process.env.DSH_HOME || join(process.env.USERPROFILE || process.env.HOME || '', '.dsh'),
    'electron',
    electronRel,
  ),
];
const electron = candidates.find((value) => value && existsSync(value));
if (!electron) {
  console.error(
    '[start-desktop] Electron not found. Run `npm run ensure:electron` first or set DSH_PET_ELECTRON_PATH.',
  );
  process.exit(1);
}

const env = {
  ...process.env,
  DSH_PET_CONFIG_URL: defaultConfigUrl,
  DSH_PET_SCALE: process.env.DSH_PET_SCALE || '1',
  // The development flow must also be followed: after this script exits (including being forcibly killed), Helper must
  // cleanup itself, leaving no background window unattended. Helper side host-liveness.js detects this process pid
  // every 2 s, and ESRCH will exit on its own.
  DSH_PET_HOST_PID: String(process.pid),
};
// Delete variables that will hijack the Electron startup mode: if ELECTRON_RUN_AS_NODE is in the terminal/host,
// Electron will start in pure Node mode, main.js on top of require (' electron ') directly MODULE_NOT_FOUND. The key
// must be deleted and an empty string cannot be set (actually an empty string will make Electron directly abort).
delete env.ELECTRON_RUN_AS_NODE;

console.log(`[start-desktop] electron:   ${electron}`);
console.log(`[start-desktop] config url: ${env.DSH_PET_CONFIG_URL}`);

const child = spawn(electron, [helperMain], { env, stdio: 'inherit', windowsHide: false });
child.on('exit', (code, signal) => {
  console.log(`[start-desktop] helper exited (code=${String(code)}, signal=${String(signal)})`);
});
