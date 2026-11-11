/**
 * Style sheets and one-time injection for dialog panels.
 *
 * Only put the style and inject entry point: color, font size, rounded corners are all set to `--dsw-*` token, no
 * literal value is written - the light/dark theme is switched by the variable of DSH, there is no second set of color
 * matching here. The inline style cannot write `:hover` / `:focus` , so the panel uniformly uses this CSS.
 * @module dsh-pet/src/client/chat/styles
 */
import { PANEL_CSS } from './panel-css.ts';

/** Attribution tag of style tag; the same key is only injected once. */
const STYLE_KEY = 'dsh-pet-chat-panel';

/** Current number of mounts: Multiple pane may mount panels at the same time, relying on reference counting to determine when to remove style tags. */
let mountedCount = 0;

/** Injected style element (created on first mount). */
let styleTag: HTMLStyleElement | undefined;

/**
 * Inject panel styles (idempotent, release by reference count).
 *
 * @returns release function: The style label is removed only after the last release; it is safe to call repeatedly.
 */
export function injectPanelCss(): () => void {
  if (typeof document === 'undefined') return () => {};
  mountedCount += 1;
  if (styleTag === undefined) {
    const tag = document.createElement('style');
    tag.dataset.dshPetCss = STYLE_KEY;
    tag.textContent = PANEL_CSS;
    document.head.appendChild(tag);
    styleTag = tag;
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    mountedCount -= 1;
    if (mountedCount === 0 && styleTag !== undefined) {
      styleTag.remove();
      styleTag = undefined;
    }
  };
}
