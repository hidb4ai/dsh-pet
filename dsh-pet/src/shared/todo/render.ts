/**
 * DOM skeleton and list rendering of to-do panel: only elements are assembled and events are tied, no numbers are
 * retrieved, no positioning is done, and pop-up windows are not closed.
 *
 * Deletion is a two-step process (change to "Confirm" first, and then automatically restore after 2.5 seconds): the
 * list is not revoked, and it is too easy to make a mistake and lose it.
 * @module dsh-pet/src/shared/todo/render
 */
import { createDuePicker, type DuePicker } from './due-picker.ts';
import { metaLabel, todoUrgency } from './format.ts';
import type { TodoItem } from './types.ts';

/** Elements in the panel that need to be held by the panel logic. */
export interface TodoPanelParts {
  /** Root: the outer frame of the panel content, and the nodes are inserted into the container by caller. */
  root: HTMLElement;
  /** Add form: press Enter to submit. */
  form: HTMLFormElement;
  /** Text input box. */
  input: HTMLInputElement;
  /** Expiration time selector: The button is in the form row, and the calendar is hung in the root node. */
  duePicker: DuePicker;
  /** Add button. */
  addButton: HTMLButtonElement;
  /** Manifest container. */
  list: HTMLUListElement;
  /** Empty prompt. */
  empty: HTMLDivElement;
  /** Top outstanding count. */
  count: HTMLSpanElement;
  /** The close button in the upper right corner; the desktop window margin is click-through, and you can't close it by clicking on the blank space, so you can only rely on it. */
  closeButton: HTMLButtonElement;
  /** Error line (`hidden` when hidden). */
  error: HTMLDivElement;
}

/** Interaction callback on manifest items. */
export interface TodoListHandlers {
  /** Check/uncheck. */
  onToggle: (todo: TodoItem, done: boolean) => void;
  /** Delete (caller has confirmed once). */
  onDelete: (todo: TodoItem) => void;
}

/** The secondary confirmation window of the delete button (ms): automatically recovers after timeout to avoid the "confirmation" status hanging all the time. */
const DELETE_ARM_MS = 2500;

/** Empty copy: It will be temporarily replaced during loading and written back when re-rendering. */
const EMPTY_TEXT = '还没有待办。记一件要做的事，到点我会提醒你～';

/** At most a few lines of the list are exposed, and the rest are scrolled. */
const LIST_ROWS = 2;

/** Create an element with class to avoid writing createElement + className everywhere. */
function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Create a foldable area: the height is grid-template-rows and transitions between 0 fr and 1 fr. The content height is auto and can also be animated. */
function fold(className: string, children: HTMLElement[]): HTMLDivElement {
  const outer = element('div', 'dsh-pet-todo-fold ' + className);
  const clip = element('div', 'dsh-pet-todo-foldClip');
  clip.append(...children);
  outer.appendChild(clip);
  return outer;
}

/**
 * Create panel skeleton (not yet attached to the document).
 *
 * @returns All element references needed for the panel.
 */
export function createTodoPanelParts(): TodoPanelParts {
  const root = element('div', 'dsh-pet-todo');
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', '待办事项');

  const head = element('div', 'dsh-pet-todo-head');
  const title = element('span', 'dsh-pet-todo-title', '待办事项');
  const count = element('span', 'dsh-pet-todo-count', '0 项未完成');
  count.setAttribute('aria-live', 'polite');
  const closeButton = element('button', 'dsh-pet-todo-close', '✕');
  closeButton.type = 'button';
  closeButton.setAttribute('aria-label', '关闭待办面板');
  head.append(title, count, closeButton);

  const form = element('form', 'dsh-pet-todo-form');
  const input = element('input', 'dsh-pet-todo-input');
  input.type = 'text';
  input.maxLength = 200;
  input.placeholder = '记一件要做的事…';
  input.autocomplete = 'off';
  input.setAttribute('aria-label', '待办内容');
  const row = element('div', 'dsh-pet-todo-row');
  const duePicker = createDuePicker({ onOpenChange: (open) => root.classList.toggle('is-picking', open) });
  const addButton = element('button', 'dsh-pet-todo-add', '添加');
  addButton.type = 'submit';
  row.append(duePicker.el, addButton);
  form.append(input, row);

  const error = element('div', 'dsh-pet-todo-err');
  error.hidden = true;

  const empty = element('div', 'dsh-pet-todo-empty', EMPTY_TEXT);
  empty.hidden = true;

  const list = element('ul', 'dsh-pet-todo-list');
  const hint = element('div', 'dsh-pet-todo-hint', '离到期越近，我会提醒得越勤快～');

  // Two pieces of content appear in the lower half of the area in turn: the list state and the calendar state are each
  // a folding area, and the expansion and collapse follow the same transition. The height of the panel therefore
  // follows the content (no blank space is left), and when switching, it slides over instead of jumping hard.
  const lower = element('div', 'dsh-pet-todo-lower');
  lower.append(fold('is-cal', [duePicker.calendar]), fold('is-list', [error, empty, list, hint]));
  root.append(head, form, lower);
  return { root, form, input, duePicker, addButton, list, empty, count, closeButton, error };
}

