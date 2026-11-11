/**
 * Field verification: one `xValid` for each field, regardless of shape and value range.
 *
 * If the verification fails, only one warning will be recorded and false will be returned. The caller will fall back to
 * the default value. This must always be true: the verification rules are the same as those on the reading side and
 * must not be relaxed when writing back.
 * @module dsh-pet/src/host/config/validate
 */
import { FONT_SIZE_MAX, FONT_SIZE_MIN } from '../../shared/fonts.ts';
import { isKnownVoice } from '../voice/voices.ts';
import { FONT_FAMILY_SET } from './constants.ts';
import { chatMemoryConfigValid } from '../../shared/chat-memory-config.ts';

/** The number of slots for the built-in gameplay animation: `animations.baifan` must be exactly this many (the order is the gameplay contract, see shared/types’s Animations). */
const ACTIVITY_SLOTS = 5;

/** animations segment integrity check (same set of rules as the old assertAnimationsHost; not throw, invalid return false) */
function animationsValid(a: unknown): boolean {
  if (!a || typeof a !== 'object') return false;
  const anims = a as Record<string, unknown>;
  for (const key of ['idle', 'turn', 'drag', 'clicks']) {
    if (!Array.isArray(anims[key])) return false;
  }
  const moves = anims.moves;
  if (
    !moves ||
    typeof moves !== 'object' ||
    typeof (moves as Record<string, unknown>).default !== 'object' ||
    (moves as Record<string, unknown>).default === null ||
    !Array.isArray((moves as Record<string, unknown>).actions)
  ) {
    return false;
  }
  if (!Array.isArray(anims.categories)) return false;
  const ev = anims.events;
  if (!ev || typeof ev !== 'object' || Array.isArray(ev)) return false;
  const evEntries = ev as Record<string, unknown>;
  for (const pool of Object.values(evEntries)) {
    if (!Array.isArray(pool) || pool.length === 0) return false;
    for (const slot of pool) {
      // Gear slot: a single animation name or a candidate array (randomly select 1 in the file, see shared/pickers
      // pickSlot); empty character strings/empty arrays/arrays whose members are empty strings are invalid
      if (typeof slot === 'string') {
        if (slot.length === 0) return false;
      } else if (Array.isArray(slot)) {
        if (slot.length === 0) return false;
        for (const name of slot) {
          if (typeof name !== 'string' || name.length === 0) return false;
        }
      } else {
        return false;
      }
    }
  }
  const balance = evEntries.balance;
  if (!Array.isArray(balance) || balance.length === 0) return false;
  // baifan Optional: Not written = This entry does not have this gameplay. Verify the shape after writing - the wrong
  // number of slots will cause the gameplay to get undefined according to the position, which will appear as "no
  // response when clicking", which is more difficult to explain than not matching.
  if (anims.baifan !== undefined && !activitySlotsValid(anims.baifan)) return false;
  // sleep Optional: pet pack It is valid not to write it (the sleeping assets of different characters are different
  // and cannot be forced). Verify the shape after writing - an empty set or segment will cause the state machine to
  // "enter but no animation will play", which is more difficult to explain than not matching.
  return anims.sleep === undefined || sleepValid(anims.sleep);
}

/**
 * sleep segment check: non-empty set of arrays, each set must have a non-empty start / loop / end character string
 * array. If it is not written, it will be released by the caller (optional field); only the "written" state will be
 * processed here.
 */
function sleepValid(value: unknown): boolean {
  if (!Array.isArray(value) || value.length === 0) return false;
  for (const set of value) {
    if (!set || typeof set !== 'object' || Array.isArray(set)) return false;
    const entry = set as Record<string, unknown>;
    for (const phase of ['start', 'loop', 'end']) {
      const pool = entry[phase];
      if (!Array.isArray(pool) || pool.length === 0) return false;
      for (const name of pool) {
        if (typeof name !== 'string' || name.length === 0) return false;
      }
    }
  }
  return true;
}

