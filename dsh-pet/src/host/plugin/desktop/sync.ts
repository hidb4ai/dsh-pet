/**
 * Desktop side restart: Only one "stop old → start new" is allowed at the same time, and continuous requests are
 * queued instead of staggered.
 *
 * The two forms follow the same entry point: dual process (plugin/standalone mode) restarts the child process;
 * single process (packaged application) has no child process to restart, and instead allows the embedded helper to
 * rebuild the window according to the new configuration. Do not stop the process by yourself (return to ./spawn), do
 * not recalculate the configuration (return to ./pets). Depends on a process-level fact passed explicitly (see Input
 * Types), read-only within the module: DSH_PET_IN_PROCESS .
 * @module dsh-pet/src/host/plugin/desktop/sync
 */
import type { DesktopHelperDeps } from './types.ts';
import type { DesktopPets } from './pets.ts';
import type { DesktopSpawn } from './spawn.ts';

/** Input of DesktopSync. */
export type DesktopSyncInput = Pick<DesktopHelperDeps, 'log'> &
  Pick<DesktopPets, 'logDesktopDecision' | 'desktopPetList'> &
  Pick<DesktopSpawn, 'startHelper' | 'stopHelperAndWait'>;

/** Rebuild hook by embedded helper register in application mode; does not exist in dual-process mode. */
type RebuildHook = (() => Promise<void>) | undefined;

/**
 * Create DesktopSync.
 */
export function createDesktopSync(deps: DesktopSyncInput) {
  const { log, logDesktopDecision, desktopPetList, startHelper, stopHelperAndWait } = deps;

  /** Running helper in the same process (packaged application): There is no child process to restart, and helper can only rebuild the window by itself. */
  const inProcessHost = process.env.DSH_PET_IN_PROCESS === '1';

  let desktopSyncQueue: Promise<void> = Promise.resolve();

  const restartDesktop = (): Promise<void> => {
    desktopSyncQueue = desktopSyncQueue
      .then(async () => {
        // It is determined that it is currently being read (pets does not hold the status). Only one line of diagnostic log is added here.
        logDesktopDecision();
        if (inProcessHost) {
          // First feed the new list to the rendering side, then let it close the window and rebuild: only the window
          // is moved, the main process is not moved, and the location and running status are retained (restarting the
          // entire application will clear them together).
          process.env.DSH_PET_PETS = JSON.stringify(desktopPetList());
          await (globalThis as { __dshPetRebuildUi?: RebuildHook }).__dshPetRebuildUi?.();
          return;
        }
        await stopHelperAndWait('desktop-config-change');
        startHelper();
      })
      .catch((e: unknown) => {
        log.warn(`[dsh-pet] Desktop helper restart failed: ${e instanceof Error ? e.message : String(e)}`);
      });
    return desktopSyncQueue;
  };

  return { requestRestart: restartDesktop };
}

/** Output of DesktopSync. */
export type DesktopSync = ReturnType<typeof createDesktopSync>;
