/**
 * Three application-level shortcut keys for floating conversations: turning on and off pop-up windows, turning on and
 * off recording, and taking screenshots.
 *
 * They all work on the "first pet in the main configuration" (see card/registry), regardless of where the mouse is -
 * this is what "global" means. The pop-up window is a switch: pressing the same key again must turn it off, and you
 * can't just put the focus back into the input box. Recording can only be made as a switch: DSH shortcut key only
 * dispatches keydown, there is no hand-raising event, and you cannot press and hold to speak.
 * @module dsh-pet/src/client/pet/card/shortcut
 */
import {
  keycapOf,
  readShortcutKeycap,
  registerAppShortcut,
  type ShortcutBinding,
  type ShortcutHost,
} from '../../app-shortcut.ts';
import { pickPetChatHandle, togglePetChat, togglePetChatHear } from './registry.ts';

/** Command id to open floating dialog pop-up window. */
export const PET_FLOAT_COMMAND_ID = 'pet-chat.float';
/** Command to switch recording on and off id. */
export const PET_HEAR_COMMAND_ID = 'pet-chat.hear';
/** Command id to take a screenshot and insert it into the conversation. */
export const PET_CAPTURE_COMMAND_ID = 'pet-chat.capture';

/** Pop-up window key position: main modifier key + Shift + L. T is occupied by the "recovery tab" in the browser, and L is empty at both ends. */
const FLOAT_BINDING = { code: 'KeyL', modifiers: ['primary', 'shift'] } as const;
/** Recording keys: main modifier keys + Shift + M (M = mic). V will be treated as "paste as plain text" by the browser in the input box and avoided. */
const HEAR_BINDING = { code: 'KeyM', modifiers: ['primary', 'shift'] } as const;
/** Screenshot key: main modifier key + Shift + S. Edge and Firefox gave it to their own screenshots, Chrome left it empty. */
const CAPTURE_BINDING = { code: 'KeyS', modifiers: ['primary', 'shift'] } as const;

/** Three commands to be listed on the settings page. */
export type PetShortcutKey = 'chat' | 'hear' | 'capture';

/** Command id and default key position: register and display are taken from here, do not write the second copy. */
const COMMANDS: Readonly<Record<PetShortcutKey, { readonly id: string; readonly binding: ShortcutBinding }>> = {
  chat: { id: PET_FLOAT_COMMAND_ID, binding: FLOAT_BINDING },
  hear: { id: PET_HEAR_COMMAND_ID, binding: HEAR_BINDING },
  capture: { id: PET_CAPTURE_COMMAND_ID, binding: CAPTURE_BINDING },
};

/**
 * The keycaps displayed on the settings page: can be changed with the user.
 *
 * @param ctx - client context.
 * @param key - Which one to display.
 * @returns keycap text; return to the default combination when it has not been registered or the host does not
 * have shortcut key service.
 */
export function petShortcutKeycap(ctx: ShortcutHost, key: PetShortcutKey): string {
  const command = COMMANDS[key];
  return readShortcutKeycap(ctx, command.id) ?? keycapOf(command.binding);
}

/** The key to get the title; the caller can pass the thin package of `t`. */
export type ShortcutLabel = (key: 'shortcut.capture' | 'shortcut.chat' | 'shortcut.hear') => string;

/**
 * Register two shortcut keys for floating conversations.
 *
 * @param ctx - Client context (only soft fetches are used).
 * @param label - Get the title; lazy evaluation, recalculate after changing the language.
 * @returns logout function: pick the two together.
 */
export function registerPetCardShortcuts(ctx: ShortcutHost, label: ShortcutLabel): { dispose: () => void } {
  const float = registerAppShortcut(ctx, {
    id: COMMANDS.chat.id,
    label: () => label('shortcut.chat'),
    binding: COMMANDS.chat.binding,
    run: () => togglePetChat(pickPetChatHandle()),
  });
  const hear = registerAppShortcut(ctx, {
    id: COMMANDS.hear.id,
    label: () => label('shortcut.hear'),
    binding: COMMANDS.hear.binding,
    run: () => togglePetChatHear(pickPetChatHandle()),
  });
  const capture = registerAppShortcut(ctx, {
    id: COMMANDS.capture.id,
    label: () => label('shortcut.capture'),
    binding: COMMANDS.capture.binding,
    run: () => pickPetChatHandle()?.screenshot(),
  });
  return {
    dispose: () => {
      float.dispose();
      hear.dispose();
      capture.dispose();
    },
  };
}
