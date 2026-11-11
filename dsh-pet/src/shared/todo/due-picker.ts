/**
 * To-do due date picker: a button showing the current value + embedded calendar.
 *
 * The calendar area switches between three grids of "date/hour/minute". The height is calculated according to the
 * content and does not need to be reserved. Inline instead of floating layer: The desktop pet window is only one
 * circle larger than the pet, and the floating layer will be cut off by the edge of the window; the panel is long
 * upward and consistent at both ends. The visibility is controlled by the folding container of the panel (hidden is
 * not set here, display:none will invalidate the folding transition). This module only reports aria-expanded and
 * onOpenChange; the value is written as `YYYY-MM-DDTHH:mm` to remind the link not to sense this.
 * @module dsh-pet/src/shared/todo/due-picker
 */
import { monthCells } from './calendar.ts';
import { dueLabel, formatDateTimeLocal } from './format.ts';

/** Monday is the first day of the week, which is consistent with domestic calendar customs. */
const WEEK_HEAD = ['一', '二', '三', '四', '五', '六', '日'] as const;

/** Minute state: It is consistent with the shortest interval of the reminder to avoid selecting a time that cannot be distinguished by the reminder strategy. */
const MINUTE_STEP = 5;

/** The default time when no date is selected: nine o'clock in the morning, which is more like "it's time to do something" than zero o'clock. */
const DEFAULT_HOUR = 9;

/** Three grids for the calendar area. */
type PickerMode = 'day' | 'hour' | 'minute';

/** Selector handle. */
export interface DuePicker {
  /** Trigger button in form row. */
  readonly el: HTMLButtonElement;
  /** Calendar container; inserted into the root node from the panel, closed by default. */
  readonly calendar: HTMLElement;
  /** Current value, `YYYY-MM-DDTHH:mm`; not selected as `''`. */
  value(): string;
  /** Collapse the calendar, the selected value remains unchanged. */
  close(): void;
  /** Return to "Indefinite" and put it away. */
  reset(): void;
  /** Remove document monitoring. */
  dispose(): void;
}

/** Selector creation parameters. */
export interface DuePickerOptions {
  /** callback when expanded or collapsed, the panel will collapse the list accordingly to free up height. */
  onOpenChange?: (open: boolean) => void;
}

/** Mutable state of selectors; rendering functions read-only it, event handlers write-only it. */
interface PickerState {
  /** The selected date (hours and minutes are in the lower two fields), null = no expiration date. */
  picked: Date | null;
  hour: number;
  minute: number;
  /** The currently displayed month (1st of the month). */
  view: Date;
  /** Current grid. */
  mode: PickerMode;
  open: boolean;
}

/** Selector holds reference to DOM. */
interface PickerDom {
  el: HTMLButtonElement;
  calendar: HTMLDivElement;
  prev: HTMLButtonElement;
  next: HTMLButtonElement;
  title: HTMLSpanElement;
  grid: HTMLDivElement;
  hourChip: HTMLButtonElement;
  minuteChip: HTMLButtonElement;
}

/** Two digits are padded with zeros. */
function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** Create an element with class. */
function make<K extends 'button' | 'div' | 'span'>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

/** Create a button: all `type="button"`, otherwise submission will be triggered in the form. */
function makeButton(className: string, text?: string): HTMLButtonElement {
  const button = make('button', className);
  button.type = 'button';
  if (text !== undefined) button.textContent = text;
  return button;
}

