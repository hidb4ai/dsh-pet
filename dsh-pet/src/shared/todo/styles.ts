/**
 * The style of the to-do panel: the panel body is a bubble in the bubble slot, and the outer frame follows the
 * bubble's white rounded corners and tail.
 *
 * There are only static character strings and injection states, no DOM is created, no configuration is read; the sizes
 * are all anchored on the bubble font size - f, so the font size of config.font is changed to followPet, and the pet
 * size is changed, and the panel is scaled proportionally. The height budget TODO_PANEL_METRICS has the same origin as
 * the coefficients here: any change must be synchronized, otherwise the top margin of the desktop window will be too
 * small.
 * @module dsh-pet/src/shared/todo/styles
 */
import { BUBBLE_OVERLAP_RATIO, resolveFontPx } from '../fonts.ts';
import type { FontConfig } from '../types.ts';

/** The ratio of the panel root font size to the bubble font size: the default configuration (bubble 21.02 px) is rounded to 13 px. */
export const TODO_FONT_SCALE = 0.618;

/** Panel vertical budget (em, base = panel root font size): header + form + lower half, about 329 px in default configuration. */
export const TODO_PANEL_METRICS = {
  /** Header: top and bottom padding + title line (line height 1.5 × font size 1.077). */
  head: 0.769 + 0.615 + 1.077 * 1.5,
  /** Form: text box + spacing + time line + bottom padding. */
  form: 0.462 * 2 + 1.4 + 0.462 + (0.462 * 2 + 1.4) + 0.769,
  /** List state: top and bottom padding + two lines of entries (each line = padding + text + line spacing + time label). */
  list: 0.462 * 2 + 2 * (0.538 * 2 + 1.5 + 0.154 + 0.846 * 1.5),
  /** Bottom prompt. */
  hint: 0.462 + 0.692 + 0.846 * 1.5,
  /** Calendar status: padding + title row + weekday row + six rows of dates + bottom operation row + space between rows. */
  calendar: 1.077 + 1.077 * 1.5 + 0.846 * 1.5 + 6 * (1.4 + 0.231 * 2) + 5 * 0.154 + (0.923 * 1.5 + 0.462) + 0.308 * 3,
} as const;

