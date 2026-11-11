/**
 * The pure decision-making layer of playback request animation (`POST /dsh-pet-7340/anim`): determine whether and
 * which one should be played, and leave the conclusion to the writer.
 *
 * It is not responsible for playback, nor does it write S; it is the same action processing function as reuse in the
 * right-click menu "Action" tree. The animation name must fall in the allowed set - there is no fallback on the
 * playback end (the name is the file name, 404 means "no response after clicking"), so this verification is a hard
 * requirement, and it must be able to break away from the HTTP single test. Allowed set = the union of all anim in the
 * third-level leaves of the menu ∪ The gameplay comes with animation (`animations.baifan`): The source of the former
 * is src/shared/menu.ts's buildMenuTree() (host is not import src/shared, so it contains one copy), the latter does
 * not enter the menu, but it is also the plugin's own asset (playback request by name for free) it). Only relies on
 * the finished configuration and does not touch the file system. See contracts API.md and openapi.yaml.
 * @module dsh-pet/src/host/anim
 */

import { findPetInstance } from './config.ts';

/** Playback failure categories, returned unchanged by the route. */
export type AnimFailure = 'bad-request' | 'pet-required' | 'unknown-pet' | 'unknown-animation';

/**
 * Orientation: `left` = asset as is, `right` = mirror (renderer pastes `scaleX(-1)` ). The union with the same name as
 * shared/state.ts is two copies (host and import src/shared), and both sides must be changed together when changing.
 */
export type PetFacing = 'left' | 'right';

/**
 * Decision conclusion: If passed, the content that will eventually be written into S (exactly one `name` and `url` )
 * will be given, otherwise an explicit reason will be given. `facing` is absent = caller is not specified, renderer
 * does not move (not fallback left).
 */
export type AnimDecision =
  | { ok: true; petId: string; name?: string; url?: string; facing?: PetFacing }
  | { ok: false; reason: AnimFailure; message: string };

/** The pool in the configuration is narrowed: non-array and non-character string items are discarded. */
function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x !== '') : [];
}

/** Direction narrowing: only two literals are recognized, and the rest (uppercase and lowercase, blanks, non-character strings) are not counted. */
const petFacing = (v: unknown): PetFacing | null => (v === 'left' || v === 'right' ? v : null);

/**
 * animations configuration of this entry → Animation name that can be playedback request (deduplicate, keeping the
 * order of first appearance). The pool is aligned with the sequence buildMenuTree() of src/shared/menu.ts: standby →
 * turn → drag → click to respond → move → random action classification → event (array slot flattening); add a gameplay
 * pool (`baifan`) after the menu pool.
 */
export function animationNames(animations: unknown): string[] {
  const a = (animations && typeof animations === 'object' ? animations : {}) as Record<string, unknown>;
  const out: string[] = [];
  const push = (names: string[]): void => {
    for (const n of names) if (!out.includes(n)) out.push(n);
  };

  push(strings(a.idle));
  push(strings(a.turn));
  push(strings(a.drag));
  push(strings(a.clicks));

  // Move: actions is { name, ... } object array, only take name
  const moves = (a.moves && typeof a.moves === 'object' ? a.moves : {}) as Record<string, unknown>;
  push(
    Array.isArray(moves.actions)
      ? moves.actions
          .map((m) => (m && typeof m === 'object' ? (m as { name?: unknown }).name : undefined))
          .filter((x): x is string => typeof x === 'string' && x !== '')
      : [],
  );

  // config random action classification: one actions pool for each classification
  if (Array.isArray(a.categories)) {
    for (const c of a.categories) {
      if (c && typeof c === 'object') push(strings((c as { actions?: unknown }).actions));
    }
  }

  // Event animation: value is "array of states", each state may be a single name or an array of candidates (flattened)
  const events = (a.events && typeof a.events === 'object' ? a.events : {}) as Record<string, unknown>;
  for (const key of Object.keys(events)) {
    const pool = events[key];
    if (!Array.isArray(pool)) continue;
    const names: string[] = [];
    for (const slot of pool) {
      if (typeof slot === 'string') names.push(slot);
      else names.push(...strings(slot));
    }
    push(names);
  }

  // The gameplay comes with animation (freeloader): it is not on the menu tree, but it is also the plugin’s own
  // asset, named playback request. Appended at the end: The order of the menu pool is verified by menu tree
  // conventions and order tests, and new gameplay should not be inserted in the middle of the menu sequence.
  push(strings(a.baifan));

  return out;
}

