/**
 * The HTTP contract between the settings page and the host: read configuration, read metainformation, read candidate
 * model, write user layer (PUT), synchronization (POST) and write type layer. Each function is a "total function" -
 * failure is not thrown to the caller, but returns the agreed null value or discriminative union, and the caller only
 * takes care of branches and text. Write configuration to force explicit `force` boolean: Strictly spell
 * `=== true` before spelling `?force=1` , never let event objects pretend to be true values to bypass corruption
 * preflight.
 * @module dsh-pet/src/client/settings/config/http
 */
import { ROUTE_PATH } from '../../../shared/constants.ts';
import type { FontConfig, ModelSelection, Pet, PhysicsParams, Weights } from '../../../shared/types.ts';
import type { ModelCatalogGroup } from '../picker/index.ts';
import type { MergedConfig } from './read.ts';
import type { ChatMemoryConfig } from '../../../shared/chat-memory-config.ts';

/** Configuration file path and storage location list; host is deduced according to the platform. If `profile` cannot be deduced, it will be an empty string. */
export interface ConfigMeta {
  user: string;
  default: string;
  animations: string;
  /** User meme directory (no need to change the package when adding pictures). */
  memes?: string;
  /** To-do data file (a user-level data, regardless of pets). */
  todos?: string;
  /** Unified log files; the desktop version does not have a console, so you can only look at it when troubleshooting. */
  logs?: string;
  /** All locations of the plugin persist to disk (path and whether it already exists). */
  storage?: Array<{ key: string; path: string; exists?: boolean }>;
  /** The current profile name (used in the unmount command). */
  profile?: string;
}

/** Save all fields to be submitted; the key name is the field name of host `PUT /config`. */
export interface SaveFields {
  pets: readonly Pet[];
  notificationsEnabled: boolean;
  clickSoundEnabled: boolean;
  whisperImageEnabled: boolean;
  chatImageEnabled: boolean;
  /** Dialogue action linkage switch. */
  chatAnimationEnabled: boolean;
  confineToScreen: boolean;
  trayEnabled: boolean;
  /** Manual broadcast switch: manually triggered whisper and conversation reply. */
  voiceEnabled: boolean;
  /** Voice tone id (one of the four in the white list). */
  voiceName: string;
  /** Playback volume coefficient: 0–1 decimal, 1 = maximum volume, 0 = mute. */
  voiceVolume: number;
  /** Do you want to read the cycle whisper? */
  voiceWhisperEnabled: boolean;
  /** Do you want to read out the to-do reminder? */
  voiceTodoEnabled: boolean;
  /** Do you need to read out the work status report (read a configuration line when the task is completed/error/waiting for confirmation). */
  voiceNotifyEnabled: boolean;
  physics: PhysicsParams;
  whisperModel: ModelSelection;
  chatModel: ModelSelection;
  chatMemoryRounds: number;
  chatMemory?: ChatMemoryConfig;
  chatImageLimit: number;
  font: FontConfig;
  /** Action frequency weight (main entry): The total of the three items is ≤ 100, and random actions are the margin. */
  animationWeights: Weights;
}

/** Save the result: The caller branches according to `kind` and no longer guesses the HTTP details. */
export type SaveOutcome =
  | { kind: 'ok'; merged: MergedConfig }
  | { kind: 'corrupt'; userFile: string | null }
  | { kind: 'invalid' }
  | { kind: 'error' };

/**
 * Compress form status into request body.
 *
 * @param fields - The current value of the form.
 * @returns is directly an object of `JSON.stringify` ; the field name must correspond one-to-one with the host
 * verification key.
 */
export function buildSaveBody(fields: SaveFields): Record<string, unknown> {
  return {
    pets: fields.pets,
    notificationsEnabled: fields.notificationsEnabled,
    clickSoundEnabled: fields.clickSoundEnabled,
    whisperImageEnabled: fields.whisperImageEnabled,
    chatImageEnabled: fields.chatImageEnabled,
    chatAnimationEnabled: fields.chatAnimationEnabled,
    confineToScreen: fields.confineToScreen,
    trayEnabled: fields.trayEnabled,
    voiceEnabled: fields.voiceEnabled,
    voiceName: fields.voiceName,
    voiceVolume: fields.voiceVolume,
    voiceWhisperEnabled: fields.voiceWhisperEnabled,
    voiceTodoEnabled: fields.voiceTodoEnabled,
    voiceNotifyEnabled: fields.voiceNotifyEnabled,
    physics: fields.physics,
    whisperModel: fields.whisperModel,
    chatModel: fields.chatModel,
    chatMemoryRounds: fields.chatMemoryRounds,
    ...(fields.chatMemory === undefined ? {} : { chatMemory: fields.chatMemory }),
    chatImageLimit: fields.chatImageLimit,
    font: fields.font,
    animationWeights: fields.animationWeights,
  };
}

/**
 * Read resolved configuration.
 *
 * @param signal - Interrupt request on unmount or retry.
 * @returns finished aggregate; returns `null` if not 2 xx, network error, or interrupted.
 */
