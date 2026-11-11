/**
 * Shortcut key for "Open the desktop pet conversation in the right column".
 *
 * After registering, it automatically appears in Settings → General → Shortcut Keys (can be changed, conflict prompts
 * appear), and the guide card in the sidebar displays the keycaps through `commandId` . The missing service (old host)
 * only generates an warning and does not affect the panel itself.
 * @module dsh-pet/src/client/chat/shortcut
 */
import { keycapOf, readShortcutKeycap, registerAppShortcut, type ShortcutHost } from '../app-shortcut.ts';

/** Command id: Both `commandId` and register of guide card use it. */
export const PET_CHAT_COMMAND_ID = 'pet-chat.open';

/** Primary modifier key + Shift + P; Web whitelist allows "primary key + Shift/Alt + letter", so it is the same key at both ends. */
const BINDING = { code: 'KeyP', modifiers: ['primary', 'shift'] } as const;

/**
 * The keycaps displayed on the settings page: can be changed with the user.
 *
 * @param ctx - client context.
 * @returns keycap text; return to the default combination when it has not been registered or the host does not
 * have shortcut key service.
 */
export function petChatShortcutKeycap(ctx: ShortcutHost): string {
  return readShortcutKeycap(ctx, PET_CHAT_COMMAND_ID) ?? keycapOf(BINDING);
}

/**
 * register "Open desktop pet dialog".
 *
 * @param ctx - Client context (only soft fetches are used).
 * @param label - The title displayed on the settings page; lazy evaluation, recalculated after switching languages.
 * @param open - Action to perform when triggered (open conversation tab).
 * @returns `registered` indicates whether the command is really registered successfully; `dispose` is used for logout
 * (empty function when failed).
 * The caller can no longer hand `commandId` to the sidebar on failure - pointing to a non-existent command will cause
 * the sidebar register to throw an error.
 */
export function registerPetChatShortcut(
  ctx: ShortcutHost,
  label: () => string,
  open: () => void,
): { registered: boolean; dispose: () => void } {
  return registerAppShortcut(ctx, { id: PET_CHAT_COMMAND_ID, label, binding: BINDING, run: open });
}
