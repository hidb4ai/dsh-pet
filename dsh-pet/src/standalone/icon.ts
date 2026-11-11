/**
 * Setting page label icon: directly read the plugin's own `assets/logo.png` , and do not copy the second image
 * elsewhere.
 *
 * Two local services (standalone mode listener and application mode route) share this module; the read results are
 * cached by process, undefined is returned when the file is missing, and 404 is returned by the caller - no longer
 * silently giving a placeholder image when the image is missing.
 * @module dsh-pet/src/standalone/icon
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PACKAGE_ROOT } from '../host/paths.ts';

let cached: Buffer | undefined;

/**
 * Read tag icon bytes.
 *
 * @returns PNG bytes; undefined when the file does not exist or is unreadable.
 */
export function readSettingsIcon(): Buffer | undefined {
  if (cached) return cached;
  try {
    cached = readFileSync(join(PACKAGE_ROOT, 'assets', 'logo.png'));
    return cached;
  } catch {
    return undefined;
  }
}
