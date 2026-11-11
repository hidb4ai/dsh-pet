/**
 * Inline styling and injection of pet pages: only pseudo-classes, transitions, pointer gestures and cursors cannot be
 * expressed inline style. The styles of the menu and floating prompts are the same as those on the desktop
 * (`shared/menu`, `shared/tooltip` ), so I won’t copy the second copy here. Injection code `data-plugin-css`
 * deduplicate: Repeated mounting of the same page will not create a second copy of the style.
 * @module dsh-pet/src/client/pet/css
 */
import { ROUTE_PATH } from '../../shared/constants.ts';
import { MENU_CSS } from '../../shared/menu.ts';
import { TOOLTIP_CSS } from '../../shared/tooltip.ts';

/** Pet page style sheet. */
const PET_CSS = [
  '.dsh-pet-root{position:fixed;z-index:40;pointer-events:none;user-select:none}',
  '.dsh-pet-root[data-corner="bottom-right"]{right:var(--dsh-pet-mx,24px);bottom:var(--dsh-pet-my,0)}',
  '.dsh-pet-root[data-corner="bottom-left"]{left:var(--dsh-pet-mx,24px);bottom:var(--dsh-pet-my,0)}',
  '.dsh-pet-root[data-corner="top-right"]{right:var(--dsh-pet-mx,24px);top:var(--dsh-pet-my,0)}',
  '.dsh-pet-root[data-corner="top-left"]{left:var(--dsh-pet-mx,24px);top:var(--dsh-pet-my,0)}',
  '.dsh-pet-stage{position:relative;width:var(--dsh-pet-size,462px);height:calc(var(--dsh-pet-size,462px)*9/16);pointer-events:none}',
  // The same correction as the desktop helper. For the filter definition, see ensureAlphaFilter.
  '.dsh-pet-video{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;pointer-events:none;opacity:0;transition:opacity .18s ease;transform-origin:center;filter:url(#dsh-pet-alpha-fix)}',
  '.dsh-pet-video.is-front{opacity:1}',
  // Touch screen dragging is required: when touch-action:none is missing, the browser will judge the gesture as
  // scrolling and trigger pointercancel; two - webkit -* suppress long press selection and iOS long press system menu.
  `.dsh-pet-hit{position:absolute;pointer-events:auto;cursor:url("${ROUTE_PATH}/pic/cursor-grab.png") 16 16, grab;z-index:1;touch-action:none;-webkit-user-select:none;-webkit-touch-callout:none}`,
  `.dsh-pet-hit.dragging{cursor:url("${ROUTE_PATH}/pic/cursor-grabbing.png") 16 16, grabbing}`,
  '@media (prefers-reduced-motion: reduce){.dsh-pet-video{transition:none}}',
  // Unify the right-click menu style and inject the same one as the desktop.
  MENU_CSS,
  // The floating prompt style is the same as the desktop injection.
  TOOLTIP_CSS,
].join('\n');

/** The mark value used for injecting deduplicate is written on `data-plugin-css` of `<style>`. */
const cssTag = 'dsh-pet/style.css';

/** alpha correction filter's id, CSS are shared with the injected SVG. */
const ALPHA_FIX_ID = 'dsh-pet-alpha-fix';

/**
 * Inject alpha correction filter: The asset "transparent" background is always measured as alpha 1/255, deduct one
 * state and return to zero, and the pet body only drops one state (≤1/255, invisible); the same page is only injected
 * once.
 */
function ensureAlphaFilter(): void {
  if (document.querySelector('svg[data-dsh-pet-alpha-fix]') !== null) return;
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('data-dsh-pet-alpha-fix', '');
  // The filter definition must remain in the document (filter:url (#...) is parsed according to the same document id); absolute positioning prevents it from participating in the host's inline flow.
  svg.style.position = 'absolute';
  const defs = document.createElementNS(NS, 'defs');
  const filter = document.createElementNS(NS, 'filter');
  filter.id = ALPHA_FIX_ID;
  const transfer = document.createElementNS(NS, 'feComponentTransfer');
  const func = document.createElementNS(NS, 'feFuncA');
  func.setAttribute('type', 'linear');
  func.setAttribute('slope', '1');
  func.setAttribute('intercept', '-0.0039215686');
  transfer.appendChild(func);
  filter.appendChild(transfer);
  defs.appendChild(filter);
  svg.appendChild(defs);
  document.body.appendChild(svg);
}

/** Inject pet page style, only once per page; return silently when there is no document. */
export function injectPetCss(): void {
  if (typeof document === 'undefined') return;
  if (document.querySelector('style[data-plugin-css="' + cssTag + '"]') !== null) return;
  const tag = document.createElement('style');
  tag.dataset.plugin = 'dsh-pet';
  tag.dataset.pluginCss = cssTag;
  tag.textContent = PET_CSS;
  document.head.appendChild(tag);
  ensureAlphaFilter();
}
