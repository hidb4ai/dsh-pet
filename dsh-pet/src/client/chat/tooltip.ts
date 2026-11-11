/**
 * The floating prompt in the panel: replace the native title (delay, font and style are all determined by the browser
 * and cannot be changed).
 *
 * The bubble is hung on body, and position:fixed is positioned according to the cursor: the message list is a
 * scrolling container of overflow:auto, and the pseudo-element bubble hanging in the list will be cropped (you will
 * not see the prompt for messages posted to the top/bottom), so you do not use the data-tip :: after set on the
 * settings page. The position reuse tooltipPlacement of shared/tooltip, the appearance is .pet-chat-tip of
 * ./panel-css.
 * @module dsh-pet/src/client/chat/tooltip
 */
import { tooltipPlacement } from '../../shared/tooltip.ts';
import { px } from './metrics.ts';

/** bubble class (see ./panel-css for appearance). */
export const TIP_CLASS = 'pet-chat-tip';

/** The gap between the cursor and the bubble (px): It is consistent with the data-tip bubble on the settings page and does not fit visually. */
const TIP_GAP_PX = 10;

/** The only bubble; hovering is very frequent in the panel, and repeated creation and deletion will make the bubble flash, so reuse. */
let tipEl: HTMLDivElement | undefined;

/** Release function of global monitoring; registered and recycled together with bubble. */
let unwatch: (() => void) | undefined;

/** Collapse bubble: Keep the reuse element and only pick `is-on`. */
function hideTip(): void {
  tipEl?.classList.remove('is-on');
}

/** Take the bubble element, if it is not available, create one and hang it to body (hanging body will not be cut off by the descendant overflow). */
function ensureTip(): HTMLDivElement {
  if (tipEl !== undefined && tipEl.parentNode === document.body) return tipEl;
  const el = document.createElement('div');
  el.setAttribute('class', TIP_CLASS);
  el.setAttribute('role', 'tooltip');
  document.body.appendChild(el);
  tipEl = el;
  // The monitoring target is captured on the spot: the global situation may no longer be there during recycling (host page change, test disassembly environment), and you cannot go back and read again window
  const win = window;
  const root = document;
  // When scrolling or pressing elsewhere, the bubble will freeze in place and be closed immediately; only capture can hear the scrolling of the message list itself
  const close = (): void => hideTip();
  win.addEventListener('scroll', close, true);
  root.addEventListener('pointerdown', close, true);
  unwatch = () => {
    win.removeEventListener('scroll', close, true);
    root.removeEventListener('pointerdown', close, true);
    unwatch = undefined;
  };
  return el;
}

/**
 * Show bubble at cursor.
 *
 * @param text - bubble text; each time it is reset, the same bubble serves all triggering elements.
 * @param cursor - Cursor position (viewport coordinates).
 */
function showTip(text: string, cursor: { x: number; y: number }): void {
  const el = ensureTip();
  el.textContent = text;
  // Return to zero first and then measure: The elements of opacity:0 have reached the true width and height, but the position is uncertain. If not returned to zero, the flanging will be judged according to the coordinates of the previous place.
  el.style.left = px(0);
  el.style.top = px(0);
  const placed = tooltipPlacement(
    cursor,
    { w: el.offsetWidth, h: el.offsetHeight },
    { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight },
    TIP_GAP_PX,
  );
  el.style.left = px(placed.x);
  el.style.top = px(placed.y);
  el.classList.add('is-on');
}

/**
 * Trigger the hover attribute of the element: a bubble will appear at the cursor when the cursor enters, and it will
 * collapse when it leaves.
 *
 * Not picking up focus: Clicking the button will also give it focus, so after clicking the image/playback request, the
 * bubble will always hang on the screen. The readable name for keyboard users depends on `aria-label` on the element.
 *
 * @param text - bubble text (translated).
 */
export function tipAttrs(text: string): {
  onMouseEnter: (event: { clientX: number; clientY: number }) => void;
  onMouseLeave: () => void;
} {
  return {
    onMouseEnter: (event) => showTip(text, { x: event.clientX, y: event.clientY }),
    onMouseLeave: () => hideTip(),
  };
}

/** Recycle the bubble and global listener when unmounting the panel; the style label is released by ./styles. */
export function disposeTip(): void {
  unwatch?.();
  tipEl?.remove();
  tipEl = undefined;
}
