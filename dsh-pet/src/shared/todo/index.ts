/**
 * Shared exports for to-do items: panel building, display formatting and wire types.
 *
 * The criteria (sorting, urgency, time formatting) are all pure functions; the panel only relies on DOM and fetch, and
 * both ends are the same. The browser side directly import this module from the bubble shell, and the desktop
 * shared-core is packaged with the same copy via shared/index.
 * @module dsh-pet/src/shared/todo
 */
export { addTodo, loadTodos, patchTodo, removeTodo, TODOS_PATH } from './api.ts';
export { createTodoPanel } from './panel.ts';
export type { TodoPanel, TodoPanelOptions } from './panel.ts';
export { todoPanelTopMarginPx } from './styles.ts';
export { TODO_HOTKEY_HINT, isTodoHotkey } from './hotkey.ts';
export {
  dueLabel,
  formatDateTimeLocal,
  metaLabel,
  parseDateTimeLocal,
  remainingLabel,
  spanText,
  todoUrgency,
} from './format.ts';
export type { TodoUrgency } from './format.ts';
export { parseTodoItem, parseTodoList, sortTodoItems } from './types.ts';
export type { TodoItem } from './types.ts';
