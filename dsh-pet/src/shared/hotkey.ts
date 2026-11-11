/**
 * General criterion for hovering shortcut keys: which key press should be intercepted by the pet.
 *
 * Pure function, shared by both ends; each function only declares its own key (see chat/hotkey and todo/hotkey). The
 * desktop only receives keystrokes when the window is focused - transparent click-through windows do not grab focus by
 * default.
 * @module dsh-pet/src/shared/hotkey
 */

/** For these fields, the test can use ordinary objects instead of KeyboardEvent. */
export interface HotkeyEvent {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly target: EventTarget | null;
}

/** The keys in these places belong to typing and cannot be grabbed: input box, text field, drop-down, contenteditable. */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  const tag = el.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  return el.isContentEditable === true;
}

/**
 * Is it a "naked pressing of a certain key"?
 *
 * @param e - Keyboard events (read-only key with modifier keys, target).
 * @param key - The lowercase form of the target key, such as `'t'` .
 * @returns key name matches (case insensitive), without Ctrl/Meta/Alt, and when the focus is not on the editable
 * element, it is true.
 */
export function isBareKey(e: HotkeyEvent, key: string): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  if (String(e.key).toLowerCase() !== key) return false;
  return !isTypingTarget(e.target);
}
