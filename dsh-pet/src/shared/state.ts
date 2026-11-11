/**
 * Pure logic on the client side of the polling state (/ state): pull, flatten the leaves, and compare with the
 * baseline. It is not responsible for writing status - the action endpoint only returns receipts, and the data has
 * only one outlet; the path is only parsed into drop points according to known suffixes (see resolveLeafPath), and
 * will never be segmented according to dot numbers, because pet id allows dot numbers. Both ends share the same copy;
 * the first pull only remembers the baseline and does not render, otherwise refreshing the page will replay the old
 * bubble.
 * @module dsh-pet/src/shared/state
 */
import { toBalanceState, type BalanceState } from './balance/index.ts';
import { toWorkStatus, type WorkStatusSnapshot } from './work-status.ts';
import { ROUTE_PATH } from './constants.ts';

/** A leaf: counter + load; data is null, which means there is no data yet, and the consumer skips it. */
export interface StateLeaf {
  counter: number;
  data: unknown;
}

/** Client view of polling status (leaves normalized: counter must be numeric). */
export interface PollState {
  /**
   * The version number of the entire S (= the last written number) is returned as ? since = to express "Which version
   * is this in my hand?" The old host does not have this field → undefined: The consumer will return to scheduled
   * polling based on this - the old host does not know since/timeout and will return immediately. If it does not
   * retreat, it will become a frantic attack.
   */
  counter?: number;
  sections: Record<string, StateLeaf>;
  pets: Record<string, Record<string, StateLeaf>>;
}

/** A changed leaf (path for logging and debugging, leaf for rendering). */
export interface StateChange {
  path: string;
  leaf: StateLeaf;
}

/** Leaf normalization: wrong shape (non-object or counter non-number) → null, preventing dirty data from entering the rendering layer. */
function normLeaf(value: unknown): StateLeaf | null {
  if (!value || typeof value !== 'object') return null;
  const leaf = value as { counter?: unknown; data?: unknown };
  if (typeof leaf.counter !== 'number' || !Number.isFinite(leaf.counter)) return null;
  return { counter: leaf.counter, data: leaf.data ?? null };
}

/**
 * Pull once / state; if it fails, HTTP is not 2 xx or the shape is wrong, null will be returned (the polling side
 * retries silently). wait will be carried after it is passed ? since =& timeout = Long polling: The host will hang
 * when the version does not change until any leaf is written or times out; if it is not passed, the full amount will
 * be returned immediately.
 */
export async function fetchState(
  baseUrl = ROUTE_PATH + '/state',
  wait?: { since: number; timeoutMs: number },
): Promise<PollState | null> {
  try {
    const url = wait ? `${baseUrl}?since=${wait.since}&timeout=${wait.timeoutMs}` : baseUrl;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    const raw = (await res.json().catch(() => null)) as {
      ok?: unknown;
      counter?: unknown;
      sections?: unknown;
      pets?: unknown;
    } | null;
    // Business failure is also 200: The body of `ok:false` is not a snapshot, and is handled as a failure (otherwise it will be treated as an "empty state" once successfully)
    if (!raw || typeof raw !== 'object' || raw.ok === false) return null;
    const sections: Record<string, StateLeaf> = {};
    const rawSections =
      raw.sections && typeof raw.sections === 'object' ? (raw.sections as Record<string, unknown>) : {};
    for (const [name, value] of Object.entries(rawSections)) {
      const leaf = normLeaf(value);
      if (leaf) sections[name] = leaf;
    }
    const pets: Record<string, Record<string, StateLeaf>> = {};
    const rawPets = raw.pets && typeof raw.pets === 'object' ? (raw.pets as Record<string, unknown>) : {};
    for (const [petId, entry] of Object.entries(rawPets)) {
      if (!entry || typeof entry !== 'object') continue;
      const leaves: Record<string, StateLeaf> = {};
      for (const [name, value] of Object.entries(entry as Record<string, unknown>)) {
        const leaf = normLeaf(value);
        if (leaf) leaves[name] = leaf;
      }
      pets[petId] = leaves;
    }
    return {
      counter: typeof raw.counter === 'number' && Number.isFinite(raw.counter) ? raw.counter : undefined,
      sections,
      pets,
    };
  } catch {
    return null;
  }
}

