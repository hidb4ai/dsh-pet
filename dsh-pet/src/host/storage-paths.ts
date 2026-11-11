/**
 * Plugin storage location list (data source of the "unmount and storage" section of the settings page).
 *
 * Only path derivation is performed, and no writing logic is copied: the user data and Electron landing directory
 * directly take the path passed by the caller from the real writer, and only the system-level directory (desktop side
 * userData, Electron download cache) is mirrored according to the platform. It must always be true: path literals that
 * can be eliminated by calling do not need to be written a second time - writing more places will cause hard coding
 * that will drift; the desktop application name must be consistent with app.setName of main.js (the test directly
 * reads main.js for verification).
 * @module dsh-pet/src/host/storage-paths
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** Desktop Electron userData directory name (= app.setName input parameter of main.js). */
export const DESKTOP_APP_NAME = 'dsh-pet-electron-helper';

/** Electron download cached application name (@electron / get hard-coded env-paths (' electron '), has nothing to do with the plugin name). */
const ELECTRON_PATHS_NAME = 'electron';

/** List entry key: The client presses it to get the localized copy (' storage .< key >' in each language dictionary). */
export type StorageKey = 'userData' | 'electron' | 'desktopCache' | 'electronCache' | 'package';

/** A storage location. */
export interface StorageEntry {
  key: StorageKey;
  /** Absolute path */
  path: string;
  /** Does it exist at this moment (false = not yet generated, for example, desktop mode has never been enabled) */
  exists: boolean;
}

/** Input for manifest derivation: each benchmark directory, platform and environment (the latter two test injection). */
export interface StoragePathInput {
  /** Plugin user data root: userRoot in index.ts is actually used for disk writing. This module does not spell 'dsh-pet' by itself. */
  userDataRoot: string;
  /** Electron runtime landing directory: electronLandingDir() passing helper-process.ts (the only definition of the downloader). */
  electronDir: string;
  /** User home directory (fallback of system-level base directory) */
  home: string;
  /** The root directory of this package (= the directory where the plugin itself is located) */
  packageRoot: string;
  /** Platform, default process.platform (test injection) */
  platform?: NodeJS.Platform;
  /** Environment variable, default process.env (test injection) */
  env?: NodeJS.ProcessEnv;
}

/**
 * Desktop userData directory (equivalent derivation of Electron app.getPath (' userData ')). Align Electron
 * conventions per platform: win32 = % APPDATA %\< name >, darwin = ~/Library/Application Support/< name>,
 * linux = $XDG_CONFIG_HOME /< name >, if not set, ~/. config /< name >.
 */
function desktopUserDataDir(input: StoragePathInput): string {
  const { home, env = process.env, platform = process.platform } = input;
  if (platform === 'win32') return join(env.APPDATA || join(home, 'AppData', 'Roaming'), DESKTOP_APP_NAME);
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', DESKTOP_APP_NAME);
  return join(env.XDG_CONFIG_HOME || join(home, '.config'), DESKTOP_APP_NAME);
}

/**
 * Electron installation package download cache directory (@electron / get default cacheRoot = env-paths (' electron
 * '). cache). win32 has an additional layer of Cache under LOCALAPPDATA, macOS uses ~/ Library/Caches, and Linux uses
 * $XDG_CACHE_HOME (default ~/. cache). This directory is shared with other tools using @electron / get. If you delete
 * it, you will just need to re-download it next time.
 */
function electronCacheDir(input: StoragePathInput): string {
  const { home, env = process.env, platform = process.platform } = input;
  if (platform === 'win32') {
    return join(env.LOCALAPPDATA || join(home, 'AppData', 'Local'), ELECTRON_PATHS_NAME, 'Cache');
  }
  if (platform === 'darwin') return join(home, 'Library', 'Caches', ELECTRON_PATHS_NAME);
  return join(env.XDG_CACHE_HOME || join(home, '.cache'), ELECTRON_PATHS_NAME);
}

/**
 * All locations of the plugin persist to disk on the local machine (the order is the setting page display order: user
 * data first, then runtime and cache, and finally the plugin itself).
 *
 * The first two directly take the path of the real writer, and only the system-level directory is deduced by this
 * module according to the platform.
 * @param input - Each benchmark directory, platform, and environment (test injection).
 * @returns entry array; exists is determined instantly by the current disk status.
 */
export function storageEntries(input: StoragePathInput): StorageEntry[] {
  const items: Array<{ key: StorageKey; path: string }> = [
    { key: 'userData', path: input.userDataRoot },
    { key: 'electron', path: input.electronDir },
    { key: 'desktopCache', path: desktopUserDataDir(input) },
    { key: 'electronCache', path: electronCacheDir(input) },
    { key: 'package', path: input.packageRoot },
  ];
  return items.map((it) => ({ ...it, exists: existsSync(it.path) }));
}

/**
 * Reverse the profile name from this package path (used in the unmount command on the settings page).
 *
 * The regular installation form is < $DSH_HOME >/ profiles / < name >/ node_modules/dsh-pet; it cannot be deduced
 * (link: installed elsewhere, or installed in the profiles/node_modules shared layer). undefined is returned, and the
 * client returns the placeholder - it is better not to give a name than to guess wrong.
 * @param packageRoot - the root directory of this package.
 * @returns profile name, or undefined.
 */
export function profileNameFrom(packageRoot: string): string | undefined {
  const m = /[\\/]profiles[\\/]([^\\/]+)[\\/]node_modules[\\/][^\\/]+[\\/]?$/.exec(packageRoot);
  return m?.[1];
}