/**
 * baifan segment verification: Exactly {@link ACTIVITY_SLOTS} non-empty animation names. It is invalid to write less
 * or more - the slots are retrieved by index, and if one is missing, there is no animation to play at that time.
 */
function activitySlotsValid(value: unknown): boolean {
  if (!Array.isArray(value) || value.length !== ACTIVITY_SLOTS) return false;
  return value.every((name) => typeof name === 'string' && name.length > 0);
}

/** animationWeights segment check (idle/turn/move three non-negative numbers) */
function weightsValid(w: unknown): boolean {
  if (!w || typeof w !== 'object') return false;
  const weights = w as Record<string, unknown>;
  for (const key of ['idle', 'turn', 'move']) {
    const v = Number(weights[key]);
    if (!Number.isFinite(v) || v < 0) return false;
  }
  return true;
}

/**
 * physics segment check: gravity ≥ 0 (0 = no gravity, valid), restitution ∈ [0,1], groundFriction ≥ 0 (both are finite
 * numbers), ceilingBounce / petCollision are Boolean, throwPower > 0 (limited numbers). hapticEnabled / tiltGravity /
 * shakeThrow are optional Boolean (the old configuration does not have these keys).
 */
export function physicsValid(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const p = value as Record<string, unknown>;
  const g = Number(p.gravity);
  const r = Number(p.restitution);
  const f = Number(p.groundFriction);
  const tp = Number(p.throwPower);
  return (
    Number.isFinite(g) &&
    g >= 0 &&
    Number.isFinite(r) &&
    r >= 0 &&
    r <= 1 &&
    Number.isFinite(f) &&
    f >= 0 &&
    typeof p.ceilingBounce === 'boolean' &&
    Number.isFinite(tp) &&
    tp > 0 &&
    typeof p.petCollision === 'boolean' &&
    // Optional: The old configuration (and handwriting configuration) does not have these three keys, and each is
    // processed by default (press on for all three). The missing key does not count as invalid.
    (p.hapticEnabled === undefined || typeof p.hapticEnabled === 'boolean') &&
    (p.tiltGravity === undefined || typeof p.tiltGravity === 'boolean') &&
    (p.shakeThrow === undefined || typeof p.shakeThrow === 'boolean')
  );
}

/**
 * font segment check: family ∈ preset white list, size is a limited number in the interval, followPet is Boolean. Same
 * conventions as physics: whole section verification - if any subkey is missing/invalid, the entire section is invalid
 * (warning + default), there is no "default for missing subkeys one by one"; object fields are replaced in entirety.
 */
export function fontValid(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const f = value as Record<string, unknown>;
  if (typeof f.family !== 'string' || !FONT_FAMILY_SET.has(f.family)) return false;
  const size = Number(f.size);
  if (!Number.isFinite(size) || size < FONT_SIZE_MIN || size > FONT_SIZE_MAX) return false;
  return typeof f.followPet === 'boolean';
}

/**
 * whisperModel / chatModel segment verification: { provider , model } Two character strings, either left blank (=
 * follow the model of the current conversation) or both are non-blank - filling in only half will construct "Use the
 * model name of the A family to ask the B family." This combination is bound to fail and is treated as invalid (warning
 * + Take the default).
 */
export function modelSelectionValid(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const m = value as Record<string, unknown>;
  if (typeof m.provider !== 'string' || typeof m.model !== 'string') return false;
  return (m.provider.trim() === '') === (m.model.trim() === '');
}

/** workStatusTexts segment verification: two-dimensional array - each item in the outer layer is a non-empty character string array (state copy, each state can have multiple random sentences); empty arrays are not available */
function workStatusTextsValid(value: unknown): boolean {
  if (!Array.isArray(value) || value.length === 0) return false;
  for (const group of value) {
    if (!Array.isArray(group) || group.length === 0) return false;
    for (const text of group) {
      if (typeof text !== 'string' || text.length === 0) return false;
    }
  }
  return true;
}