export async function loadConfig(signal?: AbortSignal): Promise<MergedConfig | null> {
  try {
    const response = await fetch(ROUTE_PATH + '/config', signal === undefined ? {} : { signal });
    if (!response.ok) return null;
    const body = (await response.json()) as MergedConfig & { ok?: unknown };
    // Business failure is also 200: ok:false is not a resolved configuration and cannot be processed by reading (otherwise the failure body will be flattened)
    if (body.ok === false) return null;
    return body;
  } catch {
    return null;
  }
}

/**
 * Read the path and storage list of the configuration file.
 *
 * @returns meta information; if it cannot be read, it returns `null` , and the caller hides the "Advanced
 * Configuration" and "Unmount and Storage" cards accordingly.
 */
export async function loadMeta(): Promise<ConfigMeta | null> {
  try {
    const response = await fetch(ROUTE_PATH + '/config/meta');
    if (!response.ok) return null;
    return (await response.json()) as ConfigMeta;
  } catch {
    return null;
  }
}

/**
 * Read the list of candidate models.
 *
 * @returns service provider group; `null` is returned when the response is missing `providers` or the request fails
 * (the selector displays "Pull failed").
 */
export async function loadModelCatalog(): Promise<ModelCatalogGroup[] | null> {
  try {
    const response = await fetch(ROUTE_PATH + '/models');
    if (!response.ok) return null;
    const body = (await response.json()) as { providers?: unknown };
    if (!body || !Array.isArray(body.providers)) return null;
    return body.providers as ModelCatalogGroup[];
  } catch {
    return null;
  }
}

/**
 * Full write of user level configuration.
 *
 * @param body - Output of {@link buildSaveBody} .
 * @param force - Strictly `true` is allowed to rebuild damaged files according to the whitelist (the user has
 * confirmed in the damage pop-up window).
 * @returns saves the result; 409 brings out the real writing path given by the host for pop-up window display.
 */
export async function saveConfig(body: Record<string, unknown>, force: boolean): Promise<SaveOutcome> {
  try {
    const response = await fetch(ROUTE_PATH + '/config' + (force === true ? '?force=1' : ''), {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    // Interface Unification 200 + Entity: Failure. See ok/reason in the entity. The status code only indicates a transport layer failure.
    const payload = (await response.json().catch(() => null)) as {
      ok?: unknown;
      reason?: unknown;
      userFile?: unknown;
    } | null;
    if (payload && payload.ok === false) {
      // Damage pre-check blocked: whitelist reconstruction will discard the remaining content in the file, and the user must decide.
      if (payload.reason === 'user-config-unparsable') {
        return { kind: 'corrupt', userFile: typeof payload.userFile === 'string' ? payload.userFile : null };
      }
      if (payload.reason === 'bad-request' || payload.reason === 'invalid-json') return { kind: 'invalid' };
      return { kind: 'error' };
    }
    if (!response.ok) return { kind: 'error' };
    return { kind: 'ok', merged: payload as MergedConfig };
  } catch {
    return { kind: 'error' };
  }
}

/**
 * Write the entire built-in default configuration to the user layer ("Synchronization" on the settings page).
 *
 * @returns is the resolved configuration after writing; failure returns `null` .
 */
export async function syncConfig(): Promise<MergedConfig | null> {
  try {
    const response = await fetch(ROUTE_PATH + '/config', { method: 'POST' });
    if (!response.ok) return null;
    return (await response.json()) as MergedConfig;
  } catch {
    return null;
  }
}

/** The result of writing a single category layer; there is no "damage requires confirmation" branch - that one only belongs to the user's main configuration. */
export type PetLayerOutcome =
  | { readonly kind: 'ok'; readonly merged: MergedConfig }
  | { readonly kind: 'invalid'; readonly message: string }
  | { readonly kind: 'error' };

/**
 * Write all instances of a category back to its own configuration file.
 *
 * @param entry - entry name (= asset root).
 * @param pets - all instances of this entry; missing one deletes it.
 * @returns is the resolved configuration after writing, or failure classification; `invalid` brings out the
 * in-place copy given by the host (such as id conflict).
 */
export async function savePetLayer(entry: string, pets: readonly Pet[]): Promise<PetLayerOutcome> {
  try {
    const response = await fetch(ROUTE_PATH + '/pet-config', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ entry, pets }),
    });
    const payload = (await response.json().catch(() => null)) as {
      ok?: unknown;
      reason?: unknown;
      message?: unknown;
    } | null;
    if (payload && payload.ok === false) {
      // The parameter type fails to display the host copy in place (for example, id conflicts with other types), and the rest are classified as transmission or disk writing failures.
      if (payload.reason === 'bad-request' || payload.reason === 'unknown-entry') {
        return { kind: 'invalid', message: typeof payload.message === 'string' ? payload.message : '' };
      }
      return { kind: 'error' };
    }
    if (!response.ok) return { kind: 'error' };
    return { kind: 'ok', merged: payload as MergedConfig };
  } catch {
    return { kind: 'error' };
  }
}
