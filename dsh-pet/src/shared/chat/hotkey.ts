/**
 * Criteria for hovering shortcut keys: When the mouse is parked on a pet, press `L` to open the conversation, press
 * `S` to take a screenshot. The key rules belong to shared/hotkey, and this module only binds "which key + menu copy".
 * @module dsh-pet/src/shared/chat/hotkey
 */
import { isBareKey } from '../hotkey.ts';
import type { HotkeyEvent } from '../hotkey.ts';

export { isTypingTarget } from '../hotkey.ts';
export type { HotkeyEvent } from '../hotkey.ts';

/** Display text of shortcut keys (gray text on the right side of menu items). Keeps the same fact as the keys {@link isChatHotkey}. */
export const CHAT_HOTKEY_HINT = 'L 键';

/** The display copy of the screenshot; there is no menu item, only for the card on the settings page. */
export const CAPTURE_HOTKEY_HINT = 'S 键';

/**
 * Should this button press open a conversation?
 *
 * @param e - keyboard event.
 * @returns is true when you press `L` (including uppercase letters), and false when you type in the input box.
 */
export function isChatHotkey(e: HotkeyEvent): boolean {
  return isBareKey(e, 'l');
}

/**
 * Should I take a screenshot of this button press?
 *
 * @param e - keyboard event.
 * @returns is true when you press `S` (including uppercase letters), and false when you type in the input box.
 */
export function isCaptureHotkey(e: HotkeyEvent): boolean {
  return isBareKey(e, 's');
}