/** Traverse all leaves of S (sections first, pets last). */
function* walkLeaves(s: PollState): Generator<[string, StateLeaf]> {
  for (const [name, leaf] of Object.entries(s.sections ?? {})) yield ['sections.' + name, leaf];
  for (const [petId, leaves] of Object.entries(s.pets ?? {})) {
    for (const [name, leaf] of Object.entries(leaves ?? {})) yield ['pets.' + petId + '.' + name, leaf];
  }
}

/** S → {leaf path: counter}, used for first pulling the baseline; the newly added section or pets are automatically included. */
export function flattenCounters(s: PollState): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [path, leaf] of walkLeaves(s)) out[path] = leaf.counter;
  return out;
}

/**
 * Compare with the baseline and advance the baseline in place, returning the leaves of this change. Do not adjust it
 * during the first pull (use flattenCounters to record the baseline), otherwise the page refresh will replay the old
 * data.
 */
export function takeChanged(s: PollState, baseline: Record<string, number>): StateChange[] {
  const out: StateChange[] = [];
  for (const [path, leaf] of walkLeaves(s)) {
    if (baseline[path] === leaf.counter) continue;
    baseline[path] = leaf.counter;
    out.push({ path, leaf });
  }
  return out;
}

/** Which leaves in `sections.<name>` will be distributed by the consumer. */
export type SectionLeafName = 'config' | 'balance' | 'workStatus' | 'notify' | 'menu' | 'focusSession';

/** Which leaves in `pets.<id>.<name>` will be distributed by the consumer. */
export type PetLeafName = 'say' | 'anim' | 'position' | 'throw' | 'lock' | 'sleep';

/** The drop point for a leaf distribution: segmented leaves, or leaves of a certain pet. */
export type LeafTarget =
  { where: 'section'; name: SectionLeafName } | { where: 'pet'; name: PetLeafName; petId: string };

/** The complete set of segmented leaf names; when adding section leaf, change it together with {@link SectionLeafName}. */
const SECTION_LEAF_NAMES = ['config', 'balance', 'workStatus', 'notify', 'menu', 'focusSession'] as const;

/** The complete set of pet leaf names; when adding a new pet leaf, change it together with {@link PetLeafName}. */
const PET_LEAF_NAMES = ['say', 'anim', 'position', 'throw', 'lock', 'sleep'] as const;

/** Narrow character string into segment leaf names. */
function isSectionLeafName(name: string): name is SectionLeafName {
  return (SECTION_LEAF_NAMES as readonly string[]).includes(name);
}

/** Narrow character string to pet leaf name. */
function isPetLeafName(name: string): name is PetLeafName {
  return (PET_LEAF_NAMES as readonly string[]).includes(name);
}

/**
 * Parse the leaf path into the landing point; if it is unknown (including empty pet id, empty leaf name) → null, the
 * consumer skips this beat.
 *
 * The pet id is allowed to contain dots, so only press the **last** dot to cut the leaf name, never `split('.')` : the
 * pet of `pets.a.b.say` is `a.b` . The rules are here instead of in the distribution location to break away from the
 * React assertion - both ends share the same conventions.
 */
export function resolveLeafPath(path: string): LeafTarget | null {
  if (path.startsWith('sections.')) {
    const name = path.slice('sections.'.length);
    return isSectionLeafName(name) ? { where: 'section', name } : null;
  }
  if (!path.startsWith('pets.')) return null;
  const rest = path.slice('pets.'.length);
  const dot = rest.lastIndexOf('.');
  // dot ≤ 0: There is no leaf name (`pets.a`) or the pet id is empty (`pets..say`) - neither is a valid landing point.
  if (dot <= 0) return null;
  const name = rest.slice(dot + 1);
  return isPetLeafName(name) ? { where: 'pet', name, petId: rest.slice(0, dot) } : null;
}

