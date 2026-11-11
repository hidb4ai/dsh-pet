/**
 * Voice cache: Press the "Tone + Speech Speed + Text" arithmetic key, persist to disk is mp3, and eliminate the oldest
 * one based on the total volume and number of entries.
 *
 * Hit-and-miss synthesis - the same sentence will only be synthesized once, whether it is an automatic broadcast or a
 * user's click history. Caching only speeds up, deleting any file will not affect the correctness: the next request
 * will be synthesized again. Not responsible for synthesis and queues.
 * @module dsh-pet/src/host/voice/cache
 */
import { createHash } from 'node:crypto';
import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

/** The upper limit of the total cache size (bytes): after it is exceeded, it will be deleted from the oldest one. */
export const CACHE_MAX_BYTES = 20 * 1024 * 1024;
/** The upper limit of the number of cached files. */
export const CACHE_MAX_FILES = 200;

/** Full path to cache file: `<userRoot>/voice-cache/<key>.mp3`. */
export function cachePath(userRoot: string, key: string): string {
  return join(userRoot, 'voice-cache', `${key}.mp3`);
}

/**
 * Calculating cache keys.
 *
 * All four inputs affect audio content. `source` is the synthesis source - the built-in implementation of id or the
 * third-party provider's id: without it, the old audio from the previous company will be hit after switching the
 * implementation, which sounds like "register has not taken effect". `text` does not perform normalization - one more
 * space in the same sentence is another audio. It is better to save more than to take the risk of "sounding wrong".
 * @param source - synthesis source.
 * @param voice - voice id; the third-party implementation has no voice concept and transmits an empty string.
 * @param rate - speech rate expression (such as `+0%` ).
 * @param text - text to be synthesized.
 * @returns hex sha1.
 */
export function cacheKey(source: string, voice: string, rate: string, text: string): string {
  return createHash('sha1').update(`${source}\n${voice}\n${rate}\n${text}`).digest('hex');
}

/**
 * Make sure the cache directory exists.
 * @param userRoot - User data root.
 * @returns Absolute path to the cache directory.
 */
export async function ensureCacheDir(userRoot: string): Promise<string> {
  const dir = join(userRoot, 'voice-cache');
  await mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Eliminate the oldest files according to "total amount + number of items"; stop immediately when both upper limits
 * are met.
 * @param dir - cache directory.
 * @param limits - upper limit, module constant is used by default.
 * @returns The actual number of deleted files.
 */
export async function pruneCache(dir: string, limits: { maxBytes?: number; maxFiles?: number } = {}): Promise<number> {
  const maxBytes = limits.maxBytes ?? CACHE_MAX_BYTES;
  const maxFiles = limits.maxFiles ?? CACHE_MAX_FILES;
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return 0; // The directory does not exist yet: there is nothing to eliminate
  }
  const entries: { file: string; size: number; mtimeMs: number }[] = [];
  for (const name of names) {
    if (!name.endsWith('.mp3')) continue;
    const file = join(dir, name);
    try {
      const info = await stat(file);
      entries.push({ file, size: info.size, mtimeMs: info.mtimeMs });
    } catch {
      /* This article is being deleted by another request, skip */
    }
  }
  entries.sort((a, b) => a.mtimeMs - b.mtimeMs);
  let totalBytes = entries.reduce((sum, entry) => sum + entry.size, 0);
  let totalFiles = entries.length;
  let removed = 0;
  for (const entry of entries) {
    if (totalBytes <= maxBytes && totalFiles <= maxFiles) break;
    try {
      await rm(entry.file, { force: true });
      removed += 1;
      totalBytes -= entry.size;
      totalFiles -= 1;
    } catch {
      /* If you cannot delete it, keep it. It will not affect this request. */
    }
  }
  return removed;
}
