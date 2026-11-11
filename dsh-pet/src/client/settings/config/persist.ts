/**
 * Set the write path of the page: save the entire form package into the user layer, or synchronize the entire built-in
 * default.
 *
 * Saving is a two-layer writing process: first PUT /config (main instance + global field), and then POST /pet-config
 * (changed category layer) one by one. After writing, you must immediately hand the resolved value to the container
 * (`petBridge.reload`) and let the notification engine reread it - both are prerequisites for the implementation of
 * "save and take effect". The results are normalized into a discriminant combination, and the pop-up window and red
 * text are determined by the settings page.
 * @module dsh-pet/src/client/settings/config/persist
 */
import { reloadNotifications } from '../../notify.ts';
import { petBridge } from '../bridge.ts';
import { buildSaveBody, saveConfig, savePetLayer, syncConfig, type SaveFields } from './http.ts';
import type { MergedConfig } from './read.ts';
import type { PackWrite } from './pack-writes.ts';

/** Save the result; `corrupt` brings out the real writing path, `partial` lists the types that were not written successfully. */
export type SaveResult =
  | { kind: 'ok' }
  | { kind: 'invalid' }
  | { kind: 'error' }
  | { kind: 'corrupt'; path: string }
  | { kind: 'partial'; failed: readonly string[] };

/**
 * Save the form.
 *
 * @param fields - All fields to submit (main instances + global fields).
 * @param packWrites - The category layer that has been changed this time; serial writing, main does not write any when
 * it fails.
 * @param force - `true` after the user confirmed it in the damage pop-up window.
 * @param fallbackUserFile - fallback when the host does not write back the path (the user configuration path read in
 * meta).
 * @returns Save the result; container reloading and notification rereading are completed when successful or partially
 * successful.
 */
export async function persistSettings(
  fields: SaveFields,
  packWrites: readonly PackWrite[],
  force: boolean,
  fallbackUserFile: string,
): Promise<SaveResult> {
  const outcome = await saveConfig(buildSaveBody(fields), force);
  if (outcome.kind === 'corrupt') return { kind: 'corrupt', path: outcome.userFile ?? fallbackUserFile };
  if (outcome.kind !== 'ok') return { kind: outcome.kind };
  // main persist to disk and then write the category layer one by one: each item is replaced in its entirety so that the serials will not cover each other (there is also a global queue on the host side).
  let merged = outcome.merged;
  const failed: string[] = [];
  for (const write of packWrites) {
    const result = await savePetLayer(write.entry, write.pets);
    if (result.kind === 'ok') merged = result.merged;
    else failed.push(write.entry);
  }
  petBridge.reload(merged);
  void reloadNotifications(); // It takes effect immediately after saving, no need to refresh.
  return failed.length > 0 ? { kind: 'partial', failed } : { kind: 'ok' };
}

/**
 * Synchronize the entire built-in default configuration to the user layer.
 *
 * @returns is the resolved configuration after writing (the caller also needs to use it to refresh the form);
 * failure returns `null` .
 */
export async function syncSettings(): Promise<MergedConfig | null> {
  const merged = await syncConfig();
  if (merged === null) return null;
  petBridge.reload(merged);
  void reloadNotifications();
  return merged;
}