/**
 * Type narrowing: balance leaf → `{ state, manual }` .
 * manual = This write is triggered manually (/balance command, desktop "View Balance" menu), and is marked by the host
 * when writing. The consumer decides accordingly whether to display a text description when the balance is
 * unavailable. Invalid shape → null, consumer skips this beat.
 */
export function readBalance(leaf: StateLeaf): { state: BalanceState; manual: boolean } | null {
  const state = toBalanceState(leaf.data);
  if (!state) return null;
  const manual = (leaf.data as { manual?: unknown }).manual === true;
  return { state, manual };
}

/**
 * Speaking command (two forms of `pets.<id>.say` ). say: play a bubble, duration = display duration (milliseconds;
 * default 10 s, 0 = literally "do not display"), anim only appears when false is explicit, indicating that the
 * events.whisper animation will not be linked this time and only bubbles will be played. clear: Collapse the current
 * bubble (the landing point of POST /bubble/clear), which must be in a separate form - empty text will be deemed
 * invalid and the entire beat will be skipped. The two forms of accompanying pictures are juxtaposed and distinguished
 * by field names: image = the name in the emoticon pool (consumer puzzle piece path), url = the complete address given
 * by the third party. Do not do "one neutral field holds two values": the consumer must know whether to spell the
 * path, relying on startsWith (' http ') sniffing will make an error when the name is like URL. voiceTo: host
 * specifies which end should read this sentence (currently only periodic whisper and to-do reminders are written);
 * default = no one reads it.
 */
export type SayCue =
  | {
      kind: 'say';
      text: string;
      image?: string;
      url?: string;
      duration?: number;
      anim?: boolean;
      voiceTo?: VoiceTarget;
    }
  | { kind: 'clear' };

/** Which end of a conversation should be pronounced; the combination with the same name as src/host/surface is two copies (host is not import src/shared), and both sides should be changed together when changing. */
export type VoiceTarget = 'web' | 'desktop';

/**
 * Type narrowing: pet talk leaves → SayCue (invalid shape or empty text → null, consumer skips this beat). whisper,
 * command bubble, and conversation reply share this leaf - the front end is originally the same display link. The
 * default behavior of duration and anim is the default behavior (10 s + linkage). Leaves that do not write these two
 * fields can still be read.
 */
export function readSay(leaf: StateLeaf): SayCue | null {
  if (!leaf.data || typeof leaf.data !== 'object') return null;
  const d = leaf.data as {
    text?: unknown;
    image?: unknown;
    url?: unknown;
    duration?: unknown;
    anim?: unknown;
    voiceTo?: unknown;
    clear?: unknown;
  };
  // The clear command takes precedence: it does not carry text, so it must be ranked before text verification.
  if (d.clear === true) return { kind: 'clear' };
  if (typeof d.text !== 'string' || !d.text) return null;
  return {
    kind: 'say',
    text: d.text,
    image: typeof d.image === 'string' ? d.image : undefined,
    // The picture address given by the third party (complete URL, scheme has been stuck in http/https by the host). It
    // is parallel and mutually exclusive with image. If the consumer has url, use url. Otherwise, spell the emoticon
    // package path - the discrimination bit is in the field name, see the description of SayCue.
    url: typeof d.url === 'string' ? d.url : undefined,
    // Only limited numbers ≥0 are recognized: invalid values are not given (the write end has been verified, this is just for defense, to prevent dirty data from ruining the entire shot)
    duration: typeof d.duration === 'number' && Number.isFinite(d.duration) && d.duration >= 0 ? d.duration : undefined,
    anim: typeof d.anim === 'boolean' ? d.anim : undefined,
    // Only two valid literals are recognized: the wrong end name equals "not specified", and the consumer will not read it accordingly.
    voiceTo: d.voiceTo === 'web' || d.voiceTo === 'desktop' ? d.voiceTo : undefined,
  };
}

/**
 * Type narrowing: working state leaf → snapshot (invalid shape → null, consumer skips this shot). Unlike the balance,
 * there is no "manual" mark: the working status is always driven by the DSH event, and there is no path that the user
 * actively wants.
 */
export function readWorkStatus(leaf: StateLeaf): WorkStatusSnapshot | null {
  return toWorkStatus(leaf.data);
}

