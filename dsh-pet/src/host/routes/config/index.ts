/**
 * Configuration reading and meta-information: merged artifacts for GET/config, path list for GET/config/meta, and
 * distribution of four write endpoints.
 *
 * Write separation ./save (user layer PUT /synchronization POST), ./display (single pet display position) and ./entry
 * (whole entry instance): the read path has zero side effect, and the write path needs to rebuild the whitelist,
 * persist to disk and restart Helper. The failure modes and change reasons of the three are different. The
 * configuration shape is not verified (returned to ../../config); the dependency is explicitly passed in by
 * PetRouteDeps, and the global status is not read and the status is not built in the module.
 * @module dsh-pet/src/host/routes/config/index
 */
import { readAllConfig } from '../../config.ts';
import { type RouteResult } from '../../http.ts';
import { join } from 'node:path';
import { PACKAGE_ROOT } from '../../paths.ts';
import { profileNameFrom, storageEntries } from '../../storage-paths.ts';
import { electronLandingDir } from '../../helper-process.ts';
import { TODO_FILE_NAME } from '../../todo/store.ts';
import { homedir } from 'node:os';
import type { PetRouteDeps, RouteInput } from '../types.ts';
import { failResult, okResult } from '../result.ts';
import { saveConfigRoute } from './save.ts';
import { setPetDisplay } from './display.ts';
import { savePetLayer } from './entry.ts';

/** Content configuration field: undefined is returned for misses and response is returned for hits. */
export async function handleConfigRoutes(deps: PetRouteDeps, input: RouteInput): Promise<RouteResult | undefined> {
  // Finished product configuration: GET reads and merges resolved values, and the remaining methods are given to the write path (PUT save/POST sync default/other 405)
  if (input.rest === 'config') {
    return input.method === 'GET' ? getConfig(deps) : saveConfigRoute(deps, input);
  }
  // The display position of a single pet (right-click on the desktop and "Turn off desktop display" → POST /pet-display)
  if (input.rest === 'pet-display') return setPetDisplay(deps, input);
  // Instance writeback of the entire category layer (setting the configuration of the page change file pet → POST /pet-config)
  if (input.rest === 'pet-config') return savePetLayer(deps, input);
  // Configuration file path + storage location list (for display in the "Advanced Configuration" and "Unmount and Storage" settings pages)
  if (input.rest === 'config/meta') return getMeta(deps);
  return undefined;
}

/** Merged resolved value: unique configuration entry point, browser/desktop/settings page direct consumption without any verification or fallback. */
function getConfig(deps: PetRouteDeps): RouteResult {
  try {
    // Dynamic configuration must kill the cache (same conventions as / state): The consumer will "find the
    // configuration version change → re-pull / config". This time GET will get back the old configuration if it hits
    // the cache, and that mechanism will directly fail.
    return okResult(readAllConfig(deps.configPaths), { 'cache-control': 'no-cache, no-store' });
  } catch (e) {
    return failResult('generate-error', e instanceof Error ? e.message : String(e));
  }
}

/** Path and storage list: read-only environment and path, no business judgment is made, so there is no failure entity. */
function getMeta(deps: PetRouteDeps): RouteResult {
  const { log, memesUserRoot, thumbUserRoot, userConfigPath, userRoot } = deps;
  return okResult({
    user: userConfigPath,
    default: join(PACKAGE_ROOT, 'assets', 'config.jsonc'),
    animations: thumbUserRoot,
    memes: memesUserRoot,
    // To-do data file: a piece of user-level data (regardless of pets), the path is the same file name constant as the host used when building the database.
    todos: join(userRoot, TODO_FILE_NAME),
    // Unified log export (the file of logger above: all three modes fall into $DSH_HOME/dsh-pet/logs.txt): The desktop
    // version does not have a console, and users can only rely on this file when they report "pets do not
    // appear/crash".
    logs: log.file,
    // All persist to disk locations (user data of this package/Electron runtime/desktop cache/download cache/plugin
    // body): The first two paths directly transmit the real writer's path, do not re-spell the directory name here.
    storage: storageEntries({
      userDataRoot: userRoot,
      electronDir: electronLandingDir(),
      home: homedir(),
      packageRoot: PACKAGE_ROOT,
    }),
    // profile name (spelled by unmount command dsh plugin --profile <name> remove dsh-pet-powercontext; it is an empty string if it cannot be deduced)
    profile: profileNameFrom(PACKAGE_ROOT) ?? '',
  });
}
