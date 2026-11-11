/**
 * Configuration field constants and shared types: value fields (corners, display files, font sizes) and configuration
 * path sets.
 *
 * It is not responsible for reading, writing and verification; the verification function takes the enumeration set
 * from here to avoid writing one copy each. It must always be true: the value range corresponds to the union type of
 * shared/types one-to-one, and changing one must synchronize the other.
 * @module dsh-pet/src/host/config/constants
 */
import { FONT_PRESETS } from '../../shared/fonts.ts';
import { PET_DISPLAYS } from '../../shared/config.ts';
import { defaultLog } from '../log-file.ts';

/** Location corner whitelist */
const CORNERS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const;

export const CORNER_SET: ReadonlySet<string> = new Set(CORNERS);

/**
 * display whitelist (export: host route POST /pet-display reuse the same enumeration when writing the display
 * position of a single pet). The only source is PET_DISPLAYS of shared/config. The rules for reading and writing must
 * be the same on both sides. Do not write another Set in the route.
 */
export const PET_DISPLAY_SET: ReadonlySet<string> = new Set(PET_DISPLAYS);

/** font.family whitelist: The only source is FONT_PRESETS from shared/fonts, and the host only takes id for verification. */
export const FONT_FAMILY_SET: ReadonlySet<string> = new Set(FONT_PRESETS.map((preset) => preset.id));

/**
 * id disabled character (Windows file name retention character + control character, to prevent configuration value
 * escape file path). At the same time, the petId check of the thumb route reuse: there is also "the identifier is not
 * suitable for the path fragment".
 */
// eslint-disable-next-line no-control-regex -- Reject ASCII control characters to prevent configuration values from escaping their paths.
export const ID_FORBIDDEN = /[\\/:\x00-\x1f]/;

/** The maximum length of the identifier: id and the asset root will be completed as directory names. If the identifier is too long, it cannot be created directly on some file systems. */
export const MAX_PET_ID_LENGTH = 64;

/**
 * Can identifiers be used as path fragments: non-empty, ≤{@link MAX_PET_ID_LENGTH} character, no delimiter and
 * reserved character.
 *
 * Pet id, emoticon asset root, and thumb's petId share this one - all three are finally spelled into the file path. If
 * you write one separately, "one block will be blocked and the other will be allowed." The valid name contains Chinese
 * characters as usual (use invalid character class instead of ASCII whitelist).
 */
export function isValidPetId(value: string): boolean {
  // '.' and '..' do not disable character , but as a directory name, the asset root will be pushed to the upper level: single listing will block it.
  if (value === '.' || value === '..') return false;
  return value !== '' && value.length <= MAX_PET_ID_LENGTH && !ID_FORBIDDEN.test(value);
}

/**
 * Top-level field whitelist of "Global Default + Type Overridable": These are user-level
 * cost/preference/environment/pacing parameters (chatMemoryRounds, two models, two map switches, dialogue action
 * linkage switch and upper limit of number of pictures, eventsRefreshSec, physics, confineToScreen, font,
 * animationWeights), It's not "what does this category look like", so writing it once at the user level should take
 * effect for all entries; the category file can still be overwritten at its own top level. Persona is the exception:
 * instance-level pets[]. whisperPrompt takes precedence, fallback is done by consumer (./persona of petPersona).
 */
export const GLOBAL_DEFAULT_KEYS = [
  'physics',
  'animationWeights',
  'font',
  'confineToScreen',
  'voiceEnabled',
  'voiceName',
  'voiceVolume',
  'voiceWhisperEnabled',
  'voiceTodoEnabled',
  'voiceNotifyEnabled',
  'whisperImageEnabled',
  'chatImageEnabled',
  'chatAnimationEnabled',
  'chatImageLimit',
  'chatMemoryRounds',
  'chatMemory',
  'whisperModel',
  'chatModel',
  'eventsRefreshSec',
] as const;

/** Files that have been alerted: field (in-process deduplicate: only alert once for the same problem, to avoid refreshing the screen with each request; restart and reset) */
const warnedKeys = new Set<string>();

export function warnOnce(key: string, message: string): void {
  if (warnedKeys.has(key)) return;
  warnedKeys.add(key);
  defaultLog('warn', 'dsh-pet: ' + message);
}

/** Configuration path set (host is passed in after assembly, single source of truth) */
export interface ConfigPaths {
  /** assets/config.jsonc in the package (built-in default, absolutely correct) */
  defaultFile: string;
  /** ~/. dsh/dsh-pet/main-config.jsonc (user main configuration, editable layer; JSONC - comments allowed) */
  userFile: string;
  /** Old path ~/. dsh/dsh-pet/main-config.json: read fallback + migration at startup (see migrateUserConfig) */
  legacyUserFile?: string;
  /** ~/.dsh/dsh-pet/pet (file pet directory) */
  petDir: string;
}
