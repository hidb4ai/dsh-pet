/**
 * The public exit of the configuration layer: the only entry point for reading, verifying, merging, and writing.
 *
 * Only re-export, no logic; sub-modules are separated according to the reason of change./config/. This must always be
 * true: configuration capabilities are only used outside the module through this file, and paths and merge rules must
 * not be copied by bypass.
 * @module dsh-pet/src/host/config
 */
export { ID_FORBIDDEN, isValidPetId, MAX_PET_ID_LENGTH, PET_DISPLAY_SET } from './config/constants.ts';
export type { ConfigPaths } from './config/constants.ts';
export { readUserConfig, userConfigUnparsable } from './config/jsonc.ts';
export {
  findPetInstance,
  flattenPetList,
  migrateUserConfig,
  readAllConfig,
  readPetConfigEntry,
} from './config/read.ts';
export { removeRoundsByTs, saveUserConfig, sliceMemoryRounds, syncUserConfigFromDefault } from './config/save.ts';
