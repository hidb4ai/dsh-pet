/**
 * Set the writeback plan of the page: Compare the "loading snapshot" and the "current edit list" to calculate which
 * types of layers need to be written back.
 *
 * It is a pure function, does not send requests and does not touch the state; main is not in the plan - it and the
 * global fields are written in the entire package PUT /config every time it is saved.
 * @module dsh-pet/src/client/settings/config/pack-writes
 */
import type { Pet } from '../../../shared/types.ts';
import type { ConfigEntry } from './read.ts';

/** Type layers to be written back at one time. */
export interface PackWrite {
  /** Entry name (= asset root). */
  readonly entry: string;
  /** All instances of this entry; missing one is equivalent to deleting it. */
  readonly pets: readonly Pet[];
}

/** The fingerprint of the submitted shape: only contains fields that will be persisted by the host, and the position is taken from subfield to subfield. */
function fingerprint(pet: Pet): string {
  return JSON.stringify([
    pet.id,
    pet.name,
    pet.size,
    pet.sizePercent ?? '',
    pet.balanceEnabled,
    pet.whisperEnabled,
    pet.workStatusEnabled,
    pet.fixedEnabled,
    pet.display,
    pet.position.corner,
    pet.position.marginX,
    pet.position.marginY,
    pet.whisperPrompt ?? '',
  ]);
}

/**
 * Calculate the type layer to be written back.
 *
 * @param loaded - Snapshot of the entry at load time.
 * @param current - Current edit list (all entries flat, each with `assetRoot` ).
 * @returns If there are changes to the category layer, the order is the order in which the items first appear in the
 * edit list; if there are no changes, it will be an empty array.
 */
export function diffPackWrites(loaded: readonly ConfigEntry[], current: readonly Pet[]): PackWrite[] {
  const groups = new Map<string, Pet[]>();
  for (const pet of current) {
    const entry = pet.assetRoot ?? '';
    // main goes to PUT /config (also with global fields), and instances without assetRoot do not belong to any layer.
    if (entry === '' || entry === 'main') continue;
    const list = groups.get(entry);
    if (list) list.push(pet);
    else groups.set(entry, [pet]);
  }
  const out: PackWrite[] = [];
  for (const [entry, pets] of groups) {
    const before = loaded.find((item) => item.key === entry)?.pets ?? [];
    // The order also participates in the comparison: changing the order is also a change. After writing back, the reading side is rendered in array order.
    const unchanged =
      before.length === pets.length && before.every((pet, i) => fingerprint(pet) === fingerprint(pets[i]));
    if (!unchanged) out.push({ entry, pets });
  }
  return out;
}
