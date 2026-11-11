/**
 * Hover shortcut for sleeping: Press `Z` to toggle sleep/wake when the mouse is over the pet.
 *
 * The key rules belong to shared/hotkey, and this module only binds "which key + menu copy". The semantics are
 * switching rather than one-way sleep: pressing while awake = sleep, pressing while sleeping = wake up - exactly the
 * same thing as the right button. Use `Z` instead of `S` : `S` gives way to screenshots, and one bare key cannot do
 * two things.
 * @module dsh-pet/src/shared/sleep-hotkey
 */
import { isBareKey } from './hotkey.ts';
import type { HotkeyEvent } from './hotkey.ts';

/** Display text of shortcut keys (gray text on the right side of menu items). Keeps the same fact as the keys {@link isSleepHotkey}. */
export const SLEEP_HOTKEY_HINT = 'Z 键';

/**
 * Should this button switch to sleep mode?
 *
 * @param e - keyboard event.
 * @returns is true when you press `Z` (including uppercase letters), and false when you type in the input box.
 */
export function isSleepHotkey(e: HotkeyEvent): boolean {
  return isBareKey(e, 'z');
}
