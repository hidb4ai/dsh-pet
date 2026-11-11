'use strict';
/**
 * userData directory decision: fall back to its own profile under $DSH_HOME when the original directory is not
 * writable.
 *
 * Only the path and writability are calculated, and Electron is not touched; the writability must be verified by
 * actually writing the file - fs.access on Windows only reflects the read-only attribute and does not verify ACL,
 * which will cause false positives under restricted tokens.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/** Temporary file name used for writability detection; delete immediately after writing. */
const PROBE_NAME = '.dsh-pet-write-probe';

/**
 * DSH home directory: DSH_HOME takes priority, no fallback is set to ~/. dsh (same conventions as host dshHomeDir).
 *
 * @param { NodeJS.ProcessEnv } [ env ] - environment variable, default process.env.
 * @param { string } [ home ] - User home directory, default os.homedir().
 * @returns { string } absolute path.
 */
function dshHomeDir(env = process.env, home = os.homedir()) {
  return env.DSH_HOME || path.join(home, '.dsh');
}

/**
 * Try to prepare the directory into a writable state: create the directory, write the detection file, and then delete
 * it.
 *
 * @param { string } dir - Target directory.
 * @param { object } fileSystem - fs compatible objects.
 * @returns {{ ok : boolean , error : Error | null }} fails with the original error.
 */
function tryPrepareDir(dir, fileSystem) {
  try {
    fileSystem.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, PROBE_NAME);
    fileSystem.writeFileSync(probe, '');
    fileSystem.unlinkSync(probe);
    return { ok: true, error: null };
  } catch (error) {
    return { ok: false, error };
  }
}

/**
 * Is the directory really writable?
 *
 * @param { string } dir - Target directory.
 * @param { object } [ deps ] - `{ fs }` : Test injected fs compatible object.
 * @returns { boolean } Only when all three steps are successful will it be true.
 */
function isWritableDir(dir, deps = {}) {
  return tryPrepareDir(dir, deps.fs || fs).ok;
}

/**
 * Determine the userData directory ultimately used by helper: If the original directory is writable, use the original
 * directory, otherwise use profile under the DSH directory.
 *
 * @param { object } input - Decision input.
 * @param { string } input.currentDir - The current value of app.getPath (' userData ').
 * @param { string } input.dshHome - DSH home directory (see {@link dshHomeDir} ).
 * @param { boolean } input.appMode - whether to use standalone mode; separate profile from DSH helper to avoid
 * kicking each other.
 * @param { object } [ input.fs ] - Tests the injected fs compatible object.
 * @returns {{ dir : string , fallback : boolean , error : Error | null }} Final directory, whether to roll back, and
 * why the rollback failed.
 */
function resolveUserDataDir(input) {
  const fileSystem = input.fs || fs;
  const primary = tryPrepareDir(input.currentDir, fileSystem);
  if (primary.ok) return { dir: input.currentDir, fallback: false, error: null };
  const fallbackDir = path.join(input.dshHome, 'dsh-pet', input.appMode ? 'app-profile' : 'electron-profile');
  const fallback = tryPrepareDir(fallbackDir, fileSystem);
  if (fallback.ok) return { dir: fallbackDir, fallback: true, error: null };
  return { dir: input.currentDir, fallback: false, error: fallback.error };
}

module.exports = { dshHomeDir, isWritableDir, resolveUserDataDir };
