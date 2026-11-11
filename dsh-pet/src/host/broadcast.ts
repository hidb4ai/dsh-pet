/**
 * The pure decision-making layer of the two endpoints of bubble (feeding and clear): both write the same leaf
 * `pets.<id>.say` and share the same placement rule.
 *
 * Responsible for collating external input into a clear conclusion; does not generate content - generation is
 * whisper's business. Not responsible for HTTP: The response and occupied validation check are both in the route
 * layer. This layer only returns reason and does not throw exceptions. Depends on resolved configuration and
 * meme pool (memeDirs is given by caller to facilitate testing and injecting into the temporary
 * directory). No frequency limitation or truncation: Feeding is an explicit caller behavior, and the content and
 * frequency are the responsibility of the caller itself. Always true: pet is required and must actually exist. It will
 * never be returned to the first one in the list by default; at most one of the two matching patterns will be given.
 * See contracts API.md and openapi.yaml.
 *
 * @module dsh-pet/src/host/broadcast
 */

import { findPetInstance } from './config.ts';
import { matchMeme, readMemePool } from './memes.ts';
// The scheme rule of the url parameter is the same as / anim (the two "third-party feeding" endpoints do not write a copy each to avoid aliasing)
import { normalizeHttpUrl } from './anim.ts';

/**
 * The default display duration of bubble (ms) - the same value as the constants on the consumer side at both ends
 * (host cannot be import src/shared, you can only write one copy each). It is only used to parse the default into an
 * explicit value and write it into the leaf, so that the actual effective duration can be seen in / state.
 */
const DEFAULT_BUBBLE_DURATION_MS = 10 * 1000;

/** Two categories of pet parameter parsing failure (the three "pet required" endpoints share this pair of words, which are the same conventions as ./anim and ./motion-cue). */
export type PetFailure = 'pet-required' | 'unknown-pet';

/** Category of feeding failure (route is revealed to caller as is). */
export type BroadcastFailure = 'bad-request' | PetFailure | 'unknown-image';

/**
 * Decision conclusion: If passed, the content that will eventually be written into S will be given, otherwise an
 * explicit reason will be given. There is at most one image and url (two forms with pictures, distinguished by field
 * names); duration / anim are parsed effective values.
 */
export type BroadcastDecision =
  | { ok: true; petId: string; text: string; image?: string; url?: string; duration: number; anim: boolean }
  | { ok: false; reason: BroadcastFailure; message: string };

/** The decision conclusion of clear bubble (only the pet analysis step will fail). */
export type BubbleClearDecision = { ok: true; petId: string } | { ok: false; reason: PetFailure; message: string };

/**
 * Feeding text normalization: non-character string / pure blank → empty string. Route shares this rule with the
 * decision-making layer to avoid reading the configuration for a request that is bound to fail.
 */
export function normalizeBroadcastText(text: unknown): string {
  return typeof text === 'string' ? text.trim() : '';
}

/**
 * bubble duration normalization: Default / null → Default 10 s; if valid, return as is; if invalid
 * (non-numeric/non-limited/negative number) return null. Route uses short-circuit first, don't touch the disk for a
 * request that is bound to fail; 0 is valid, literally meaning "do not display".
 */
export function normalizeBroadcastDuration(duration: unknown): number | null {
  if (duration === undefined || duration === null) return DEFAULT_BUBBLE_DURATION_MS;
  if (typeof duration !== 'number' || !Number.isFinite(duration) || duration < 0) return null;
  return duration;
}

/**
 * Animation linkage switch is standardized: only strictly false will be turned off, and the rest will press "Require
 * Linkage". The looseness is intentional: the old caller will not pass this field, and the loose conventions ensure
 * that their behavior remains unchanged.
 */
export function normalizeBroadcastAnim(anim: unknown): boolean {
  return anim !== false;
}

/**
 * The broadcast switch is standardized: only the strict `true` will be read, and the rest (including the `"true"`
 * character string) will not be read. The default of not reading is intentional: the text and timing of feeding are
 * determined by the caller, and there should be no sound by default - otherwise any high-frequency feeding will become
 * continuous reading, and the caller often does not realize that he has turned on the speaker.
 */
export function normalizeBroadcastVoice(speak: unknown): boolean {
  return speak === true;
}

/**
 * `?pet=` → Actual landing point (same conventions as ./anim, ./motion-cue): required and must actually exist.
 *
 * The two types of failures are reported separately (it will never default to the first one in the list): it is not
 * given → pet-required, and it is given but there is no → unknown-pet in the configuration.
 */
