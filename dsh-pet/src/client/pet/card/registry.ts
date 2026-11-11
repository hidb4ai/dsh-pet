/**
 * Global entry point table of floating dialogue: each pet card is registered when mounted and removed when unmounted.
 *
 * The shortcut key is the global one, and the dialogue pop-up window is one for each pet. A table of "who can be
 * attacked now" is needed between the two. When fetching the target, the main entry (main.pets [0] in the
 * configuration) is given priority. If it is not on the web page, it will return to the first registered one. Only the
 * handle is saved and the state machine is not saved: the recording status is still in chat/hear-control.
 * @module dsh-pet/src/client/pet/card/registry
 */
import { petBridge } from '../../settings/bridge.ts';

/** There are seven actions that a card can perform externally: open, close, ask whether it is open or not, start recording, cleanup, ask if it is recording, and take a screenshot. */
export interface PetChatHandle {
  /** Open (or focus) this pet's floating dialogue popup. */
  readonly open: () => void;
  /** Close the pop-up window; it is a no-op when it is not open. */
  readonly close: () => void;
  /** Whether the pop-up window is open at the moment; the shortcut key determines whether it is open or closed this time. */
  readonly isOpen: () => boolean;
  /** Open recording; if there is no pop-up window, open one first. */
  readonly startHear: () => void;
  /** cleanup. */
  readonly stopHear: () => void;
  /** Are you collecting data at this moment? */
  readonly isHearing: () => boolean;
  /** Cut a frame: If the pop-up window is open, it will be inserted into the current pop-up window. If it is not open, it will be opened with the image; if the pop-up window cannot be cut, nothing will be done. */
  readonly screenshot: () => void;
}

/** Register according to pet id; the insertion order of Map is the rendering order, and the fallback of the "first one" depends directly on it. */
const handles = new Map<string, PetChatHandle>();

/**
 * Register a pet's floating dialogue entry point.
 *
 * @param id - pet id (key in configuration).
 * @param handle - Four moves.
 * @returns unregister function; it must be called when the card is unmounted, and it can only be picked up once.
 */
export function registerPetChatHandle(id: string, handle: PetChatHandle): () => void {
  handles.set(id, handle);
  return () => {
    if (handles.get(id) === handle) handles.delete(id);
  };
}

/**
 * Select the one to be operated by the shortcut key: the first one in the main configuration, followed by the first
 * registered one.
 *
 * @returns conversation handle; undefined when there is no pet on the web page.
 */
export function pickPetChatHandle(): PetChatHandle | undefined {
  const mainId = petBridge.template?.id;
  if (typeof mainId === 'string') {
    const main = handles.get(mainId);
    if (main !== undefined) return main;
  }
  return handles.values().next().value;
}

/**
 * Switch recording: cleanup if recording is already in progress, otherwise start recording.
 *
 * The shortcut key only receives keydown (no hand-raising event), so "press and hold" can only be a switch here.
 *
 * @param handle - target pet; undefined does nothing.
 */
export function togglePetChatHear(handle: PetChatHandle | undefined): void {
  if (handle === undefined) return;
  if (handle.isHearing()) handle.stopHear();
  else handle.startHear();
}

/**
 * Switch floating dialogue: turn it off when it is on, turn it on when it is not on.
 *
 * The second press of the same key must be off - the user uses it as a switch, not as a "re-on".
 *
 * @param handle - Target pet; undefined does nothing.
 */
export function togglePetChat(handle: PetChatHandle | undefined): void {
  if (handle === undefined) return;
  if (handle.isOpen()) handle.close();
  else handle.open();
}
