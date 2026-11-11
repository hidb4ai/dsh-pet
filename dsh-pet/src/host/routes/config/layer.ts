/**
 * Positioning of the configuration layer: parse the "entry name" into the files, directories and disk original objects
 * to be written by the layer.
 *
 * The two write endpoints (single display, the entire entry instance) share this attribution rule, otherwise "main
 * writes the user layer, the file pet writes its own configuration file" will be written once each, and one change
 * will miss the other. The merged product is not read and the pet field is not verified: whether entry is valid and
 * what reason should be reported if the file cannot be found are all decided by the caller.
 * @module dsh-pet/src/host/routes/config/layer
 */
import { readPetConfigEntry, readUserConfig } from '../../config.ts';
import type { PetRouteDeps } from '../types.ts';

/** The layer to be written: the file path, the directory where it is located, and the original object of the file on the disk (transparent transfer). */
export interface ConfigLayer {
  readonly path: string;
  readonly dir: string;
  readonly existing: Record<string, unknown> | undefined;
}

/** Positioning result: A hit gives the layer; a miss only means "the file does not exist". The specific reason is determined by the caller according to the endpoint semantics. */
export type ConfigLayerLookup = { readonly ok: true; readonly layer: ConfigLayer } | { readonly ok: false };

/**
 * Locate the target layer: `main` → user master configuration, the rest → file pet’s own configuration.
 *
 * @param deps - route layer dependency (path set).
 * @param entry - The name of the entry to which the pet belongs (obtained by host reverse check after merging, caller
 * specification is not accepted).
 * @returns hits give the layer; `ok: false` is given when the entry profile does not exist.
 */
export function resolveConfigLayer(deps: PetRouteDeps, entry: string): ConfigLayerLookup {
  if (entry === 'main') {
    return {
      ok: true,
      layer: { path: deps.userConfigPath, dir: deps.userRoot, existing: readUserConfig(deps.configPaths) },
    };
  }
  const file = readPetConfigEntry(deps.configPaths, entry);
  if (!file) return { ok: false };
  return { ok: true, layer: { path: file.path, dir: deps.petConfigDir, existing: file.raw } };
}