/**
 * Orientation: left = asset as is, right = mirrored (renderer pastes scaleX (-1)). There are two copies of the union
 * with the same name as the host side (host is not the import directory). When changing, both sides must be changed
 * together.
 */
export type PetFacing = 'left' | 'right';

/**
 * The type is narrowed: playback request animation leaf → animation name or address + playback receipt (both are empty
 * → null, consumer skips this beat). name: The name in the pet animation pool. The name is the file name. The consumer
 * changes the source and performs menu action processing (mirror correction, mobile class uses real displacement);
 * url: The complete address given by the third party, directly changes the source and broadcasts once, without using
 * menu semantics - the naked address does not have attributes such as "whether it is text type/mobile type". "Whether
 * this animation exists for the pet" is guaranteed by the host before writing, and the playback end does not fallback.
 * playbackId is the receipt number generated when the host accepts the request. The renderer reports the true status
 * at four times during playback; the old host does not write this field → undefined and is treated as "no receipt".
 * facing is the orientation explicitly specified by the caller: undefined = not specified, does not move in the
 * orientation, and maintains the current orientation - not fallback left.
 */
export function readAnim(
  leaf: StateLeaf,
): { name?: string; url?: string; playbackId?: string; facing?: PetFacing } | null {
  if (!leaf.data || typeof leaf.data !== 'object') return null;
  const d = leaf.data as { name?: unknown; url?: unknown; playbackId?: unknown; facing?: unknown };
  const name = typeof d.name === 'string' && d.name ? d.name : undefined;
  const url = typeof d.url === 'string' && d.url ? d.url : undefined;
  // Both are absent = invalid shape (the host write end guarantees exactly one, we will not guess for it here)
  if (name === undefined && url === undefined) return null;
  return {
    name,
    url,
    playbackId: typeof d.playbackId === 'string' && d.playbackId ? d.playbackId : undefined,
    // Orientation: Only two literals are recognized, the rest (including default, old host, dirty value) are all undefined = fixed orientation
    facing: d.facing === 'left' || d.facing === 'right' ? d.facing : undefined,
  };
}

/** The shape of the occupied lock leaf: `{ locked: true, expiresAt }` = being occupied by a third party, `{ locked: false }` = not occupied. */
export type LockState = { locked: true; expiresAt: number } | { locked: false };

/**
 * Type narrowing: occupying lock leaf → LockState (invalid shape → null, consumer skips this beat).
 *
 * This is a state, not an instruction: the host writes and the renderer reads to decide whether to freeze itself - the
 * random chain does not roll dice, the self-playing animation is paused, and the balance and work status performance
 * of automatic sources are ignored. The host cannot stop a video being played, and "complete stillness" is finally
 * executed by the renderer.
 *
 * The host will not push "the lock is gone" once at a certain point: expiresAt is the only truth, and the renderer
 * will release it regularly based on this (the expiration on the host side is lazy). Reading the past expiresAt means
 * there is no lock - you must follow this judgment when you get the stale leaf after refreshing the page, you cannot
 * just look at locked. Does not contain lockId: that is the lock holder's credentials and cannot be put in / state
 * which is readable by everyone.
 */
export function readLock(leaf: StateLeaf): LockState | null {
  if (!leaf.data || typeof leaf.data !== 'object') return null;
  const d = leaf.data as { locked?: unknown; expiresAt?: unknown };
  if (d.locked === false) return { locked: false };
  if (d.locked !== true) return null;
  // locked:true is missing expiresAt (or invalid) = invalid shape: I would rather not freeze than guess an expiration time
  if (typeof d.expiresAt !== 'number' || !Number.isFinite(d.expiresAt)) return null;
  return { locked: true, expiresAt: d.expiresAt };
}

/**
 * The shape of sleeping leaves: `{ sleeping: true, start, loop, end }` = sleeping (the three-segment name is selected
 * by the host), `{ sleeping: false }` = awake.
 */
export type SleepState = { sleeping: true; start: string; loop: string; end: string } | { sleeping: false };

