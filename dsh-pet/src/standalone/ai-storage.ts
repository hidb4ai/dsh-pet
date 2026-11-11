/**
 * Native configuration file reading and writing in standalone mode: only handles permissions, atomic replacement and
 * size caps.
 *
 * It is not responsible for setting semantics and validation (see ai-config), nor determining which directory the file
 * should be placed in. Must always be true: writes tighten permissions on empty temporary files before atomic
 * replacement; reads reject symlinks, oversized files, and ACL that are too wide.
 * @module dsh-pet/src/standalone/ai-storage
 */
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  closeSync,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  constants,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

/** The upper limit of bytes for the configuration file. */
const MAX_CONFIG_BYTES = 32_768;

/** Only grant permissions to the current user; never give the shell command, account name, or unverified SID to icacls. */
function restrictFile(path: string): void {
  if (process.platform !== 'win32') {
    chmodSync(path, 0o600);
    return;
  }
  const identity = execFileSync(
    join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'whoami.exe'),
    ['/user', '/fo', 'csv', '/nh'],
    { encoding: 'utf8', windowsHide: true },
  );
  const sid = identity.match(/\bS-1-\d+(?:-\d+)+\b/)?.[0];
  if (!sid) throw new Error('Cannot identify file owner');
  execFileSync(
    join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'icacls.exe'),
    [path, '/inheritance:r', '/grant:r', `*${sid}:F`],
    { stdio: 'pipe', windowsHide: true },
  );
}

/** Parsing and preparing configuration directory, rejecting symbolic links. */
function configPath(home: string): string {
  const directory = join(home, 'dsh-pet');
  if (!existsSync(directory)) mkdirSync(directory, { recursive: true, mode: 0o700 });
  const info = lstatSync(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Unsafe settings directory');
  return join(directory, 'standalone-ai.json');
}

/**
 * Read the local AI configuration.
 * @param home - DSH_HOME.
 * @returns Parsed unknown value; returns undefined if the file does not exist.
 * @throws Thrown when the path, size, or permissions are not secure.
 */
export function readAiSettings(home: string): unknown | undefined {
  return readPrivateJson(configPath(home));
}

/** Read a private JSON configuration using the same permission and size contract as AI settings. */
export function readPrivateJson(path: string): unknown | undefined {
  if (!existsSync(path)) return undefined;
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_CONFIG_BYTES) throw new Error('Unsafe settings file');
  // Explicit wide permissions are more dangerous than being unable to read: first deny, then tighten from restrictFile
  // to the current SID. Files created here should not have any explicit authorization other than the current SID.
  if (process.platform === 'win32') {
    const acl = execFileSync(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'icacls.exe'), [path], {
      encoding: 'utf8',
      windowsHide: true,
    });
    if (/\b(?:Everyone|BUILTIN\\Users|Authenticated Users)\s*:/i.test(acl))
      throw new Error('Unsafe settings permissions');
  }
  restrictFile(path);
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    if (fstatSync(fd).size > MAX_CONFIG_BYTES) throw new Error('Settings file too large');
    return JSON.parse(readFileSync(fd, 'utf8')) as unknown;
  } finally {
    closeSync(fd);
  }
}

/**
 * Atomic write to AI configuration.
 * @param home - DSH_HOME.
 * @param settings - Finished configuration to be persisted.
 * @throws Thrown when the directory or permissions are not secure.
 */
export function writeAiSettings(home: string, settings: unknown): void {
  writePrivateJson(configPath(home), settings);
}

/**
 * Writing JSON atom to trusted directory.
 * @param path - target file.
 * @param settings - JSON value to be written.
 * @throws Thrown when the directory is a symbolic link or writing fails.
 */
export function writePrivateJson(path: string, settings: unknown): void {
  // First confirm that the directory is a normal directory to avoid being taken elsewhere by symbolic links.
  const directory = lstatSync(dirname(path));
  if (!directory.isDirectory() || directory.isSymbolicLink()) throw new Error('Unsafe private file directory');
  if (existsSync(path) && (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()))
    throw new Error('Unsafe settings file');
  const temporary = `${path}.${randomUUID()}.tmp`;
  // Create an empty temporary file first and tighten the permissions before writing any keys to prevent the keys from temporarily falling into the wide permissions file.
  const fd = openSync(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
  try {
    restrictFile(temporary);
    writeFileSync(fd, JSON.stringify(settings), { encoding: 'utf8' });
    fsyncSync(fd);
    closeSync(fd);
  } catch (error) {
    closeSync(fd);
    unlinkSync(temporary);
    throw error;
  }
  try {
    renameSync(temporary, path);
  } catch (error) {
    unlinkSync(temporary);
    throw error;
  }
}
