/**
 * Pet list status on the settings page: category label, instance list of the current category, and selected items.
 *
 * Two-level view: the type bar determines "which type to look at", and the pet bar only renders instances of that
 * type. Each instance relies on `assetRoot` to remember which category it belongs to, and decides which file to write
 * back based on this when saving. The initial value of the list comes from the flattened resolved value of the
 * container, which is displayed before loading is completed; deletion requires confirmation, so only "request
 * deletion" is sent.
 * @module dsh-pet/src/client/settings/use-pet-list
 */
import type { Pet } from '../../shared/types.ts';
import type { ConfigEntry, PackWrite } from './config/index.ts';
import { diffPackWrites } from './config/index.ts';
import type { DialogState } from './dialog.ts';
import { petBridge } from './bridge.ts';
import { draftPet, nextPetId } from './pet-draft.ts';
import type { PetPatch } from './pet-card-parts.ts';
import type { SettingsRuntime } from './runtime.ts';

/** An item in the category bar. */
export interface PetKind {
  /** Entry name: `main` or pet /<prefix>- the prefix of config.json. */
  readonly entry: string;
  /** `main` is displayed as "built-in", and the rest display prefixes directly. */
  readonly kind: 'main' | 'pack';
  /** Number of instances of this kind (in parentheses on the label). */
  readonly count: number;
}

/**
 * Summarize the flattened instance list into a category list according to `assetRoot` (the order is the order of first
 * appearance).
 *
 * @param pets - List of instances of the full entry.
 * @returns category list; no instances of `assetRoot` are assigned to main.
 */
export function petKinds(pets: readonly Pet[]): PetKind[] {
  const order: string[] = [];
  const counts = new Map<string, number>();
  for (const pet of pets) {
    const entry = pet.assetRoot ?? 'main';
    if (!counts.has(entry)) order.push(entry);
    counts.set(entry, (counts.get(entry) ?? 0) + 1);
  }
  return order.map((entry) => ({
    entry,
    kind: entry === 'main' ? 'main' : 'pack',
    count: counts.get(entry) ?? 0,
  }));
}

/**
 * Instances belonging only to layer main.
 *
 * `PUT /config` is written as the user's main configuration (`main-config.jsonc`) and can only receive instances of
 * the main layer: bringing other types will copy them into the main layer, and when read back, they will collide with
 * the type's own file id, and the merger will then skip the type instances and fallback the default pet.
 *
 * @param pets - List of instances of the full entry.
 * @returns Instances of the main layer (those without `assetRoot` are also considered main).
 */
export function mainPetsOf(pets: readonly Pet[]): Pet[] {
  return pets.filter((pet) => (pet.assetRoot ?? 'main') === 'main');
}

/** Pet list status and operation. */
export interface PetList {
  /** Editable pet list (full entries, grouped by entries when saving). */
  pets: Pet[];
  /** Instances belonging only to layer main: Submission content of `PUT /config`. */
  mainPets: Pet[];
  /** Data source of category bar. */
  kinds: PetKind[];
  /** The currently selected category (item name). */
  kind: string;
  /** Instance of the current kind (data source of pet tag strip). */
  visiblePets: Pet[];
  /** The currently selected pet is id. */
  selId: string;
  /** The persona text of the entry to which the current pet belongs is used as a preview of the persona instance "what to follow when left blank". */
  entryPrompt: string;
  /** Cut to another pet. */
  select: (id: string) => void;
  /** Switch to another type and select its first one. */
  selectKind: (entry: string) => void;
  /** Change the selected pet field. */
  update: (patch: PetPatch) => void;
  /** Add one to the current type and select it. */
  add: () => void;
  /** Request to delete the current pet (please submit to pop-up window for confirmation). */
  requestRemove: () => void;
  /** Really deleted after confirmation; stopped by caller when there is only one of this type left. */
  remove: () => void;
  /** Replace the entire list of items with the resolved value (after loading/synchronizing), trying to keep the current category and selected items. */
  replace: (entries: readonly ConfigEntry[]) => void;
  /** Compare with the loading snapshot to calculate the type layer to be written back this time (main is not among them). */
  packWrites: () => PackWrite[];
}

/**
 * Manage pet list status.
 *
 * @param rt - Only `useState` , `useCallback` and `useRef` are used.
 * @param requestDialog - Open the confirmation pop-up window (`lastOne` / `lastOfKind` / `remove` ).
 * @returns list status and all operations.
 */