/** Create the entire selector DOM (not yet attached to the document). */
function buildPickerDom(): PickerDom {
  const el = makeButton('dsh-pet-todo-due', '无期限');
  el.setAttribute('aria-haspopup', 'dialog');
  el.setAttribute('aria-expanded', 'false');
  el.setAttribute('aria-label', '提醒时间（可选）');

  const calendar = make('div', 'dsh-pet-todo-cal');
  calendar.setAttribute('role', 'dialog');
  calendar.setAttribute('aria-label', '选择提醒时间');

  const head = make('div', 'dsh-pet-todo-cal-head');
  const prev = makeButton('dsh-pet-todo-cal-nav', '‹');
  prev.dataset.act = 'prev';
  prev.setAttribute('aria-label', '上个月');
  const title = make('span', 'dsh-pet-todo-cal-title');
  const next = makeButton('dsh-pet-todo-cal-nav', '›');
  next.dataset.act = 'next';
  next.setAttribute('aria-label', '下个月');
  head.append(prev, title, next);

  const week = make('div', 'dsh-pet-todo-cal-week');
  for (const name of WEEK_HEAD) {
    const cell = make('span', '');
    cell.textContent = name;
    week.appendChild(cell);
  }
  const grid = make('div', 'dsh-pet-todo-cal-grid');

  const foot = make('div', 'dsh-pet-todo-cal-foot');
  const today = makeButton('dsh-pet-todo-cal-act', '今天');
  today.dataset.act = 'today';
  const clear = makeButton('dsh-pet-todo-cal-act', '清除');
  clear.dataset.act = 'clear';
  const grow = make('span', 'dsh-pet-todo-cal-grow');
  const hourChip = makeButton('dsh-pet-todo-cal-chip', '09');
  hourChip.dataset.act = 'hour';
  hourChip.setAttribute('aria-label', '选择小时');
  const colon = make('span', 'dsh-pet-todo-cal-colon');
  colon.textContent = ':';
  const minuteChip = makeButton('dsh-pet-todo-cal-chip', '00');
  minuteChip.dataset.act = 'minute';
  minuteChip.setAttribute('aria-label', '选择分钟');
  const done = makeButton('dsh-pet-todo-cal-act', '完成');
  done.dataset.act = 'done';
  foot.append(today, clear, grow, hourChip, colon, minuteChip, done);

  calendar.append(head, week, grid, foot);
  return { el, calendar, prev, next, title, grid, hourChip, minuteChip };
}

/** The same natural day (ignoring time and minutes). */
function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** The time consisting of the selected date + the current hour and minute; the unselected date is null. */
function dueMs(state: PickerState): number | null {
  if (state.picked === null) return null;
  const { picked } = state;
  return new Date(picked.getFullYear(), picked.getMonth(), picked.getDate(), state.hour, state.minute).getTime();
}

/** Create a calendar grid: write class and aria in the selected state at the same time. */
function cellButton(text: string, selected: boolean): HTMLButtonElement {
  const button = makeButton('dsh-pet-todo-cal-cell', text);
  button.classList.toggle('is-sel', selected);
  button.setAttribute('aria-pressed', String(selected));
  return button;
}

/** Draw date grid. */
function renderDays(dom: PickerDom, state: PickerState): void {
  const today = new Date();
  for (const cell of monthCells(state.view.getFullYear(), state.view.getMonth())) {
    const { date } = cell;
    const button = cellButton(String(date.getDate()), state.picked !== null && sameDay(state.picked, date));
    button.classList.toggle('is-out', cell.out);
    button.classList.toggle('is-today', sameDay(today, date));
    button.dataset.ts = String(date.getTime());
    button.setAttribute('aria-label', `${date.getMonth() + 1}月${date.getDate()}日`);
    dom.grid.appendChild(button);
  }
}

/** Draw a grid of hours or minutes: one number per grid, and the current value is highlighted. */
function renderNumbers(dom: PickerDom, state: PickerState): void {
  const isHour = state.mode === 'hour';
  const count = isHour ? 24 : 60;
  const step = isHour ? 1 : MINUTE_STEP;
  for (let value = 0; value < count; value += step) {
    const button = cellButton(pad2(value), (isHour ? state.hour : state.minute) === value);
    button.dataset.num = String(value);
    button.setAttribute('aria-label', `${value} ${isHour ? '时' : '分'}`);
    dom.grid.appendChild(button);
  }
}

/** Synchronize button copy, time label and title of current grid. */
function syncPicker(dom: PickerDom, state: PickerState): void {
  const ms = dueMs(state);
  dom.el.textContent = ms === null ? '无期限' : dueLabel(ms, Date.now());
  dom.el.classList.toggle('is-set', ms !== null);
  dom.hourChip.textContent = pad2(state.hour);
  dom.minuteChip.textContent = pad2(state.minute);
  dom.hourChip.classList.toggle('is-on', state.mode === 'hour');
  dom.minuteChip.classList.toggle('is-on', state.mode === 'minute');
}