/** Validity of top-level scalar fields (invalid and missing are treated the same: default value + warning) */
export function topFieldValid(key: string, value: unknown): boolean {
  switch (key) {
    case 'chatMemory':
      return chatMemoryConfigValid(value);
    case 'whisperPrompt':
      return typeof value === 'string' && value.length > 0;
    case 'chatMemoryRounds': {
      const n = Number(value);
      return Number.isFinite(n) && n >= 0;
    }
    case 'chatImageLimit': {
      // The upper limit of the number of dialogue pictures: non-negative number (0 = no limit); decimals are rounded according to the consumer Math.floor
      const n = Number(value);
      return Number.isFinite(n) && n >= 0;
    }
    case 'notificationsEnabled':
      return typeof value === 'boolean';
    case 'clickSoundEnabled':
      // Click sound effect switch (global Boolean, read-only main entry): same set of verification as notificationsEnabled
      return typeof value === 'boolean';
    case 'whisperImageEnabled':
      return typeof value === 'boolean';
    case 'voiceEnabled':
      // Voice broadcast switch (global Boolean): only determines whether to read or not, does not affect bubbles and memory
      return typeof value === 'boolean';
    case 'voiceName':
      // The voice must be id in the whitelist; if written incorrectly, it is invalid. The reading side will fallback to the default voice and an warning will be issued.
      return typeof value === 'string' && isKnownVoice(value);
    case 'voiceVolume':
      // Playback volume coefficient: a finite number of 0–1, the same dimension as Audio.volume; out of bounds is invalid (no clamping, read side fallback default)
      return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
    case 'voiceWhisperEnabled':
      // Periodic whisper voice switch (global Boolean): only determines whether to read or not, does not affect bubbles and memory
      return typeof value === 'boolean';
    case 'voiceTodoEnabled':
      // Voice switch for to-do reminder (global Boolean): Same as above
      return typeof value === 'boolean';
    case 'voiceNotifyEnabled':
      // Working status broadcast switch (global Boolean): only determines whether to read the three levels of completion / error / waiting for confirmation, and does not affect the system notification pop-up window
      return typeof value === 'boolean';
    case 'chatImageEnabled':
      return typeof value === 'boolean';
    case 'chatAnimationEnabled':
      return typeof value === 'boolean';
    case 'confineToScreen':
      return typeof value === 'boolean';
    case 'trayEnabled':
      // Desktop mode system system tray switch (main entry top level; helper reads it to decide whether to build a system tray icon)
      return typeof value === 'boolean';
    case 'animations':
      return animationsValid(value);
    case 'animationWeights':
      return weightsValid(value);
    case 'eventsRefreshSec':
      return eventsRefreshSecValid(value);
    case 'physics':
      return physicsValid(value);
    case 'font':
      return fontValid(value);
    case 'whisperModel':
    case 'chatModel':
      return modelSelectionValid(value);
    case 'workStatusTexts':
      return workStatusTextsValid(value);
    case 'sleepRefuseTexts':
    case 'sleepStartTexts':
    case 'sleepEndTexts': {
      // Three sets of lines for sleeping (entry level): non-empty character string array, randomly select a line; empty array/empty string will cause "speaking" to become silent failure
      if (!Array.isArray(value) || value.length === 0) return false;
      return value.every((text) => typeof text === 'string' && text.length > 0);
    }
    default:
      return true;
  }
}

/**
 * eventsRefreshSec segment check: event name → interval seconds (positive finite number). This is the entire
 * replacement field: missing keys are fallbacked by consumers (1800 / 300), and overwritten keys are retained as they
 * are; empty objects are valid.
 */
function eventsRefreshSecValid(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  for (const v of Object.values(value as Record<string, unknown>)) {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return false;
  }
  return true;
}
