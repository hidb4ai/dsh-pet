/**
 * Browser product of settings page dialog panel: Read `lib/chat-panel.js` in the same package at runtime.
 *
 * Same conventions as icon.ts: cached by process, undefined cannot be read, and 404 is returned by the caller - when
 * the product is missing, it is better to report an error explicitly than to silently return an empty script and leave
 * the page blank.
 * @module dsh-pet/src/standalone/chat-panel-asset
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PACKAGE_ROOT } from '../host/paths.ts';

let cached: string | undefined;

/**
 * Reading dialog panel script.
 *
 * @returns packaged script source code; when it is not built or the file is unreadable, it is undefined.
 */
export function readChatPanelScript(): string | undefined {
  if (cached !== undefined) return cached;
  try {
    cached = readFileSync(join(PACKAGE_ROOT, 'lib', 'chat-panel.js'), 'utf8');
    return cached;
  } catch {
    return undefined;
  }
}
