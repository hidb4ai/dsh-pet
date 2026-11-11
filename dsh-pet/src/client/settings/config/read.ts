/**
 * Read the finished configuration: parse the aggregate response of host `GET /config` into "form patch" and "entry
 * instance list". Only recognize fields whose validity is clear in the resolved value: skip fields if they are
 * missing or of the wrong type, so that the form retains the value you have and does not overwrite it with bad data.
 * Separate from the write direction (`http.ts`): here is pure analysis, no requests are sent, and no status is
 * touched.
 * @module dsh-pet/src/client/settings/config/read
 */
import { DEFAULT_FONT } from '../../../shared/fonts.ts';
import { DEFAULT_PHYSICS } from '../../../shared/physics.ts';
import type { FontConfig, ModelSelection, Pet, PhysicsParams, Weights } from '../../../shared/types.ts';
import { parseWeights } from '../../../shared/weights.ts';
import { chatMemoryConfigValid, type ChatMemoryConfig } from '../../../shared/chat-memory-config.ts';

/** The finished aggregate returned by host: `main` are the large configuration entries, and the remaining keys are other pet entries defined by the file. */
export type MergedConfig = Record<string, Record<string, unknown>>;

/** The form needs to be patched; the field default means "there is no trusted value in this response". */
export interface MainConfigPatch {
  /** Pet list of main entry (the location has been deeply copied and can be directly entered into the edit list). */
  pets?: Pet[];
  /** Entry-level persona text, as a preview of instance persona "what to follow when left blank". */
  entryPrompt?: string;
  notificationsEnabled?: boolean;
  clickSoundEnabled?: boolean;
  whisperImageEnabled?: boolean;
  chatImageEnabled?: boolean;
  /** Dialogue action linkage switch; the default means there is no trusted value in this response. */
  chatAnimationEnabled?: boolean;
  confineToScreen?: boolean;
  trayEnabled?: boolean;
  /** Manual broadcast switch: manually triggered whisper and conversation reply; the default means there is no trusted value in this response. */
  voiceEnabled?: boolean;
  /** Voice voice id (the host has been verified according to the whitelist, and the client displays it as it is). */
  voiceName?: string;
  /** Playback volume coefficient (0–1); the default means there is no credible value in this response. */
  voiceVolume?: number;
  /** Periodic whisper voice switch; the default means there is no trusted value in this response. */
  voiceWhisperEnabled?: boolean;
  /** Voice switch for to-do reminder; the default means there is no trusted value in this response. */
  voiceTodoEnabled?: boolean;
  /** Working status broadcast switch; the default indicates that there is no trusted value in this response. */
  voiceNotifyEnabled?: boolean;
  /** Physical parameters: The resolved value has been filled in according to "Built-in Default ← User Layer". If there are missing sub-keys, use the built-in default fallback again. */
  physics?: PhysicsParams;
  /** Font: Same as physical parameters. */
  font?: FontConfig;
  /** Action frequency weight (main entry): The default indicates that there is no credible value in this response. */
  animationWeights?: Weights;
  whisperModel?: ModelSelection;
  chatModel?: ModelSelection;
  chatMemoryRounds?: number;
  chatMemory?: ChatMemoryConfig;
  chatImageLimit?: number;
}

/** Only non-negative finite numbers are valid; the rest (`NaN`, negative numbers, character strings) are treated as not written. */
const nonNegative = (value: unknown): number | undefined => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};

/** A pair of model selections: only if both items are character strings, they will be considered fully written, and if half of the items are write-only, they will be considered not written (the host will reject it as invalid). */
const readModel = (value: unknown): ModelSelection | undefined => {
  const model = value as Partial<ModelSelection> | undefined;
  if (!model || typeof model.provider !== 'string' || typeof model.model !== 'string') return undefined;
  return { provider: model.provider, model: model.model };
};

/**
 * Form patch to read main entries from the finished aggregate.
 *
 * @param merged - Response body of `GET /config` .
 * @returns form patch; `null` is returned when `main.pets` is missing or not an array (the response itself is broken,
 * the caller should report an error).
 */
