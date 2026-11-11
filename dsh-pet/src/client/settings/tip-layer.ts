/**
 * Setting page's hover description bubble: Change the hover of `data-tip` from the CSS pseudo element to the singleton
 * bubble hanging on body.
 *
 * Pseudo elements can only be anchored on the triggering element. The descriptions in the right column and top will be
 * cut off by the edge of the window or the scroll container. Here, `tooltipPlacement` is used to position according to
 * the cursor. If it goes out of bounds, it will be turned over first. If it still goes out of bounds, it will be
 * clipped back to the viewport. No words will be lost in either direction. The trigger element is still the `data-tip`
 * attribute (see ./ui ). This module uses event delegation to take over the unified control and does not hang up the
 * monitoring one by one. The global state has only one listener and one bubble: `attachTipLayer()` is installed and
 * the function it returns is disassembled. Repeated installation returns the same copy.
 * @module dsh-pet/src/client/settings/tip-layer
 */
import { tooltipPlacement } from '../../shared/tooltip.ts';

/** bubble class, appearance in ./css. */
const TIP_CLASS = 'pet-cfg-tip';

/** The attribute name of the trigger element: both the selector and the value are derived from it, and only one change is required when changing the name. */
const TIP_ATTR = 'data-tip';

/** The gap between the cursor and bubble (px). */
const TIP_GAP_PX = 10;

/** Minimum subset of trigger elements: read-only `data-tip`. */
interface TipTrigger {
  getAttribute: (name: string) => string | null;
}

/** The smallest subset used by the event target: find the trigger element from the hit node upwards. */
interface ClosestHost {
  closest: (selector: string) => TipTrigger | null;
}

/** The fields used by this module in the three types of events; the structured type allows testing without having to create PointerEvent. */
interface HoverEvent {
  target: EventTarget | null;
  relatedTarget?: EventTarget | null;
  clientX: number;
  clientY: number;
}

/** The only bubble; hovering is very frequent, and repeated creation and deletion will cause the bubble to flash. */
let bubble: HTMLDivElement | undefined;

/** The trigger element of the current bubble is used to skip the repeated dispatch of "moving within the same element". */
let current: TipTrigger | undefined;

/** The release function of this layer; `undefined` means not installed. */
let detach: (() => void) | undefined;

/** Collapse bubble: keep the element in reuse and only show and hide it. */
function hideTip(): void {
  bubble?.classList.remove('is-on');
  current = undefined;
}

/** Take the bubble element, if not, create one and hang it at body - it will be cut off by the scrolling container if it is hung in the settings page. */
function ensureTip(): HTMLDivElement {
  if (bubble !== undefined && bubble.parentNode === document.body) return bubble;
  const el = document.createElement('div');
  el.setAttribute('class', TIP_CLASS);
  el.setAttribute('role', 'tooltip');
  document.body.appendChild(el);
  bubble = el;
  return el;
}

/** Search the trigger element upwards from the event target; if it is not on the description element, `undefined` is returned. */
function triggerOf(node: EventTarget | null): TipTrigger | undefined {
  const host = node as unknown as ClosestHost | null;
  if (host === null || typeof host.closest !== 'function') return undefined;
  return host.closest('[' + TIP_ATTR + ']') ?? undefined;
}

/**
 * Display description at cursor.
 *
 * @param text - bubble text.
 * @param cursor - Cursor position (viewport coordinates).
 */
function showTip(text: string, cursor: { x: number; y: number }): void {
  const el = ensureTip();
  el.textContent = text;
  // Return to zero first and then measure: the measured position is still the true width and height if the position is not fixed. If not returned to zero, the flanging will be judged according to the previous coordinates.
  el.style.left = '0px';
  el.style.top = '0px';
  const placed = tooltipPlacement(
    cursor,
    { w: el.offsetWidth, h: el.offsetHeight },
    { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight },
    TIP_GAP_PX,
  );
  el.style.left = placed.x + 'px';
  el.style.top = placed.y + 'px';
  el.classList.add('is-on');
}

/** The cursor enters the trigger element: it will be reset if another description is given, and it cannot move within the same element. */
function onOver(event: HoverEvent): void {
  const trigger = triggerOf(event.target);
  if (trigger === undefined || trigger === current) return;
  const text = trigger.getAttribute(TIP_ATTR);
  if (text === null || text === '') return;
  showTip(text, { x: event.clientX, y: event.clientY });
  current = trigger;
}

/** Cursor leaves: pointerout will also be sent when moving into the trigger element's own child node, and it will only be collected when the cursor leaves. */
function onOut(event: HoverEvent): void {
  const from = triggerOf(event.target);
  if (from === undefined) return;
  if (triggerOf(event.relatedTarget ?? null) === from) return;
  hideTip();
}

/**
 * Install the description bubble layer.
 *
 * @returns dismantling function: remove the monitor and remove the bubble, which can be called repeatedly.
 */
export function attachTipLayer(): () => void {
  if (detach !== undefined) return detach;
  // The monitoring target is captured on the spot: the global situation may not be there when dismantling (host page change, test disassembly environment), and you cannot go back and read window
  const root = document;
  root.addEventListener('pointerover', onOver);
  root.addEventListener('pointerout', onOut);
  root.addEventListener('pointerdown', hideTip);
  // The bubble will freeze in place when scrolling: capture can be used to hear the scrolling of the content area of the settings page itself.
  root.addEventListener('scroll', hideTip, true);
  detach = () => {
    root.removeEventListener('pointerover', onOver);
    root.removeEventListener('pointerout', onOut);
    root.removeEventListener('pointerdown', hideTip);
    root.removeEventListener('scroll', hideTip, true);
    bubble?.remove();
    bubble = undefined;
    current = undefined;
    detach = undefined;
  };
  return detach;
}