function resolvePetId(
  cfg: Record<string, Record<string, unknown>>,
  requested: string,
):
  | { ok: true; petId: string; entry: string; conf: Record<string, unknown> }
  | { ok: false; reason: PetFailure; message: string } {
  const petId = String(requested ?? '').trim();
  if (!petId) return { ok: false, reason: 'pet-required', message: 'pet 必填：要指定操作哪只桌宠' };
  // A search gives the existence and ownership entries at the same time (entry = asset root, according to which the image pool is taken): the verification and value have the same source, no need to check again later
  const found = findPetInstance(cfg, petId);
  if (!found) return { ok: false, reason: 'unknown-pet', message: '没有这只桌宠：' + petId };
  return { ok: true, petId, entry: found.entry, conf: found.conf };
}

/**
 * Check the external { text , image , url , duration , anim } with the current configuration to reach a conclusion.
 *
 * Choose one of the two forms of matching pictures: image = name in the pool (take the canonical name in the pool
 * after hitting), url = third party’s own address (do not check the pool).
 * @param args - Feeding parameters: `cfg` is the resolved configuration; `requested` is the original value of
 * `?pet=` (empty string → `pet-required` );
 * `duration` and `anim` have been standardized by route; `memeDirs` maps the asset root to the meme
 * directory chain (the order is the priority).
 */
export function decideBroadcast(args: {
  cfg: Record<string, Record<string, unknown>>;
  /** The original value of `?pet=` (required: empty string → pet-required) */
  requested: string;
  text: unknown;
  image: unknown;
  url: unknown;
  duration: number;
  anim: boolean;
  memeDirs: (entry: string) => string[];
}): BroadcastDecision {
  const { cfg, requested, memeDirs } = args;

  const text = normalizeBroadcastText(args.text);
  if (!text) return { ok: false, reason: 'bad-request', message: 'text 为空' };

  const who = resolvePetId(cfg, requested);
  if (!who.ok) return { ok: false, reason: who.reason, message: who.message };
  const petId = who.petId;

  const rawImage = typeof args.image === 'string' ? args.image.trim() : '';
  const rawUrl = typeof args.url === 'string' ? args.url.trim() : '';
  if (rawImage && rawUrl) return { ok: false, reason: 'bad-request', message: 'image 与 url 只能给一个' };
  if (!rawImage && !rawUrl) return { ok: true, petId, text, duration: args.duration, anim: args.anim };

  // url form: The address is valid and is released without checking the emoticon pool - the image is in the hands of a
  // third party, and of course there is no image in the pool. If the image cannot be obtained, the consumer will
  // perform it (image cracking), and the host does not act as a proxy or prefetch, so there is no verifiable "whether
  // the image actually exists" here.
  if (rawUrl) {
    const url = normalizeHttpUrl(rawUrl);
    if (url === null) {
      return { ok: false, reason: 'bad-request', message: 'url 必须是 http/https 的完整地址' };
    }
    return { ok: true, petId, text, url, duration: args.duration, anim: args.anim };
  }

  // The matching picture only recognizes the name of the hit in the pool (after the hit, the canonical name in the
  // pool is used instead of the character string passed in from the outside); the pool is taken according to the entry
  // it belongs to (the same conventions as whisper/dialogue), and the matching picture does not cross the pet string
  // pool.
  const hit = matchMeme(readMemePool(who.conf.memes, memeDirs(who.entry)), rawImage);
  if (!hit) {
    return { ok: false, reason: 'unknown-image', message: '配图不在表情包池内：' + rawImage };
  }
  return { ok: true, petId, text, image: hit.name, duration: args.duration, anim: args.anim };
}

/**
 * Decision of clear bubble: Just decide "which pet to clear".
 *
 * The occupied validation check is not here: "Who is qualified to clear" is locked by the route layer after it, and
 * the step is always released when lock is not included. The difference from feeding is that there is no such failure
 * as "bubble does not exist": there is currently no bubble and ok is returned (idempotent).
 */
export function decideBubbleClear(args: {
  cfg: Record<string, Record<string, unknown>>;
  /** The original value of `?pet=` (required: empty string → pet-required) */
  requested: string;
}): BubbleClearDecision {
  const who = resolvePetId(args.cfg, args.requested);
  if (!who.ok) return { ok: false, reason: who.reason, message: who.message };
  return { ok: true, petId: who.petId };
}
