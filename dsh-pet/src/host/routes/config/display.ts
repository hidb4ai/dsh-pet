/**
 * The display position of a single pet (POST /pet-display): The caller only gives id and display, and the layer
 * ownership is checked by the host.
 *
 * If the client reads-modifies-writes the whole section, it is easy to accidentally damage other pets in the same
 * layer, and it is not sure which layer to write; after the merger, id is globally unique, and findPetInstance has no
 * ambiguity. The write semantics are consistent with PUT /config: whitelist reconstruction + disk original value
 * transparent transmission. Does not parse the entire pets [] and is not responsible for merging configuration reads
 * (relegated to ../../config ).
 * @module dsh-pet/src/host/routes/config/display
 */
import { PET_DISPLAY_SET, findPetInstance, readAllConfig, saveUserConfig } from '../../config.ts';
import { mkdir, writeFile } from 'node:fs/promises';
import { type RouteResult } from '../../http.ts';
import type { PetRouteDeps, RouteInput } from '../types.ts';
import { resolveConfigLayer } from './layer.ts';
import { failResult, invalidJson, methodNotAllowed, okResult } from '../result.ts';

/**
 * Change a pet's display and return the modified aggregate.
 *
 * Failure is always 200 + failed entity: missing id / display invalid / pet does not exist / disk writing failure are
 * all business conclusions; the method is incorrect and JSON is broken. It occurs before the business, and the
 * protocol constructor gives the real status code.
 */
export async function setPetDisplay(deps: PetRouteDeps, input: RouteInput): Promise<RouteResult> {
  if (input.method !== 'POST') return methodNotAllowed();
  let payload: { id?: unknown; display?: unknown };
  try {
    payload = JSON.parse(input.body ?? '') as { id?: unknown; display?: unknown };
  } catch {
    return invalidJson();
  }
  const petId = typeof payload.id === 'string' ? payload.id.trim() : '';
  const nextDisplay = String(payload.display ?? '');
  // id required (same pair of words as 9 `?pet=` routes: not given → pet-required; does not exist → unknown-pet)
  if (!petId) return failResult('pet-required', 'pet 必填：要指定操作哪只桌宠');
  if (!PET_DISPLAY_SET.has(nextDisplay)) {
    return failResult('bad-request', `display 必须是 web / desktop / both / none：${nextDisplay}`);
  }
  let merged: Record<string, Record<string, unknown>>;
  try {
    merged = readAllConfig(deps.configPaths);
  } catch (e) {
    return failResult('generate-error', e instanceof Error ? e.message : String(e));
  }
  // There are two possibilities for missing a hit: id does not exist at all, or the instance is skipped during merging
  // because id is duplicated with other entries (not in the aggregate). Both can only be reported by "There is no such
  // desktop pet" - you can never use id to guess which file it "should" belong to.
  const hit = findPetInstance(merged, petId);
  if (!hit) return failResult('unknown-pet', `没有这只桌宠：${petId}`);
  const resolved = resolveConfigLayer(deps, hit.entry);
  // A single endpoint still reports "entry file not found" as generate-error: id exists in the merge, but the file
  // disappears. This is an installation or IO exception, not a caller parameter problem (the entire entry endpoint
  // will report it as unknown-entry, the two have different semantics).
  if (!resolved.ok) return failResult('generate-error', `宠物条目配置文件找不到：${hit.entry}`);
  const layer = resolved.layer;
  // Entire segment replacement semantics: saveUserConfig rebuilds the entire pets array. All pets in this layer must
  // be brought in, and only the target display is replaced (leaving out the others = deleting them from the
  // configuration).
  const layerPets = Array.isArray(hit.conf.pets) ? (hit.conf.pets as Record<string, unknown>[]) : [];
  const pets = layerPets.map((p) => (String(p.id) === petId ? { ...p, display: nextDisplay } : p));
  const clean = saveUserConfig({ pets }, layer.existing);
  if (!clean) return failResult('bad-request', '宠物配置非法');
  try {
    await mkdir(layer.dir, { recursive: true });
    await writeFile(layer.path, JSON.stringify(clean, null, 2), 'utf8');
  } catch (e) {
    return failResult('generate-error', e instanceof Error ? e.message : String(e));
  }
  // Configuration change signal (only after the disk is written successfully: the version number should not be changed
  // when it fails, otherwise the browser will reload in vain / config). This is the only place where sections.config
  // is written in the whole plugin: the caller that saves/synchronizes the configuration gets the finished aggregate
  // (response body) by itself. The desktop side is restarted by requestRestart() below, and this signal is not
  // needed. When the desktop side right-clicks to change display, the browser page is not the initiator, and it can
  // only be used to find out that "the configuration has been changed elsewhere."
  deps.state.writeSection('config', {});
  // Occupation lock: changed to `none` (right-click on the desktop and "Turn off desktop display") = the user actively
  // hides/closes it, which is a preemption - cancel this round of occupation (cause: preempted). If you don't do this,
  // the pet will be locked to the TTL point, and the user has obviously hidden it (issue #122: "When the user actively
  // stops, hides or closes the pet, it should also be able to cancel the linkage to prevent the pet from being
  // permanently locked"). Only recognize `none` : web/desktop/both changes the display position, not "user takeover".
  if (nextDisplay === 'none') deps.lock.release({ petId, force: true });
  // No await: The initiator is probably the desktop Helper that will be replaced by this reload (same situation as /
  // reload). The disk writing has been completed, and the restart result does not need to be returned to the caller.
  void deps.requestRestart();
  // Response body = modified resolved configuration (same shape as PUT / POST /config): caller (browser
  // right-click menu) Give it directly to petBridge.reload without having to send it again GET /config - it is the
  // same way as saving the settings page. Therefore, you will not get the configuration that may be stale (on-site
  // performance: when aggregate is not returned, the browser must be refreshed to take effect).
  return okResult(readAllConfig(deps.configPaths));
}