/**
 * Standardization of third-party resource addresses: only the complete URL of http / https will be released, and the
 * rest will be null (caller returns bad-request).
 *
 * The desktop source is directly connected to `el.src = url` (without going through `/thumb` ). `file:` allows the
 * renderer to read any local file. `javascript:` / `data:` has no reason to open this port. Cross-domain issues are
 * not solved here, nor should they be solved here: the desktop asset uses fetch + blob, and CORS is forced by the
 * browser. The third party can only configure the response header or register the same-origin route; the host does not
 * act as a proxy, so there is no SSRF interface. This rule is shared with ./broadcast (the url parameters of the two
 * "third-party feeding" endpoints have the same conventions).
 */
export function normalizeHttpUrl(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const raw = v.trim();
  if (!raw) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  return raw;
}

/**
 * Check the external playback request request with the current configuration to reach a conclusion.
 *
 * Choose one of `name` and `url` : `url` is the asset address provided by the third party. If you give it, you will
 * not check the animation pool - the asset is in the hands of others, and of course there is no such name in the pool;
 * giving them both/not giving them is unclear, just use bad-request instead of guessing one for the caller.
 *
 * @param args - playback request parameters: `cfg` is the resolved configuration (the field is filled in,
 * fallback analysis is not performed); `requested` is the original value of `?pet=`
 * (Empty string → `pet-required` ); `name` / `url` is not standardized and choose one of the two; `facing` is
 * optional, and the orientation will not change if not given.
 */
export function decideAnim(args: {
  cfg: Record<string, Record<string, unknown>>;
  requested: string;
  name: unknown;
  url: unknown;
  facing?: unknown;
}): AnimDecision {
  const { cfg, requested } = args;

  const name = typeof args.name === 'string' ? args.name.trim() : '';
  const rawUrl = typeof args.url === 'string' ? args.url.trim() : '';
  if (name && rawUrl) return { ok: false, reason: 'bad-request', message: 'name 与 url 只能给一个' };
  if (!name && !rawUrl) return { ok: false, reason: 'bad-request', message: 'name 或 url 必须给一个' };

  // facing Optional: Not given (undefined / null are both counted, both are common when reusing the body template) →
  // Do not move in the orientation, keep the pet's current orientation, instead of fallback left. If given, it must be
  // valid: invalid values are not silently ignored (the same conventions as mode of / position, there is no precedent
  // for "invalid values are not passed" in the whole plugin). Place it before pet parsing - the parameter is caller's
  // fault, correct it first.
  let facing: PetFacing | undefined;
  if (args.facing !== undefined && args.facing !== null) {
    const f = petFacing(args.facing);
    if (f === null) return { ok: false, reason: 'bad-request', message: 'facing 必须是 left / right' };
    facing = f;
  }

  // pet is required and must actually exist (same conventions as / broadcast and / position): It will never default to
  // the "current desktop pet" - that is the first pet in the valid pet list. The placement point changes with the
  // user's / pet operation, and third parties cannot predict it.
  const petId = String(requested ?? '').trim();
  if (!petId) return { ok: false, reason: 'pet-required', message: 'pet 必填：要指定操作哪只桌宠' };
  // A search gives both "existence" and "ownership entry" (the animation pool is taken by entry): the same result is
  // used for verification and value acquisition, and there is no need to check again later.
  const found = findPetInstance(cfg, petId);
  if (!found) return { ok: false, reason: 'unknown-pet', message: '没有这只桌宠：' + petId };

  // url form: The address is released as soon as it is valid. It does not check the animation pool, nor does it
  // require the asset to be actually obtained - the playback end has no fallback for the unobtainable address (browser
  // fetch failure / desktop video error), and will report failed truthfully through the receipt, instead of guessing
  // here.
  if (rawUrl) {
    const url = normalizeHttpUrl(rawUrl);
    if (url === null) {
      return { ok: false, reason: 'bad-request', message: 'url 必须是 http/https 的完整地址' };
    }
    return { ok: true, petId, url, facing };
  }

  // name form: The name must be the animation clicked in the pet menu. On the playback side, "the name is the file
  // name". Playing non-existent animations will only fail silently, so it must be stopped here instead of writing S
  // and letting the front end run in vain.
  const allowed = animationNames(found.conf.animations);
  if (!allowed.includes(name)) {
    return { ok: false, reason: 'unknown-animation', message: '没有这个动画：' + name };
  }

  return { ok: true, petId, name, facing };
}