/**
 * Press the list to the height of "two lines", and the extra part will be scrolled by the list itself.
 *
 * The line height changes with the text folding and cannot be written as a constant CSS, so measure the first line
 * once and multiply it by two; if the amount is less than the amount (not mounted), there is no upper limit to avoid
 * pressing the list to 0 height.
 *
 * @param list - manifest container.
 */
function capListHeight(list: HTMLUListElement): void {
  const first = list.firstElementChild;
  if (first === null) {
    list.style.maxHeight = '';
    return;
  }
  const rowHeight = first.getBoundingClientRect().height;
  if (rowHeight <= 0) return;
  // The list has built-in padding, which is included in the height so that half of the last line will not be cut off.
  const pad = parseFloat(getComputedStyle(list).paddingTop) || 0;
  list.style.maxHeight = rowHeight * LIST_ROWS + pad * 2 + 'px';
}

/**
 * Render an entire list.
 *
 * @param parts - Panel element.
 * @param todos - Sorted to-do.
 * @param handlers - callback for checking and deleting.
 * @param now - the current time, used to generate "how long is left".
 */
export function renderTodoList(
  parts: TodoPanelParts,
  todos: readonly TodoItem[],
  handlers: TodoListHandlers,
  now: number,
): void {
  parts.list.textContent = '';
  const pending = todos.filter((todo) => !todo.done).length;
  parts.count.textContent = `${pending} 项未完成`;
  parts.empty.textContent = EMPTY_TEXT;
  parts.empty.hidden = todos.length > 0;
  for (const todo of todos) parts.list.appendChild(renderItem(todo, handlers, now));
  capListHeight(parts.list);
}

/** Render one line; unfinished items have urgency, completed items are underlined. */
function renderItem(todo: TodoItem, handlers: TodoListHandlers, now: number): HTMLLIElement {
  const item = element('li', 'dsh-pet-todo-item' + (todo.done ? ' is-done' : ''));
  if (!todo.done) item.dataset.urgency = todoUrgency(todo.dueAt, now);

  const check = element('input', 'dsh-pet-todo-check');
  check.type = 'checkbox';
  check.checked = todo.done;
  check.setAttribute('aria-label', (todo.done ? '标记未完成：' : '标记完成：') + todo.text);
  check.addEventListener('change', () => handlers.onToggle(todo, check.checked));

  const main = element('div', 'dsh-pet-todo-main');
  const text = element('div', 'dsh-pet-todo-text', todo.text);
  const meta = element('div', 'dsh-pet-todo-meta', metaLabel(todo, now));
  main.append(text, meta);

  const remove = element('button', 'dsh-pet-todo-del', '✕');
  remove.type = 'button';
  remove.setAttribute('aria-label', '删除：' + todo.text);
  remove.addEventListener('click', () => {
    // Clicking for the first time only enters the confirmation state; clicking again will actually delete it.
    if (remove.dataset.armed !== '1') {
      remove.dataset.armed = '1';
      remove.classList.add('is-armed');
      remove.textContent = '确认';
      window.setTimeout(() => {
        // When the panel is closed/re-rendered, the element is no longer in the document: just restore it silently.
        if (!remove.isConnected) return;
        delete remove.dataset.armed;
        remove.classList.remove('is-armed');
        remove.textContent = '✕';
      }, DELETE_ARM_MS);
      return;
    }
    handlers.onDelete(todo);
  });

  item.append(check, main, remove);
  return item;
}

/**
 * Show/clear error lines.
 *
 * @param parts - Panel element.
 * @param message - error text; null means clear.
 */
export function setTodoError(parts: TodoPanelParts, message: string | null): void {
  parts.error.hidden = message === null;
  parts.error.textContent = message ?? '';
}

/**
 * Switch busy state: disable input and buttons when the request is in progress to avoid connecting two dots.
 *
 * @param parts - Panel element.
 * @param busy - Whether the request is in transit.
 */
export function setTodoBusy(parts: TodoPanelParts, busy: boolean): void {
  parts.input.disabled = busy;
  parts.duePicker.el.disabled = busy;
  parts.addButton.disabled = busy;
}
