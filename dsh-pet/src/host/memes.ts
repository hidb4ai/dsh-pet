/**
 * Expression package pool (host side): Parse the configured memes mapping (name → description) into an available
 * candidate pool, shared by whisper and conversation.
 *
 * It is not responsible for the derivation of the directory chain (host/index.ts and memeDirsFor determine the order
 * and priority), nor does it touch the image bytes. It must always be true: the order of the pool = the order written
 * in the configuration, and only the picture that actually exists on the disk can be counted as a hit - the pool says
 * "can be selected", / pic/memes must be "obtained", otherwise the bubble picture will burst. Entries that are missing
 * from the file are silently eliminated (the user does not need to change the configuration simultaneously after
 * deleting the image), and images that have not been configured are not involved (its description cannot be known).
 * Pure function + directory parameters for easy testing. See contracts CONFIG.md and API.md.
 * @module dsh-pet/src/host/memes
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** A picture in the pool: name = configuration key (= file name minus extension), desc = description for the model. */
export interface MemeEntry {
  name: string;
  desc: string;
}

/**
 * Resolving candidate pool from configured memes mapping.
 * @param memes - Configured memes value (not configured/invalid type → empty pool).
 * @param dirs - meme directory chain (order is priority; empty link → empty pool).
 * @returns Candidate pool arranged in the order written in the configuration (the picture does not exist on the chain,
 * or the description is empty → eliminate).
 */
export function readMemePool(memes: unknown, dirs: readonly string[]): MemeEntry[] {
  if (!memes || typeof memes !== 'object' || Array.isArray(memes)) return [];
  if (dirs.length === 0) return [];
  const out: MemeEntry[] = [];
  for (const [name, desc] of Object.entries(memes as Record<string, unknown>)) {
    const text = typeof desc === 'string' ? desc.trim() : '';
    if (!name || !text) continue;
    if (!dirs.some((dir) => existsSync(join(dir, name + '.png')))) continue;
    out.push({ name, desc: text });
  }
  // Not sorted: Order = the order written in the configuration, which is for the user (the "first N sheets" of
  // chatImageLimit and the list handed to the model follow it). Once sorted, the user cannot decide which pictures
  // will be sent out. JSON.parse retains the writing order of character string keys (except for pure numeric keys,
  // which will be mentioned first by JS), so what is read here is the order in the configuration file.
  return out;
}

/** Draw a picture (uniformly random); empty pool returns undefined. */
export function pickMeme(pool: MemeEntry[], random: () => number = Math.random): MemeEntry | undefined {
  if (pool.length === 0) return undefined;
  const idx = Math.floor(random() * pool.length) % pool.length;
  return pool[idx];
}

/** Model selection verification: Only recognize when hitting in the pool (to prevent hallucination of names outside the pool), and return this entry when hitting. */
export function matchMeme(pool: MemeEntry[], name: string): MemeEntry | undefined {
  const key = String(name ?? '').trim();
  return key ? pool.find((m) => m.name === key) : undefined;
}

/** Picture selection mark: `[图:名称]` is attached at the end of the reply (full-width colons and leading and trailing spaces are tolerated). */
const IMG_TAG = /\[图[:：]\s*([^\]\n]+?)\s*\]\s*$/;

/**
 * Get the matching image from the model reply (parsing side of dialogue image selection; pure function, no LLM
 * dependency).
 *
 * Hit in the pool → adopt the image and strip the mark from the text (the mark must not be left in the user-visible
 * text); miss (the model illusion name), empty pool, only return the mark but not the text → will be regarded as
 * unselected, and the text will be retained as it is (responses will never be swallowed if the parsing fails).
 */
export function extractChatImage(text: string, pool: MemeEntry[]): { text: string; image?: string } {
  const m = IMG_TAG.exec(text);
  if (!m) return { text };
  const hit = matchMeme(pool, m[1] ?? '');
  const body = text.slice(0, m.index).trim();
  if (!hit || !body) return { text };
  return { text: body, image: hit.name };
}

/** Emoticon list → Candidate list for the model (one per line: name + description). */
export function memeCatalog(pool: MemeEntry[]): string {
  return pool.map((m) => '- ' + m.name + '：' + m.desc).join('\n');
}

/**
 * According to the "maximum number of dialogue pictures" (configuration chatImageLimit), the candidate pool is
 * truncated.
 *
 * `limit <= 0` or non-finite number → return as is (0 = no limit); `limit > 0` → take the first limit cards in the
 * pool. The pool order is to configure the writing order. Which cards you want to be sent out first can be written
 * forward; decimals are rounded down. Only applies to conversation picture selection: every conversation message in
 * the entire list must be attached. token grows linearly with the number of pictures. After truncation, the cost of
 * picture matching for a single message is immediately controllable; whisper only takes the selected picture and does
 * not pass here.
 */
export function limitPool(pool: MemeEntry[], limit: number): MemeEntry[] {
  const n = Math.floor(Number(limit));
  if (!Number.isFinite(n) || n <= 0) return pool;
  return pool.slice(0, n);
}
