/**
 * The content and lifecycle of the to-do panel: retrieval, submission, deletion, busy status, and intention forwarding
 * of "click outside the panel to collapse". It is not responsible for positioning and display: the panel is a slot of
 * the bubble slot, and the position and who is displayed are determined by the slot. Depends on the HTTP of ./api,
 * the skeleton of ./render and the style of ./styles; cleaning only picks its own nodes and monitors, without
 * touching the container.
 * @module dsh-pet/src/shared/todo/panel
 */
import { TODOS_PATH, addTodo, loadTodos, patchTodo, removeTodo, type TodoResult } from './api.ts';
import { parseDateTimeLocal } from './format.ts';
import { createTodoPanelParts, renderTodoList, setTodoBusy, setTodoError, type TodoListHandlers } from './render.ts';
import { injectTodoCss } from './styles.ts';
import type { TodoItem } from './types.ts';

/** Panel mounting parameters. */
export interface TodoPanelOptions {
  /** Interface base address; the desktop can transmit the absolute address, and the default is the same-origin prefix. */
  baseUrl?: string;
  /** Called when clicking outside the panel; visibility is determined by the slot, and the panel does not close itself. */
  onClose?: () => void;
  /** Should the panel keep the impact point of this press? Each end determines its own hit layer, and the panel does not recognize their class names. */
  keepOpenOn?: (target: EventTarget | null) => boolean;
}

/** Panel handle. */
export interface TodoPanel {
  /** Panel root element; caller is responsible for stuffing it into its own container. */
  el: HTMLElement;
  /** Close and clean up (idempotent). */
  dispose: () => void;
}

/**
 * Create a to-do panel and start fetching data.
 *
 * @param options - interface base address and shutdown callback.
 * @returns panel root element and cleanup function.
 */
export function createTodoPanel(options: TodoPanelOptions = {}): TodoPanel {
  injectTodoCss();
  const parts = createTodoPanelParts();
  const baseUrl = options.baseUrl ?? TODOS_PATH;
  let disposed = false;
  let busy = false;
  let todos: TodoItem[] = [];

  // Three functions refer to each other (list callback → modify → redraw → render): mutate / reload are promoted with
  // function declarations. They are referenced in callback and will not be evaluated during construction, so there is
  // no initialization order problem.
  const handlers: TodoListHandlers = {
    onToggle: (todo, done) => void mutate(() => patchTodo(todo.id, { done }, baseUrl)),
    onDelete: (todo) => void mutate(() => removeTodo(todo.id, baseUrl)),
  };

  /** Pull the entire list again: modifications will always be based on the host's return, and the results will not be guessed locally. */
  async function reload(): Promise<void> {
    const result = await loadTodos(baseUrl);
    if (disposed) return;
    if (!result.ok) {
      setTodoError(parts, result.message);
      // Don't let the empty state stay at "Loading..." when loading fails.
      parts.empty.textContent = '清单加载失败，关掉面板再开一次试试';
      parts.empty.hidden = false;
      return;
    }
    todos = result.value;
    setTodoError(parts, null);
    renderTodoList(parts, todos, handlers, Date.now());
  }

  /** Execute a modification serially: resubmission is prohibited while the request is in progress, and will be repulsed after success. */
  async function mutate(task: () => Promise<TodoResult<unknown>>): Promise<void> {
    if (disposed || busy) return;
    busy = true;
    setTodoBusy(parts, true);
    setTodoError(parts, null);
    const result = await task();
    busy = false;
    if (disposed) return;
    setTodoBusy(parts, false);
    if (!result.ok) {
      setTodoError(parts, result.message);
      return;
    }
    await reload();
  }

  /** Submit new: empty text returns directly to the input box. */
  const submitAdd = (): void => {
    const text = parts.input.value.trim();
    if (text === '') {
      parts.input.focus();
      return;
    }
    // The selector will only give `YYYY-MM-DDTHH:mm` or an empty string. If it cannot be parsed, it will be processed indefinitely and submission will not be blocked.
    const dueText = parts.duePicker.value();
    const dueAt = dueText === '' ? null : parseDateTimeLocal(dueText);
    // Collapse the calendar first: the error line is on the list side. When the calendar is open, it will be hidden by the folding area, and the error will not be visible.
    parts.duePicker.close();
    // When the time is created in the past, it is overdue, and the reminder will be shouted as soon as it is online, which is equivalent to letting the user make a mistake first and then correct it.
    if (dueAt !== null && dueAt < Date.now()) {
      setTodoError(parts, '这个时间已经过去了，换一个吧');
      return;
    }
    void mutate(async () => {
      const result = await addTodo(text, dueAt, baseUrl);
      if (result.ok) {
        parts.input.value = '';
        parts.duePicker.reset();
      }
      return result;
    });
  };

  parts.form.addEventListener('submit', (event) => {
    event.preventDefault();
    submitAdd();
  });
  // Click outside the panel to collapse: The panel has no title bar and no close button. The intention to collapse can
  // only be expressed by "clicking elsewhere". Use mousedown instead of click, and go through the capture phase: when
  // dragging the pet, pointerdown will intercept the event first, and monitoring click will miss the "press and drag"
  // moment; the capture phase is guaranteed to be judged before any processing on the page. Do not write instanceof
  // Node: shared-core will be checked by lint on the desktop as a global script without DOM.
  const onDocMouseDown = (event: MouseEvent): void => {
    if (disposed) return;
    const target = event.target as Node | null;
    if (target !== null && parts.root.contains(target)) return;
    // Clicking on the pet body does not count as "clicking elsewhere": dragging it away is a common requirement, and the starting point of dragging is this click.
    if (options.keepOpenOn?.(event.target) === true) return;
    options.onClose?.();
  };
  document.addEventListener('mousedown', onDocMouseDown, true);
  parts.closeButton.addEventListener('click', () => options.onClose?.());
  parts.empty.textContent = '加载中…';
  parts.empty.hidden = false;
  // The input box does not automatically focus: the panel hangs above the pet's head, taking away the focus of the DSH input box is more annoying than missing one click.
  void reload();

  return {
    el: parts.root,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      // Monitoring must be removed: If you do not remove it, it will be judged once every time you click it after the panel is closed, which is equivalent to a dead callback hanging permanently.
      document.removeEventListener('mousedown', onDocMouseDown, true);
      parts.duePicker.dispose();
      parts.root.remove();
    },
  };
}