export function usePetList(
  rt: Pick<SettingsRuntime, 'useState' | 'useCallback' | 'useRef'>,
  requestDialog: (dialog: DialogState) => void,
): PetList {
  const { useState, useCallback, useRef } = rt;
  // The initial value is the resolved value that is taken from the container and flattened: display this before loading is completed to avoid the entire page being blank. The entire page is read-only during loading and will not be submitted.
  const initial = petBridge.current;
  const [pets, setPets] = useState<Pet[]>(initial.map((pet) => ({ ...pet, position: { ...pet.position } })));
  const [kind, setKind] = useState<string>(initial[0]?.assetRoot ?? 'main');
  const [selId, setSelId] = useState<string>(initial[0]?.id ?? '');
  // Load snapshot: The writeback plan needs to be compared with it and placed in ref to avoid one more rendering.
  const loadedRef = useRef<readonly ConfigEntry[]>([]);
  // The current type must also be able to read the latest value in the stable callback of replace (the callback cannot rely on the kind state).
  const kindRef = useRef(kind);
  kindRef.current = kind;

  // Update the selected pet: size goes to the top level; position replaces the entire subfield
  const update = (patch: PetPatch): void =>
    setPets((list) =>
      list.map((pet) => {
        if (pet.id !== selId) return pet;
        const { position: posPatch, ...rest } = patch;
        return { ...pet, ...rest, position: posPatch ? { ...pet.position, ...posPatch } : pet.position };
      }),
    );

  const add = (): void => {
    const group = pets.filter((pet) => (pet.assetRoot ?? 'main') === kind);
    const template = group[0];
    if (!template) return;
    const id = nextPetId(pets, kind);
    // The new instance follows the template (size/position/display mode/switch), just change the identity to the new id and attach the type.
    const draft: Pet = { ...draftPet(template, id), assetRoot: kind };
    setPets((list) => {
      const next = [...list];
      // Insert at the end of the category: Pet strips are filtered and rendered by category. Inserting them elsewhere will break up the order.
      let at = -1;
      for (let i = 0; i < next.length; i += 1) if ((next[i].assetRoot ?? 'main') === kind) at = i;
      next.splice(at + 1, 0, draft);
      return next;
    });
    setSelId(id);
  };

  const remove = (): void => {
    const list = pets.filter((pet) => pet.id !== selId);
    setPets(list);
    setSelId(list[0]?.id ?? '');
  };

  // Only setState is cross-rendering stable: putting it in the dependency of applyConfig will not repeatedly pull the configuration.
  const replace = useCallback((entries: readonly ConfigEntry[]): void => {
    loadedRef.current = entries;
    const loaded = entries.flatMap((entry) => entry.pets);
    // Category may be deleted (synchronized back to default): If the current category is no longer available, return to the first one.
    const nextKind = entries.some((entry) => entry.key === kindRef.current)
      ? kindRef.current
      : (entries[0]?.key ?? 'main');
    setPets(loaded);
    setKind(nextKind);
    setSelId((id) => {
      if (loaded.some((pet) => pet.id === id)) return id;
      return loaded.find((pet) => (pet.assetRoot ?? 'main') === nextKind)?.id ?? '';
    });
  }, []);

  const selectKind = (entry: string): void => {
    setKind(entry);
    const first = pets.find((pet) => (pet.assetRoot ?? 'main') === entry);
    if (first) setSelId(first.id);
  };

  const current = pets.find((pet) => pet.id === selId);
  // persona fallback is "follow the belonging entry": main uses the main share, and the file pet uses the share of its respective type, which cannot be strung together.
  const entryPrompt = loadedRef.current.find((item) => item.key === kind)?.entryPrompt ?? '';
  const requestRemove = (): void => {
    if (!current) return;
    const entry = current.assetRoot ?? 'main';
    const groupSize = pets.filter((pet) => (pet.assetRoot ?? 'main') === entry).length;
    // Leave at least one pet of each type: deleting it to 0 will be rejected by the host as invalid, and this type will also be returned to the default pet list.
    if (groupSize <= 1) requestDialog(entry === 'main' ? { kind: 'lastOne' } : { kind: 'lastOfKind', entry });
    else requestDialog({ kind: 'remove' });
  };

  return {
    pets,
    mainPets: mainPetsOf(pets),
    kinds: petKinds(pets),
    kind,
    visiblePets: pets.filter((pet) => (pet.assetRoot ?? 'main') === kind),
    selId,
    entryPrompt,
    select: setSelId,
    selectKind,
    update,
    add,
    requestRemove,
    remove,
    replace,
    packWrites: () => diffPackWrites(loadedRef.current, pets),
  };
}