export function readMainConfig(merged: MergedConfig): MainConfigPatch | null {
  const main = merged.main;
  if (!main || !Array.isArray(main.pets)) return null;
  const pets = main.pets as Pet[];
  const patch: MainConfigPatch = {
    // Position deep copy: The edit list and the resolved value list in the container must be two copies of data.
    pets: pets.map((pet) => ({ ...pet, position: { ...pet.position } })),
  };
  if (typeof main.whisperPrompt === 'string') patch.entryPrompt = main.whisperPrompt;
  if (typeof main.notificationsEnabled === 'boolean') patch.notificationsEnabled = main.notificationsEnabled;
  if (typeof main.clickSoundEnabled === 'boolean') patch.clickSoundEnabled = main.clickSoundEnabled;
  if (typeof main.whisperImageEnabled === 'boolean') patch.whisperImageEnabled = main.whisperImageEnabled;
  if (typeof main.chatImageEnabled === 'boolean') patch.chatImageEnabled = main.chatImageEnabled;
  if (typeof main.chatAnimationEnabled === 'boolean') patch.chatAnimationEnabled = main.chatAnimationEnabled;
  if (typeof main.confineToScreen === 'boolean') patch.confineToScreen = main.confineToScreen;
  if (typeof main.trayEnabled === 'boolean') patch.trayEnabled = main.trayEnabled;
  if (typeof main.voiceEnabled === 'boolean') patch.voiceEnabled = main.voiceEnabled;
  if (typeof main.voiceName === 'string') patch.voiceName = main.voiceName;
  if (typeof main.voiceWhisperEnabled === 'boolean') patch.voiceWhisperEnabled = main.voiceWhisperEnabled;
  if (typeof main.voiceTodoEnabled === 'boolean') patch.voiceTodoEnabled = main.voiceTodoEnabled;
  if (typeof main.voiceNotifyEnabled === 'boolean') patch.voiceNotifyEnabled = main.voiceNotifyEnabled;
  if (main.physics && typeof main.physics === 'object') {
    patch.physics = { ...DEFAULT_PHYSICS, ...(main.physics as PhysicsParams) };
  }
  if (main.font && typeof main.font === 'object') {
    patch.font = { ...DEFAULT_FONT, ...(main.font as FontConfig) };
  }
  const weights = parseWeights(main.animationWeights);
  if (weights) patch.animationWeights = weights;
  const whisperModel = readModel(main.whisperModel);
  if (whisperModel) patch.whisperModel = whisperModel;
  const chatModel = readModel(main.chatModel);
  if (chatModel) patch.chatModel = chatModel;
  const rounds = nonNegative(main.chatMemoryRounds);
  if (rounds !== undefined) patch.chatMemoryRounds = rounds;
  if (chatMemoryConfigValid(main.chatMemory)) patch.chatMemory = { ...main.chatMemory };
  const limit = nonNegative(main.chatImageLimit);
  if (limit !== undefined) patch.chatImageLimit = limit;
  // The upper bound has been checked on the host side. Here is a judgment on cross-process readback: the dirty value only affects the display and does not let it flow to the playback end.
  const volume = nonNegative(main.voiceVolume);
  if (volume !== undefined && volume <= 1) patch.voiceVolume = volume;
  return patch;
}

/** An item (kind) and all its instances; `key` is the asset root. */
export interface ConfigEntry {
  /** Entry name: `main`, or the prefix of `pet/<prefix>-config.json(c)`. */
  readonly key: string;
  /** `main` is written from the settings page together with the global fields; `pack` is written back to its own configuration file alone. */
  readonly kind: 'main' | 'pack';
  /** Entry-level persona text: When the instance persona is left blank, it will be followed (pack each has one copy, main is not shared). */
  readonly entryPrompt?: string;
  /** Instance of this entry; the location has been deep copied, `assetRoot` is the entry name. */
  readonly pets: Pet[];
}

/**
 * Read all entries and their instances from the finished aggregate (`main` first, the rest in file name order).
 *
 * With only instance fields: entry-level animation pools, personas and other large objects are not attached to each
 * pet - the submission of the settings page will be serialized in its entirety, and attaching it is equivalent to
 * copying the animation pool N copies.
 *
 * @param merged - Response body of `GET /config` .
 * @returns entry list; `null` is returned when `main.pets` is missing or not an array (the response itself is broken,
 * the caller should report an error).
 */
export function readConfigEntries(merged: MergedConfig): ConfigEntry[] | null {
  const main = merged.main;
  if (!main || !Array.isArray(main.pets)) return null;
  const out: ConfigEntry[] = [];
  for (const [key, conf] of Object.entries(merged)) {
    const pets = Array.isArray(conf?.pets) ? (conf.pets as Pet[]) : [];
    out.push({
      key,
      kind: key === 'main' ? 'main' : 'pack',
      ...(typeof conf?.whisperPrompt === 'string' ? { entryPrompt: conf.whisperPrompt } : {}),
      pets: pets.map((pet) => ({ ...pet, position: { ...pet.position }, assetRoot: key })),
    });
  }
  return out;
}