/** Redraw the whole piece: title, moon button, grid and copy in one go. */
function renderPicker(dom: PickerDom, state: PickerState): void {
  const day = state.mode === 'day';
  dom.title.textContent = day
    ? `${state.view.getFullYear()}年${state.view.getMonth() + 1}月`
    : state.mode === 'hour'
      ? '选择小时'
      : '选择分钟';
  dom.prev.hidden = !day;
  dom.next.hidden = !day;
  dom.grid.className = 'dsh-pet-todo-cal-grid is-' + state.mode;
  dom.grid.textContent = '';
  if (day) renderDays(dom, state);
  else renderNumbers(dom, state);
  syncPicker(dom, state);
}

/** Select a day: display the month simultaneously and return to the date grid. */
function pickDay(dom: PickerDom, state: PickerState, date: Date): void {
  state.picked = date;
  state.view = new Date(date.getFullYear(), date.getMonth(), 1);
  state.mode = 'day';
  renderPicker(dom, state);
}

/** Click the buttons in the calendar: turn month, cut grid, today, clear, complete, or select a certain day/number. */
function onCalendarClick(dom: PickerDom, state: PickerState, button: HTMLButtonElement, close: () => void): void {
  const { ts, num, act } = button.dataset;
  if (ts !== undefined) {
    pickDay(dom, state, new Date(Number(ts)));
    return;
  }
  if (num !== undefined) {
    if (state.mode === 'hour') state.hour = Number(num);
    else state.minute = Number(num);
    state.mode = 'day';
    renderPicker(dom, state);
    return;
  }
  if (act === 'prev' || act === 'next') {
    state.view = new Date(state.view.getFullYear(), state.view.getMonth() + (act === 'prev' ? -1 : 1), 1);
    renderPicker(dom, state);
    return;
  }
  if (act === 'hour' || act === 'minute') {
    // Click the label of the current grid again to return to the date, saving a return button.
    state.mode = state.mode === act ? 'day' : act;
    renderPicker(dom, state);
    return;
  }
  if (act === 'today') {
    const now = new Date();
    pickDay(dom, state, new Date(now.getFullYear(), now.getMonth(), now.getDate()));
    return;
  }
  if (act === 'clear') state.picked = null;
  renderPicker(dom, state);
  // close must be used to collapse: it also synchronizes aria with is-picking of the panel (the list relies on it to be re-exposed).
  if (act === 'clear' || act === 'done') close();
}

/**
 * Create an expiration time selector.
 *
 * @param options - callback for expansion and collapse.
 * @returns trigger button, calendar container and read and write handle.
 */
export function createDuePicker(options: DuePickerOptions = {}): DuePicker {
  const now = new Date();
  const state: PickerState = {
    picked: null,
    hour: DEFAULT_HOUR,
    minute: 0,
    view: new Date(now.getFullYear(), now.getMonth(), 1),
    mode: 'day',
    open: false,
  };
  const dom = buildPickerDom();

  const setOpen = (open: boolean): void => {
    if (state.open === open) return;
    state.open = open;
    dom.el.setAttribute('aria-expanded', String(open));
    options.onOpenChange?.(open);
  };

  dom.el.addEventListener('click', () => {
    // When opened, it falls to the "month of the selected date". If it is not selected, it falls to the current month, and always starts from the date grid.
    if (!state.open) {
      const anchor = state.picked ?? new Date();
      state.view = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
      state.mode = 'day';
      renderPicker(dom, state);
    }
    setOpen(!state.open);
  });
  dom.calendar.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest('button');
    if (button !== null) onCalendarClick(dom, state, button, () => setOpen(false));
  });
  // Click elsewhere in the panel to close the calendar: the panel itself has the same monitor installed, and the two do not interfere with each other (each has its own container).
  const onDocMouseDown = (event: MouseEvent): void => {
    if (!state.open) return;
    const target = event.target as Node | null;
    if (target !== null && (dom.el.contains(target) || dom.calendar.contains(target))) return;
    setOpen(false);
  };
  document.addEventListener('mousedown', onDocMouseDown, true);

  renderPicker(dom, state);
  return {
    el: dom.el,
    calendar: dom.calendar,
    value: () => {
      const ms = dueMs(state);
      return ms === null ? '' : formatDateTimeLocal(ms);
    },
    close: () => setOpen(false),
    reset: () => {
      state.picked = null;
      state.hour = DEFAULT_HOUR;
      state.minute = 0;
      state.mode = 'day';
      renderPicker(dom, state);
      setOpen(false);
    },
    dispose: () => document.removeEventListener('mousedown', onDocMouseDown, true),
  };
}