/**
 * Type narrowing: sleeping leaf → SleepState (invalid shape → null, consumer skips this beat).
 *
 * This is state, not instructions: the renderer reads it and decides whether to sleep or not and does not write back.
 * The three names are selected by the host and written into the leaves together. The renderer broadcasts "Start (once)
 * → Loop (infinite) → Get up (once)" - re-selecting by yourself will cause different sets to be broadcast at both
 * ends. `sleeping: true` is missing any paragraph name = invalid shape: It is better not to sleep (maintain the status
 * quo) than to play a non-existent animation.
 */
export function readSleep(leaf: StateLeaf): SleepState | null {
  if (!leaf.data || typeof leaf.data !== 'object') return null;
  const d = leaf.data as { sleeping?: unknown; start?: unknown; loop?: unknown; end?: unknown };
  if (d.sleeping === false) return { sleeping: false };
  if (d.sleeping !== true) return null;
  for (const name of [d.start, d.loop, d.end]) {
    if (typeof name !== 'string' || name === '') return null;
  }
  return { sleeping: true, start: d.start as string, loop: d.loop as string, end: d.end as string };
}

/** Motion mode of position command (choose one from three). The union with the same name as the host side is two copies, and both sides must be modified together when making changes. */
export type PositionMode = 'instant' | 'spring' | 'line';

/**
 * Type narrowing: position instruction leaf → `{ x, y, mode, duration }` (invalid shape → null, consumer skips this
 * beat). This is a command, not a status report: the host writes and the front-end reads to move the pet, and the
 * front-end does not write back. x/y is the normalized coordinate of the pet center (0~1, clamped before host
 * writing); duration is only available in line mode, and the rest are always 0.
 */
export function readPosition(leaf: StateLeaf): { x: number; y: number; mode: PositionMode; duration: number } | null {
  if (!leaf.data || typeof leaf.data !== 'object') return null;
  const d = leaf.data as { x?: unknown; y?: unknown; mode?: unknown; duration?: unknown };
  if (typeof d.x !== 'number' || !Number.isFinite(d.x)) return null;
  if (typeof d.y !== 'number' || !Number.isFinite(d.y)) return null;
  if (d.mode !== 'instant' && d.mode !== 'spring' && d.mode !== 'line') return null;
  if (d.mode === 'line') {
    // line is missing. duration (or invalid) means the shape is invalid: the host will definitely write it. If it is wrong, it would rather skip this beat than guess a time for it.
    if (typeof d.duration !== 'number' || !Number.isFinite(d.duration) || d.duration < 0) return null;
    return { x: d.x, y: d.y, mode: 'line', duration: d.duration };
  }
  return { x: d.x, y: d.y, mode: d.mode, duration: 0 };
}

/**
 * Type narrowing: throwing instruction leaf → `{ angle, power }` (invalid shape → null, consumer skips this beat). The
 * unit of angle is degree (0 = positive right, counterclockwise is positive); power is the force magnification (1.0 =
 * 1200 px/s soft clamp speed front). It's the same instruction, the front end does not write back.
 */
export function readThrow(leaf: StateLeaf): { angle: number; power: number } | null {
  if (!leaf.data || typeof leaf.data !== 'object') return null;
  const d = leaf.data as { angle?: unknown; power?: unknown };
  if (typeof d.angle !== 'number' || !Number.isFinite(d.angle)) return null;
  if (typeof d.power !== 'number' || !Number.isFinite(d.power) || d.power <= 0) return null;
  return { angle: d.angle, power: d.power };
}

/**
 * Action endpoint: POST once, returns whether it is successful. The action does not return data - the data only has
 * one outlet / state. The caller does not need to do anything else after receiving ok: the action writing leaf will
 * make the top-level counter change, and the hanging long polling will return immediately.
 */
export async function postAction(baseUrl: string, body?: unknown): Promise<boolean> {
  try {
    const res = await fetch(baseUrl, {
      method: 'POST',
      ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    });
    if (!res.ok) return false;
    const data = (await res.json().catch(() => null)) as { ok?: unknown } | null;
    return data?.ok === true;
  } catch {
    return false;
  }
}