/** Panel style: header + add row + scrollable list + bottom tip. */
export const TODO_CSS = [
  // bubble variant: The basic classes of the bubbles at both ends are different (web page . dsh-pet-bubble / desktop .
  // pet-bubble ), so paralleling the two improves specificity and does not rely on the injection order to overwhelm
  // the basic style. Width anchor --f (14.65 × 21.02 ≈ 308 px), max() gives a lower limit of 220 px to prevent the
  // input box and buttons from being squeezed into a row under the small font size, max-width and then clip the whole
  // back to the viewport.
  '.dsh-pet-bubble.dsh-pet-todo-bubble,.pet-bubble.dsh-pet-todo-bubble{padding:0;',
  'width:max(220px,calc(var(--f)*14.65));max-width:calc(100vw - 16px);pointer-events:auto;cursor:default}',
  // Panel body: only responsible for vertical arrangement, the outer frame (background color/rounded
  // corners/shadow/tail) are all given to bubble, and the rounded corners are aligned with inherit. The size is always
  // em, and the benchmark is the industry's --t; I changed the inner margin of the font-size element to use calc (var
  // (--t)* k), otherwise em will be reduced again according to its own font size.
  '.dsh-pet-todo{--t:calc(var(--f)*' + TODO_FONT_SCALE + ');display:flex;flex-direction:column;',
  'box-sizing:border-box;border-radius:inherit;overflow:hidden;color:#2b2b2b;font-size:var(--t);',
  'line-height:1.5;user-select:none;',
  "font-family:var(--dsh-pet-font-family,'ShangshouSoftCandy','Yuanti SC','YouYuan','幼圆','Comic Sans MS','PingFang SC','Microsoft YaHei',sans-serif);",
  '}',
  '.dsh-pet-todo *{box-sizing:border-box}',
  '.dsh-pet-todo-head{display:flex;align-items:center;gap:.615em;padding:.769em .923em .615em}',
  '.dsh-pet-todo-title{flex:1;font-size:1.077em;font-weight:600}',
  '.dsh-pet-todo-count{color:rgba(43,43,43,.55);font-size:.923em}',
  '.dsh-pet-todo-close{border:none;background:transparent;color:rgba(43,43,43,.5);font-family:inherit;',
  'font-size:1em;line-height:1;padding:.308em .385em;border-radius:.462em;cursor:pointer}',
  '.dsh-pet-todo-close:hover{background:rgba(0,0,0,.06);color:rgba(43,43,43,.9)}',
  '.dsh-pet-todo-form{display:flex;flex-direction:column;gap:.462em;padding:0 .923em .769em;',
  'border-bottom:1px solid rgba(0,0,0,.07)}',
  '.dsh-pet-todo-input{width:100%;border:1px solid rgba(0,0,0,.12);border-radius:.615em;',
  'background:rgba(255,255,255,.9);padding:.462em .615em;font-size:1em;line-height:1.4;color:#2b2b2b;',
  'font-family:inherit;outline:none}',
  '.dsh-pet-todo-input:focus{border-color:rgba(64,128,255,.55);box-shadow:0 0 0 .154em rgba(64,128,255,.14)}',
  '.dsh-pet-todo-input::placeholder{color:rgba(43,43,43,.42)}',
  '.dsh-pet-todo-row{display:flex;align-items:center;gap:.462em}',
  // Expiration button: It looks like an input box. If you click it, it will be a self-drawn calendar. When it is not selected, the text is light, and when it is selected, it becomes darker.
  '.dsh-pet-todo-due{flex:1;min-width:0;text-align:left;border:1px solid rgba(0,0,0,.12);border-radius:.615em;',
  'background:rgba(255,255,255,.9);padding:.462em .615em;font-size:1em;line-height:1.4;font-family:inherit;',
  'color:rgba(43,43,43,.55);cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
  '.dsh-pet-todo-due:hover{border-color:rgba(64,128,255,.45)}',
  '.dsh-pet-todo-due.is-set{color:#2b2b2b}',
  '.dsh-pet-todo-due[aria-expanded="true"]{border-color:rgba(64,128,255,.55);',
  'box-shadow:0 0 0 .154em rgba(64,128,255,.14)}',
  '.dsh-pet-todo-add{border:none;border-radius:.615em;background:#4a7dff;color:#fff;font-size:1em;',
  'padding:.462em .923em;cursor:pointer;font-family:inherit;white-space:nowrap}',
  '.dsh-pet-todo-add:hover{background:#3a6ce8}',
  '.dsh-pet-todo-add:disabled,.dsh-pet-todo-input:disabled{opacity:.55;cursor:default}',
  // Embedded calendar: white background with light gray background, the selected day is solid main color, non-month dates are faded, and today is traced in a circle.
  '.dsh-pet-todo-cal{display:flex;flex-direction:column;gap:.308em;',
  'padding:.462em .615em .615em;background:rgba(43,43,43,.025)}',
  '.dsh-pet-todo-cal-head{display:flex;align-items:center;gap:.308em}',
  '.dsh-pet-todo-cal-title{flex:1;text-align:center;font-size:1.077em;font-weight:600}',
  '.dsh-pet-todo-cal-nav{border:none;background:transparent;color:rgba(43,43,43,.55);font-family:inherit;',
  'font-size:1.154em;line-height:1;padding:.154em .385em;border-radius:.462em;cursor:pointer}',
  '.dsh-pet-todo-cal-nav:hover{background:rgba(0,0,0,.07);color:#2b2b2b}',
  '.dsh-pet-todo-cal-week,.dsh-pet-todo-cal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:.154em}',
  // The date row height is fixed, so the calendar height is constant (same origin as TODO_PANEL_METRICS.calendar) and can only be calculated accurately when folded.
  '.dsh-pet-todo-cal-grid{grid-auto-rows:1.862em}',
  // The 24 hours and 12 minutes are arranged in 6 columns. The number of rows is small and the whole is centered.
  '.dsh-pet-todo-cal-grid.is-hour,.dsh-pet-todo-cal-grid.is-minute{grid-template-columns:repeat(6,1fr);',
  'grid-auto-rows:1.6em;align-content:center}',
  '.dsh-pet-todo-cal-week{font-size:.846em;line-height:1.5;color:rgba(43,43,43,.45);text-align:center}',
  '.dsh-pet-todo-cal-cell{border:none;background:transparent;font-family:inherit;font-size:1em;line-height:1.4;',
  'color:#2b2b2b;padding:.231em 0;border-radius:.462em;cursor:pointer;font-variant-numeric:tabular-nums}',
  '.dsh-pet-todo-cal-cell:hover{background:rgba(0,0,0,.06)}',
  '.dsh-pet-todo-cal-cell.is-out{color:rgba(43,43,43,.26)}',
  '.dsh-pet-todo-cal-cell.is-today{box-shadow:inset 0 0 0 1px rgba(74,125,255,.55)}',
  '.dsh-pet-todo-cal-cell.is-sel{background:#4a7dff;color:#fff;font-weight:600}',
  '.dsh-pet-todo-cal-foot{display:flex;align-items:center;gap:.308em}',
  '.dsh-pet-todo-cal-act{border:none;background:transparent;color:#4a7dff;font-family:inherit;font-size:.923em;',
  'line-height:1.5;padding:.231em .385em;border-radius:.462em;cursor:pointer}',
  '.dsh-pet-todo-cal-act:hover{background:rgba(74,125,255,.1)}',
  '.dsh-pet-todo-cal-grow{flex:1}',
  // Hour/minute label: Click to open the corresponding number grid, click again to return to the date.
  '.dsh-pet-todo-cal-chip{border:1px solid rgba(0,0,0,.12);border-radius:.462em;background:rgba(255,255,255,.95);',
  'color:#2b2b2b;font-family:inherit;font-size:.923em;line-height:1.4;padding:.154em .385em;cursor:pointer;',
  'font-variant-numeric:tabular-nums}',
  '.dsh-pet-todo-cal-chip.is-on{border-color:rgba(74,125,255,.55);color:#4a7dff;',
  'box-shadow:0 0 0 .154em rgba(74,125,255,.14)}',
  '.dsh-pet-todo-cal-colon{color:rgba(43,43,43,.45)}',
  // Lower half area: Each of the two pieces of content occupies a folding area. Whoever appears will be expanded. The
  // height of the panel follows the content, leaving no blank space. Folding uses grid-template-rows 0 fr → 1 fr: the
  // content height is auto and can be transitioned, no need to guess max-height.
  '.dsh-pet-todo-lower{display:flex;flex-direction:column}',
  '.dsh-pet-todo-fold{display:grid;grid-template-rows:0fr;visibility:hidden;',
  'transition:grid-template-rows .18s ease,visibility 0s .18s}',
  '.dsh-pet-todo-fold>.dsh-pet-todo-foldClip{overflow:hidden;min-height:0}',
  '.dsh-pet-todo-fold.is-list{grid-template-rows:1fr;visibility:visible;transition-delay:0s}',
  '.dsh-pet-todo.is-picking .dsh-pet-todo-fold.is-cal{grid-template-rows:1fr;visibility:visible;',
  'transition-delay:0s}',
  // Hide the folded side until the transition is complete, otherwise the content will suddenly disappear halfway; visibility blocks the keyboard focus at the same time.
  '.dsh-pet-todo.is-picking .dsh-pet-todo-fold.is-list{grid-template-rows:0fr;visibility:hidden;',
  'transition-delay:0s,.18s}',
  // The height of the list is written in two lines by capListHeight; here it is only guaranteed to scroll if it exceeds the limit, and the scrolling will not bring things outside the bubble.
  '.dsh-pet-todo-list{list-style:none;margin:0;padding:.462em;overflow-y:auto;overscroll-behavior:contain;',
  'flex:0 1 auto;min-height:0;scrollbar-width:thin}',
  '.dsh-pet-todo-item{display:flex;align-items:flex-start;gap:.615em;padding:.538em .462em;border-radius:.615em}',
  '.dsh-pet-todo-item:hover{background:rgba(0,0,0,.045)}',
  '.dsh-pet-todo-check{margin-top:.231em;width:1.154em;height:1.154em;flex:0 0 auto;cursor:pointer;',
  'accent-color:#4a7dff}',
  '.dsh-pet-todo-main{flex:1;min-width:0}',
  '.dsh-pet-todo-text{overflow-wrap:anywhere;white-space:pre-wrap}',
  '.dsh-pet-todo-meta{margin-top:calc(var(--t)*0.154);font-size:.846em;color:rgba(43,43,43,.5)}',
  '.dsh-pet-todo-item[data-urgency="overdue"] .dsh-pet-todo-meta{color:#d94f3d}',
  '.dsh-pet-todo-item[data-urgency="soon"] .dsh-pet-todo-meta{color:#c9761b}',
  '.dsh-pet-todo-item[data-urgency="today"] .dsh-pet-todo-meta{color:#3f6fd8}',
  '.dsh-pet-todo-item.is-done .dsh-pet-todo-text{text-decoration:line-through;color:#2e9e4f}',
  '.dsh-pet-todo-del{border:none;background:transparent;color:rgba(43,43,43,.34);font-size:.923em;line-height:1;',
  'padding:calc(var(--t)*0.308) calc(var(--t)*0.385);border-radius:.462em;cursor:pointer;flex:0 0 auto;',
  'min-width:calc(var(--t)*1.692)}',
  '.dsh-pet-todo-del:hover{background:rgba(0,0,0,.07);color:rgba(43,43,43,.8)}',
  '.dsh-pet-todo-del.is-armed{background:rgba(217,79,61,.12);color:#d94f3d}',
  '.dsh-pet-todo-empty{padding:calc(var(--t)*1.538) calc(var(--t)*0.923);text-align:center;',
  'color:rgba(43,43,43,.44);font-size:.923em}',
  '.dsh-pet-todo-empty[hidden]{display:none}',
  '.dsh-pet-todo-err{flex:0 0 auto;padding:0 calc(var(--t)*0.923) calc(var(--t)*0.615);color:#d94f3d;',
  'font-size:.923em;white-space:pre-wrap;overflow-wrap:anywhere}',
  '.dsh-pet-todo-err[hidden]{display:none}',
  // margin-top:auto Pin prompts to the bottom of the bottom half: when the list only has two lines, the extra space should be left in the middle instead of stacked under the prompts.
  '.dsh-pet-todo-hint{margin-top:auto;padding:calc(var(--t)*0.462) calc(var(--t)*0.923) calc(var(--t)*0.692);',
  'color:rgba(43,43,43,.4);font-size:.846em;text-align:center}',
].join('');

