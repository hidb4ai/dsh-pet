/**
 * Desktop Pet Judgment: Answer "Do you need a desktop window now, do you need a system tray, and what is the window
 * list now" based on the resolved configuration. The three value functions read the configuration each time
 * and do not cache the judgment results - after caching, the downstream gets the snapshot at the moment of
 * destructuring, and the old conclusion will always be used. Failure to read the configuration will be downgraded
 * conservatively: no desktop pets will be processed, and system tray will still be processed. The process is not
 * pulled and the restart sequence is ignored (returned to ./spawn and ./sync).
 * @module dsh-pet/src/host/plugin/desktop/pets
 */
import { flattenPetList, readAllConfig } from '../../config.ts';
import type { ConfigPaths } from '../../config.ts';
import type { DesktopHelperDeps } from './types.ts';

/** Input of DesktopPets. */
export type DesktopPetsInput = Pick<DesktopHelperDeps, 'configPaths' | 'effectivePetList' | 'log'>;

/** Whether this pet participates in desktop mode (Electron transparent window). */
const isDesktopVisible = (display: unknown): boolean => display === 'desktop' || display === 'both';

/** The judgment result of a current read (the element shape of `flattenPetList` is determined by the configuration layer, here we only care about the quantity and display). */
interface DesktopDecision {
  /** All pets in the configuration. */
  pets: Array<Record<string, unknown>>;
  /** Pets participating in desktop mode. */
  desktopPets: Array<Record<string, unknown>>;
}

/** Read the configuration now and calculate the judgment; it will be thrown when it cannot be read, and the degradation method is determined by each value function. */
function readDecision(configPaths: ConfigPaths): DesktopDecision {
  const merged = readAllConfig(configPaths);
  const pets = flattenPetList(merged);
  return { pets, desktopPets: pets.filter((pet) => isDesktopVisible(pet.display)) };
}

/**
 * Create desktop judgment: three value functions + one line of judgment log, none of which holds status.
 *
 * @param deps - Configure path, pet list source and log for desktop window.
 * @returns value function and diagnostic log entry point.
 */
export function createDesktopPets(deps: DesktopPetsInput) {
  const { configPaths, effectivePetList, log } = deps;

  /** Are there any desktop pets now? If the configuration fails, press "None" - it would be better to have helper than an empty process without pets. */
  const getHasDesktopPet = (): boolean => {
    try {
      return readDecision(configPaths).desktopPets.length > 0;
    } catch {
      return false;
    }
  };

  /** The current value of the system tray switch; if the read fails, press "Still want system tray" (conservatively keep the resident icon). */
  const getTrayOn = (): boolean => {
    try {
      return readAllConfig(configPaths).main?.trayEnabled !== false;
    } catch {
      return true;
    }
  };

  /** Pets participating in the desktop window (startup parameters given to helper); read failure returns an empty list. */
  const desktopPetList = (): Array<{ id: string; size: number }> => {
    try {
      return effectivePetList()
        .filter((pet) => isDesktopVisible(pet.display))
        .map((pet) => ({ id: String(pet.id), size: Number(pet.size) }));
    } catch {
      return [];
    }
  };

  /** Enter a line in the judgment log (for diagnosis): When the settings page displays "Desktop Only" but there is no helper process, this line can tell whether the host reads web or desktop. */
  const logDesktopDecision = (): void => {
    try {
      const { pets, desktopPets } = readDecision(configPaths);
      const trayOn = readAllConfig(configPaths).main?.trayEnabled !== false;
      log.info(
        `[dsh-pet] Desktop selection: pets=${pets.length}, visible=${desktopPets.length}` +
          `(${desktopPets.map((pet) => String(pet.id)).join(',') || 'none'}) ->` +
          ` hasDesktopPet=${desktopPets.length > 0} tray=${trayOn}`,
      );
    } catch (e) {
      log.warn(
        `[dsh-pet] Invalid pet configuration; skipping desktop mode: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  };

  // When assembling, type a line first to facilitate comparison of "what will be determined when the process starts this time."
  logDesktopDecision();

  return { getHasDesktopPet, getTrayOn, desktopPetList, logDesktopDecision };
}

/** Output of DesktopPets. */
export type DesktopPets = ReturnType<typeof createDesktopPets>;
