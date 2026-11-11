/**
 * The bridge shared by the container (pet page) and the settings page: a singleton in the same bundle, exchanging the
 * current pet list and overloading the entry point. `current` is the latest resolved value flat list, which is only
 * written by the container; `reload` is registered by the container, and the default is an empty function. The setting
 * page can be saved before the container is assembled. `template` is the first pet of the main entry, and is used as
 * the initial value of the new instance for "Add Pet".
 * @module dsh-pet/src/client/settings/bridge
 */
import type { Pet } from '../../shared/types.ts';

/** The only instance of the bridge; the fields are mutable and the writers are fixed respectively (container writes current / reload, settings page read-only). */
export const petBridge: {
  current: Pet[];
  reload: (merged?: Record<string, Record<string, unknown>>) => void;
  template: Pet | undefined;
} = {
  current: [],
  reload: () => {},
  template: undefined,
};
