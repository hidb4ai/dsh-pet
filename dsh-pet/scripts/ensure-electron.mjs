#!/usr/bin/env node
/**
 * Download and extract Electron to $DSH_HOME/electron (default ~/. dsh/electron) for use by desktop Helper.
 *
 * Download to @electron / get (URL assemble, mirror, SHA256 verification, cache reuse), unzip and hand to
 * @electron - internal/extract-zip (pure Node + native, cross-platform processing symlink and permissions, does not
 * rely on system unzip/tar).
 * No version management, no cleaning of old versions, no pulling up Helper: the executable file already exists, just
 * reuse it as is and return it directly. The version and image can be overridden by environment variables, and the
 * persist to disk home directory is determined by DSH_HOME. See README for details. Must always: Confirm that the
 * executable file really exists after decompression, otherwise it will be regarded as a failure to exit.
 * @module dsh-pet/scripts/ensure-electron
 */

import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { downloadArtifact } from '@electron/get';
import extract from '@electron-internal/extract-zip';

const HOME = process.env.DSH_HOME || join(process.env.USERPROFILE || process.env.HOME || '', '.dsh');
const VERSION = process.env.DSH_PET_ELECTRON_VERSION || '43.3.0';
const MIRROR = process.env.DSH_PET_ELECTRON_MIRROR || 'https://npmmirror.com/mirrors/electron/';
const TARGET_DIR = resolve(HOME, 'electron');

const PLAT = process.platform;
const ELECTRON_REL =
  PLAT === 'win32'
    ? 'electron.exe'
    : PLAT === 'darwin'
      ? join('Electron.app', 'Contents', 'MacOS', 'Electron')
      : 'electron';
const EXE = join(TARGET_DIR, ELECTRON_REL);

/** Make sure Electron is in place: reuse if it already exists, otherwise download, decompress and verify the executable file. */
async function main() {
  if (existsSync(EXE)) {
    console.log(EXE);
    return;
  }

  console.log(`[ensure-electron] Electron not found, downloading v${VERSION} (${PLAT}-${process.arch}) ...`);
  mkdirSync(TARGET_DIR, { recursive: true });

  const zipPath = await downloadArtifact({
    version: `v${VERSION}`,
    artifactName: 'electron',
    // platform/arch is not transmitted: @electron / get is automatically inferred using the host platform and architecture.
    mirrorOptions: { mirror: MIRROR.replace(/\/$/, '') + '/' },
    downloadOptions: { quiet: true },
  });
  await extract(zipPath, { dir: TARGET_DIR });
  if (!existsSync(EXE)) {
    throw new Error(`Electron zip extracted, but ${ELECTRON_REL} not found`);
  }
  console.log(EXE);
}

main().catch((error) => {
  console.error(`[ensure-electron] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
