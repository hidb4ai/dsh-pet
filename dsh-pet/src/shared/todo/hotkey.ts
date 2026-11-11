/**
 * Hover shortcut key for the to-do panel: press `D` to switch the panel when the mouse is parked on the pet. The key
 * rules belong to shared/hotkey, and this module only binds "which key + menu copy".
 * @module dsh-pet/src/shared/todo/hotkey
 */
import { isBareKey } from '../hotkey.ts';
import type { HotkeyEvent } from '../hotkey.ts';

/** Display text of shortcut keys (gray text on the right side of menu items). Keeps the same fact as the keys {@link isTodoHotkey}. */
export const TODO_HOTKEY_HINT = 'D 键';

/**
 * Should this button press open and close the to-do panel?
 *
 * @param e - keyboard event.
 * @returns is true when you press `D` (including uppercase letters), and false when you type in the input box.
 */
export function isTodoHotkey(e: HotkeyEvent): boolean {
  return isBareKey(e, 'd');
}
