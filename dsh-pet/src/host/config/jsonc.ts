/**
 * JSONC tolerates reading: parses user-written, //-annotated configurations into objects.
 *
 * Fields are not verified, and no merging is performed; parsing failures are always thrown, and the caller decides
 * whether to return or report an error. This must always be true: only annotations and parsing are done, and user file
 * contents are never rewritten.
 * @module dsh-pet/src/host/config/jsonc
 */
import { existsSync, readFileSync } from 'node:fs';
import type { ConfigPaths } from './constants.ts';

/** Only delete JSONC comments outside the character string, retaining character string escape, newline and separation of adjacent JSON token. */
function stripJsonc(src: string): string {
  let out = '';
  let inString = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inString) {
      out += ch;
      if (ch === '\\' && i + 1 < src.length) {
        out += src[++i];
      } else if (ch === '"') {
        inString = false;
      }
    } else if (ch === '"') {
      inString = true;
      out += ch;
    } else if (ch === '/' && src[i + 1] === '/') {
      out += ' ';
      while (i + 1 < src.length && src[i + 1] !== '\r' && src[i + 1] !== '\n') i++;
    } else if (ch === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      if (end === -1) throw new SyntaxError('Unterminated JSONC block comment');
      out += src.slice(i, end + 2).replace(/[^\r\n]/g, ' ');
      i = end + 1;
    } else {
      out += ch;
    }
  }
  return out.trim();
}

/** Read and parse JSONC file; does not exist/parse failed → undefined (caller decides to process) */
export function readJsonc(path: string): Record<string, unknown> | undefined {
  try {
    const raw = JSON.parse(stripJsonc(readFileSync(path, 'utf8'))) as unknown;
    return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Reading user-level raw objects on disk (JSONC tolerated, shares the same parser as the read path). It must be used
 * to write the path: PUT /config's transparent transmission retention requires the user's manually modified advanced
 * fields to be brought back as they are, and the user layer may be the original config.jsonc with // annotations; if
 * strict JSON.parse is used, parsing errors will be thrown → existing becomes undefined → whitelist reconstruction →
 * all advanced fields will be lost. File does not exist/corrupt → undefined.
 */
export function readUserConfig(paths: ConfigPaths): Record<string, unknown> | undefined {
  const file = effectiveUserFile(paths);
  return file ? readJsonc(file) : undefined;
}

/**
 * The user layer exists but cannot be parsed (really damaged: even JSONC stripped comments cannot be saved). Purpose:
 * PUT /config damage pre-check - saving is whitelist reconstruction. If existing cannot be read, the original content
 * will be silently discarded, so do not write to the disk first, return 200 + `reason=user-config-unparsable` and let
 * the setting page pop-up window confirm. File does not exist → false.
 */
export function userConfigUnparsable(paths: ConfigPaths): boolean {
  const file = effectiveUserFile(paths);
  return file !== undefined && readJsonc(file) === undefined;
}

export function effectiveUserFile(paths: ConfigPaths): string | undefined {
  if (existsSync(paths.userFile)) return paths.userFile;
  if (paths.legacyUserFile && existsSync(paths.legacyUserFile)) return paths.legacyUserFile;
  return undefined;
}
