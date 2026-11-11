/**
 * To-do persist to disk shape and field verification: The only conventions when reading and writing to-do on the host
 * side.
 *
 * Do not do IO, do not read the clock: Entries that fail to parse will be discarded entirely (dirty data will not be
 * allowed to enter the memory), and ./store will decide when to persist to disk. Same name as the shared/todo/types
 * field of wire; host is not a import shared layer (DSH single file load constraint).
 * @module dsh-pet/src/host/todo/types
 */

/** Single to-do: disk shared with HTTP response. */
export interface TodoRecord {
  /** Unique within the instance; it only contains `[A-Za-z0-9_-]` and will appear in the URL path. */
  id: string;
  /** Text: trim, 1–200 code points. */
  text: string;
  /** Expiration time (epoch ms); null = No expiration date, never remind. */
  dueAt: number | null;
  done: boolean;
  createdAt: number;
  updatedAt: number;
  /** Completion time; unfinished is null. */
  completedAt: number | null;
  /** Last reminder time; null = Not reminded yet. Changing the deadline or reopening will clear it, allowing the reminder to be rescheduled. */
  lastRemindedAt: number | null;
}

/** To-do file version: incremented when the shape changes, and the reading side decides whether to migrate based on this. */
export const TODO_FILE_VERSION = 1;

/** The upper limit of text (number of code points): enough to write one thing clearly without bursting the bubble and panel. */
export const TODO_TEXT_MAX = 200;

/** Upper limit of request body (bytes): To-do reading and writing only accepts short text to prevent the entire book from being crammed into it at once. */
export const TODO_BODY_MAX_BYTES = 16 * 1024;

/** persist to disk root of file. */
export interface TodoFile {
  version: number;
  todos: TodoRecord[];
}

/** Verification conclusion at expiration time: ok = false means an invalid value is explicitly given, and the caller returns bad-request. */
export type DueAtParse = { ok: true; value: number | null } | { ok: false };

/**
 * Verify and normalize text.
 *
 * @param raw - the original text in the request body.
 * The text after @returns trim; null is returned when it is a non-character string, blank or exceeds
 * {@link TODO_TEXT_MAX} code points.
 */
export function normalizeTodoText(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const text = raw.trim();
  if (text === '') return null;
  if (Array.from(text).length > TODO_TEXT_MAX) return null;
  return text;
}

/**
 * Verification expiration time.
 *
 * `null` / Default all means "no deadline"; the number must be limited to epoch milliseconds and fall within the range
 * that Date can represent.
 *
 * @param raw - The original value in the request body or disk.
 * @returns normalized value, or `ok: false` .
 */
export function normalizeTodoDueAt(raw: unknown): DueAtParse {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return { ok: false };
  // 8.64 e15 = the maximum timestamp of Date; no matter how large it is, it is not a real moment.
  if (Math.abs(raw) > 8.64e15) return { ok: false };
  return { ok: true, value: raw };
}

/** Read a limited number, fallback when invalid. */
function finiteOr(raw: unknown, fallback: number): number {
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : fallback;
}

/**
 * Reading a record: If any field is unqualified, null will be returned (the entire record will be discarded, no repair
 * or guessing).
 *
 * @param raw - A single raw value on disk or in the request body.
 * @returns verified record, or null.
 */
export function parseTodoRecord(raw: unknown): TodoRecord | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  if (typeof record.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(record.id)) return null;
  const text = normalizeTodoText(record.text);
  if (text === null) return null;
  const due = normalizeTodoDueAt(record.dueAt);
  if (!due.ok) return null;
  const createdAt = finiteOr(record.createdAt, 0);
  const updatedAt = finiteOr(record.updatedAt, createdAt);
  const done = record.done === true;
  const completedAt = done ? finiteOr(record.completedAt, updatedAt) : null;
  const lastRemindedAt =
    typeof record.lastRemindedAt === 'number' && Number.isFinite(record.lastRemindedAt) ? record.lastRemindedAt : null;
  return { id: record.id, text, dueAt: due.value, done, createdAt, updatedAt, completedAt, lastRemindedAt };
}

/**
 * Read the entire file: if the root is not an object and `todos` is not an array, it will be treated as an empty list;
 * if id is repeated, only the first one will be left.
 *
 * Results for @param raw - `JSON.parse` .
 * @returns Verified record list (maintaining file order, sorting is handed over to caller).
 */
export function parseTodoFile(raw: unknown): TodoRecord[] {
  const root = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const list = Array.isArray(root.todos) ? root.todos : [];
  const out: TodoRecord[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    const todo = parseTodoRecord(item);
    if (todo === null || seen.has(todo.id)) continue;
    seen.add(todo.id);
    out.push(todo);
  }
  return out;
}

/** Copying a record: The consumer gets a copy, and changing it will not pollute the cache. */
export function cloneTodo(todo: TodoRecord): TodoRecord {
  return { ...todo };
}

/**
 * Display order: unfinished first (the closer the due date is to the front, unlimited time at the bottom), completed
 * last (the most recently completed one is at the top).
 *
 * @param list - Records in any order.
 * @returns is a sorted new array without changing the original array.
 */
export function sortTodos(list: readonly TodoRecord[]): TodoRecord[] {
  return [...list].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    if (a.done) return (b.completedAt ?? 0) - (a.completedAt ?? 0);
    const aDue = a.dueAt ?? Number.POSITIVE_INFINITY;
    const bDue = b.dueAt ?? Number.POSITIVE_INFINITY;
    if (aDue !== bDue) return aDue - bDue;
    return a.createdAt - b.createdAt;
  });
}
