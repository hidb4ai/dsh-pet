/**
 * Number keys showing location: `1` web page only, `2` desktop only, `3` both, `4` neither.
 *
 * The sequence has the same origin as the right-click "Display Position" submenu (see {@link displayMenuBranch} ), and
 * the menu keycaps also come from here. Each key acts on the pet the mouse is parked on; `3` / `4` will make it
 * disappear from the web page, so these two keys are one-way doors.
 * @module dsh-pet/src/shared/display-hotkey
 */
import { isBareKey } from './hotkey.ts';
import type { HotkeyEvent } from './hotkey.ts';
import type { PetDisplay } from './types.ts';

/** The display position corresponding to the numeric keys starts from 1; changing the order is equivalent to changing the shortcut keys, and the menu must be synchronized. */
export const DISPLAY_ORDER = ['web', 'desktop', 'both', 'none'] as const satisfies readonly PetDisplay[];

/** The keycap copy on the right side of the menu item; the subscript is aligned with {@link DISPLAY_ORDER}. */
export const DISPLAY_HOTKEY_HINTS: readonly string[] = DISPLAY_ORDER.map((_, index) => String(index + 1) + ' 键');

/**
 * Which display position should be switched to by pressing the button this time.
 *
 * @param e - keyboard event.
 * The display position corresponding to @returns `1` - `4` ; when it is not these four bare keys (or typing in the
 * input box) undefined.
 */
export function displayOfHotkey(e: HotkeyEvent): PetDisplay | undefined {
  for (let index = 0; index < DISPLAY_ORDER.length; index += 1) {
    if (isBareKey(e, String(index + 1))) return DISPLAY_ORDER[index];
  }
  return undefined;
}
