/**
 * The combined root of desktop Helper: the pet list, process pull-up, and restart serialization are combined into
 * external capabilities.
 *
 * Only assembly, no logic; for the division of labor among the three blocks, please see the respective module headers
 * under ./desktop/. Must always hold: requestRestart is the only restart entry point, is internally serial and does
 * not overlap.
 * @module dsh-pet/src/host/plugin/desktop-helper
 */
import { createDesktopPets } from './desktop/pets.ts';
import { createDesktopSpawn } from './desktop/spawn.ts';
import { createDesktopSync } from './desktop/sync.ts';
import type { DesktopHelperDeps } from './desktop/types.ts';

export type { DesktopHelperDeps };

/**
 * Full ability to create desktop Helper.
 * @param deps - The action function required by the assembly phase object and the desktop side.
 * @returns starts, stops, requests restart and asset root resolution.
 */
export function createDesktopHelper(deps: DesktopHelperDeps) {
  const pets = createDesktopPets(deps);
  const spawn = createDesktopSpawn({ ...deps, ...pets });
  const sync = createDesktopSync({ ...deps, ...pets, ...spawn });
  return {
    startHelper: spawn.startHelper,
    stopHelper: spawn.stopHelper,
    requestRestart: sync.requestRestart,
    assetRootFor: spawn.assetRootFor,
    userRootFor: spawn.userRootFor,
    markDisposed: spawn.markDisposed,
  };
}

/** Desktop Helper lifecycle output (for downstream factories to demand Pick). */
export type DesktopHelper = ReturnType<typeof createDesktopHelper>;
