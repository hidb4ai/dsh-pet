/**
 * Write back the entire entry (POST /pet-config): Write all instances of a "kind" back to its own configuration file.
 *
 * What is filled is the gap between the two existing write endpoints: PUT /config write-only user main configuration,
 * POST /pet-display only changes the single display. The write semantics are consistent with these two items -
 * whitelist reconstruction + disk original value transparent transmission + post-write broadcast and restart Helper.
 * Do not touch the global fields (only belong to the main layer), nor change the item-level animation pool and
 * persona.
 * @module dsh-pet/src/host/routes/config/entry
 */
import { isValidPetId, readAllConfig, saveUserConfig } from '../../config.ts';
import { mkdir, writeFile } from 'node:fs/promises';
import { type RouteResult } from '../../http.ts';
import type { PetRouteDeps, RouteInput } from '../types.ts';
import { resolveConfigLayer } from './layer.ts';
import { failResult, invalidJson, methodNotAllowed, okResult } from '../result.ts';

/** The main entry together with the global field goes to PUT /config. This endpoint only accepts the "type" layer. */
const MAIN_ENTRY = 'main';

/** Unified copy when the instance array is invalid: saveUserConfig only returns null, the details must be explained clearly here. */
const INVALID_PETS =
  'pets 非法：必须是该种类的全部实例（至少 1 只），每只 id 唯一，size / balanceEnabled / display / position 齐全合法';

/**
 * Find instance id that conflicts with other entries.
 *
 * After merging, id will be globally unique across entries. Duplicate instances will be silently skipped (with only
 * one warning). If not blocked before writing to disk, the user will see "save successfully, pet disappears".
 *
 * @param deps - route layer dependency (route set).
 * @param entry - The entry to be written this time; its own old id does not count as a conflict.
 * @param pets - Array of whitelisted instances.
 * @returns conflict description list; an empty array indicates no conflict.
 */
function conflictingIds(deps: PetRouteDeps, entry: string, pets: readonly Record<string, unknown>[]): string[] {
  const merged = readAllConfig(deps.configPaths);
  const taken = new Map<string, string>();
  for (const [key, conf] of Object.entries(merged)) {
    if (key === entry) continue;
    const list = Array.isArray(conf?.pets) ? (conf.pets as Record<string, unknown>[]) : [];
    for (const pet of list) taken.set(String(pet.id), key);
  }
  const out: string[] = [];
  for (const pet of pets) {
    const id = String(pet.id);
    const owner = taken.get(id);
    if (owner !== undefined) out.push(`${id}（已被「${owner}」占用）`);
  }
  return out;
}

/**
 * Write back all instances of a category layer and return the finished aggregate after writing.
 *
 * Failure is always 200 + failed entity: missing entry / main entry / invalid instance / id conflict / non-existent
 * type are all business conclusions; the method is incorrect and JSON is broken. It occurs before the business, and
 * the real status code is given by the protocol constructor.
 *
 * @param deps - route layer dependencies (path, polling snapshot, restart intention, occupied lock).
 * @param input - Parsed request (method, request body).
 * The finished aggregate after @returns is written (the same as GET /config), or the failed entity.
 */
export async function savePetLayer(deps: PetRouteDeps, input: RouteInput): Promise<RouteResult> {
  if (input.method !== 'POST') return methodNotAllowed();
  let payload: { entry?: unknown; pets?: unknown };
  try {
    payload = JSON.parse(input.body ?? '') as { entry?: unknown; pets?: unknown };
  } catch {
    return invalidJson();
  }
  const entry = typeof payload.entry === 'string' ? payload.entry.trim() : '';
  if (!entry) return failResult('bad-request', 'entry 必填：要写哪个种类（pet/<名>-config.json 的文件名前缀）');
  // Block invalid characters first and then check files: entry will be spelled into path fragments, and the configuration value cannot escape from the pet/ directory.
  if (!isValidPetId(entry)) return failResult('bad-request', `entry 不能当路径片段用：${entry}`);
  if (entry === MAIN_ENTRY) return failResult('bad-request', 'main 条目请用 PUT /config：它还要带全局字段');
  const pets = payload.pets;
  if (!Array.isArray(pets) || pets.length === 0) return failResult('bad-request', INVALID_PETS);
  const resolved = resolveConfigLayer(deps, entry);
  if (!resolved.ok) return failResult('unknown-entry', `没有这个种类：${entry}`);
  const layer = resolved.layer;
  // Entire paragraph replacement semantics: The whitelist reconstructs the entire pets array, and missing one is equivalent to deleting it.
  const clean = saveUserConfig({ pets }, layer.existing);
  if (!clean) return failResult('bad-request', INVALID_PETS);
  const instances = clean.pets as Record<string, unknown>[];
  let conflicts: string[];
  try {
    conflicts = conflictingIds(deps, entry, instances);
  } catch (e) {
    return failResult('generate-error', e instanceof Error ? e.message : String(e));
  }
  if (conflicts.length > 0) return failResult('bad-request', '宠物 id 与其它种类冲突：' + conflicts.join('、'));
  try {
    await mkdir(layer.dir, { recursive: true });
    await writeFile(layer.path, JSON.stringify(clean, null, 2), 'utf8');
  } catch (e) {
    return failResult('generate-error', e instanceof Error ? e.message : String(e));
  }
  // Configuration change signal: only after disk writing is successful, otherwise the browser will pull it again in vain / config if it fails.
  deps.state.writeSection('config', {});
  // Hiding means user takeover: same conventions as POST /pet-display to cancel the occupation to avoid pets being locked to the TTL point (issue #122).
  for (const pet of instances) {
    if (pet.display === 'none') deps.lock.release({ petId: String(pet.id), force: true });
  }
  // No await: The initiator may be the desktop Helper that will be replaced by this reload.
  void deps.requestRestart();
  return okResult(readAllConfig(deps.configPaths));
}
