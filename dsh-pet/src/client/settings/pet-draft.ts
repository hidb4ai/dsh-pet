/**
 * Draft structure of "Add Pet": assignment of new id and which fields to copy from template. Only copy instance fields
 * outside the entry level - entry-level fields (global values outside persona) are configured by the resolved value
 * fallback, so I will not copy them here.
 * @module dsh-pet/src/client/settings/pet-draft
 */
import type { Pet } from '../../shared/types.ts';
import { SIZE_PERCENT_DEFAULT } from '../../shared/pet-size.ts';

/**
 * Generate an unoccupied pet id.
 *
 * Prefixes are distinguished by type: main follows `pet-N` (existing behavior), file pets use `<pet-type>-N` , and the
 * number increases within the type. Duplicate checking always scans the entire list - after merging, id is globally
 * unique across entries, and each number will inevitably collide. Starting from 2: `-1` is usually occupied by the
 * first one of this type (`daily1` and this kind of manual id do not occupy the number).
 *
 * @param list - Full entry instance list, read-only.
 * @param kind - entry name (`main` or pet /<prefix>- the prefix of config.json); the default is main.
 * @returns is an idle id in the shape of `pet-2` / `daily-2` .
 */
export function nextPetId(list: readonly Pet[], kind = 'main'): string {
  const prefix = kind === 'main' ? 'pet' : kind;
  for (let n = 2; ; n += 1) {
    const id = prefix + '-' + n;
    if (!list.some((pet) => pet.id === id)) return id;
  }
}

/**
 * A draft to create a new pet based on the template. The name is fixed to use the new id: the template name is the
 * identity of another pet. If it is inherited, two pets will have the same name. The empty name is also treated as id
 * on the host side.
 *
 * @param template - Template pets (the first of the main entries).
 * @param id - id for new pets, usually from {@link nextPetId} .
 * @returns can directly enter the pet object in the edit list; the position is copied deeply, and the template will
 * not be moved when changing the pet.
 */
export function draftPet(template: Pet, id: string): Pet {
  return {
    id,
    name: id,
    size: template.size,
    sizePercent: template.sizePercent ?? SIZE_PERCENT_DEFAULT,
    balanceEnabled: template.balanceEnabled,
    whisperEnabled: template.whisperEnabled,
    workStatusEnabled: template.workStatusEnabled,
    fixedEnabled: template.fixedEnabled,
    display: template.display,
    position: { ...template.position },
  } as Pet;
}
