/**
 * persist to disk in standalone mode running state: write the port, token and setting page address to the local
 * launcher.
 *
 * Only serves the local launcher, does not enter / health response, and does not participate in route. It must always
 * be true: the permissions are inherited from the private JSON write; when cleaning, only the copy written by you is
 * deleted.
 * @module dsh-pet/src/standalone/runtime-state
 */
import { mkdirSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

import { writePrivateJson } from './ai-storage.ts';

/** Running status content; token is only given to the local launcher. */
interface RuntimeDetails {
  /** Actual listening port. */
  port: number;
  /** The ability token for this run. */
  token: string;
  /** Settings page address with token. */
  settingsUrl: string;
  /** The root directory of the plugin package. */
  pluginRoot: string;
}

/**
 * Write running status and return idempotent cleanup function.
 * @param home - DSH_HOME.
 * @param details - Port, token, settings page address and plugin root.
 * @returns idempotent cleaning function.
 * @throws Thrown when writing cannot be done safely.
 */
export function writeStandaloneRuntime(home: string, details: RuntimeDetails): () => void {
  const directory = join(home, 'dsh-pet');
  mkdirSync(directory, { recursive: true });
  const file = join(directory, 'standalone-runtime.json');
  try {
    writePrivateJson(file, {
      name: 'dsh-pet-standalone',
      pid: process.pid,
      startedAt: new Date().toISOString(),
      ...details,
    });
  } catch (error) {
    throw new Error('Could not safely write the pet runtime state. Check data-directory permissions.', {
      cause: error,
    });
  }
  let released = false;
  // Only delete files that match both pid and token to avoid accidentally deleting the status of another instance.
  return () => {
    if (released) return;
    released = true;
    try {
      const current = JSON.parse(readFileSync(file, 'utf8')) as { pid?: number; token?: string };
      if (current.pid === process.pid && current.token === details.token) unlinkSync(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw new Error(
        "Could not clean up the pet runtime state. Check the data directory; other processes' state was preserved.",
        { cause: error },
      );
    }
  };
}