let todoCssInjected = false;

/** Inject the panel style into the document once; repeated mounting will not insert it repeatedly. */
export function injectTodoCss(): void {
  if (todoCssInjected || typeof document === 'undefined') return;
  todoCssInjected = true;
  const tag = document.createElement('style');
  tag.dataset.plugin = 'dsh-pet';
  tag.dataset.pluginCss = 'dsh-pet/todo';
  tag.textContent = TODO_CSS;
  document.head.appendChild(tag);
}

/**
 * The upper margin of the window occupied by the panel (px): The desktop window margin must accommodate the entire
 * panel, otherwise the top of the panel will be cut off by the upper edge of the window. The algorithm is the same as
 * {@link bubbleTopMarginPx} conventions: the bottom edge of the panel also falls at 0.108 × size below the top edge of
 * the pet box. The panel height is constant (the bottom half is fixed), so expanding the calendar or having an error
 * row will not change the window size.
 * @param font - font configuration of this pet, missing default conventions.
 * @param size - The width of this pet px.
 */
export function todoPanelTopMarginPx(font: FontConfig | undefined, size: number): number {
  const m = TODO_PANEL_METRICS;
  // The window margin is calculated according to the higher state: the panel height will change with the state, but the window size cannot change accordingly.
  const panelPx =
    (m.head + m.form + Math.max(m.list + m.hint, m.calendar)) * resolveFontPx(font, size).bubble * TODO_FONT_SCALE;
  const overlap = (Number(size) || 0) * BUBBLE_OVERLAP_RATIO;
  return Math.max(0, Math.ceil(panelPx - overlap));
}
