/**
 * To-do display formatting: expiration time, relative remaining and urgency.
 *
 * Pure function, the current moment is passed in by caller; panel rendering, sorted subtitles and tests share this
 * convention. We are not responsible for data retrieval and time zone conversion: `datetime-local` is read and written
 * according to the browser's local time zone, which is consistent with what the user sees.
 * @module dsh-pet/src/shared/todo/format
 */
import type { TodoItem } from './types.ts';

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** Urgency: The panel is dyed accordingly, with overdue being the reddest and undated being the lightest. */
export type TodoUrgency = 'overdue' | 'soon' | 'today' | 'later' | 'undated';

/** Weekday name, index aligned with Date.getDay(). */
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const;

/** Two digits are padded with zeros. */
function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** Timestamp of zero o'clock of the day: Use it for cross-day comparison to avoid the 23/25 hour day caused by daylight saving time. */
function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** How many natural days are the difference between the two times (according to the local calendar, forward is negative). */
function dayDiff(target: Date, base: Date): number {
  return Math.round((startOfDay(target) - startOfDay(base)) / DAY_MS);
}

/**
 * Write the millisecond difference in human language.
 *
 * @param ms - Duration (non-negative; take the absolute value first for negative numbers). If it is less than one
 * minute, it will be counted as one minute.
 * @returns For example, "25 minutes", "3 hours", and "2 days".
 */
export function spanText(ms: number): string {
  const minutes = Math.max(1, Math.round(Math.abs(ms) / MINUTE_MS));
  if (minutes < 60) return `${minutes}分钟`;
  const hours = Math.max(1, Math.round(minutes / 60));
  if (hours < 24) return `${hours}小时`;
  return `${Math.max(1, Math.round(hours / 24))}天`;
}

/**
 * Absolute statement of expiration time (excluding "how long is left").
 *
 * @param dueAt - Expiration time; null means no expiration date.
 * @param now - the current moment.
 * @returns "Today 18:00" "Tomorrow 09:00" "Friday 20:00" "November 3 09:00" "No deadline".
 */
export function dueLabel(dueAt: number | null, now: number): string {
  if (dueAt === null) return '无期限';
  const due = new Date(dueAt);
  const clock = `${pad2(due.getHours())}:${pad2(due.getMinutes())}`;
  const days = dayDiff(due, new Date(now));
  if (days === 0) return `今天 ${clock}`;
  if (days === 1) return `明天 ${clock}`;
  if (days === 2) return `后天 ${clock}`;
  if (days > 2 && days < 7) return `${WEEKDAYS[due.getDay()]} ${clock}`;
  return `${due.getMonth() + 1}月${due.getDate()}日 ${clock}`;
}

/**
 * Relative: How long is left / how long is overdue.
 *
 * @param dueAt - Expiration time; null (no expiry) returns an empty string.
 * @param now - the current moment.
 * @returns "2 hours left" "3 days overdue" or `''` .
 */
export function remainingLabel(dueAt: number | null, now: number): string {
  if (dueAt === null) return '';
  if (dueAt <= now) return `已逾期${spanText(now - dueAt)}`;
  return `还剩${spanText(dueAt - now)}`;
}

/**
 * Urgency: Only "unfinished" to-dos are meaningful.
 *
 * @param dueAt - Expiration time; null = No expiration date.
 * @param now - the current moment.
 * @returns within 6 hours is soon , within 24 hours is today , and further away is later .
 */
export function todoUrgency(dueAt: number | null, now: number): TodoUrgency {
  if (dueAt === null) return 'undated';
  const remaining = dueAt - now;
  if (remaining <= 0) return 'overdue';
  if (remaining <= 6 * HOUR_MS) return 'soon';
  if (remaining <= DAY_MS) return 'today';
  return 'later';
}

/**
 * A subtitle of a to-do list.
 *
 * @param todo - To-do body.
 * @param now - the current moment.
 * @returns Completed → "Completed"/"Completed · Today 18:00"; Unfinished → "Today 18:00 · 2 hours left".
 */
export function metaLabel(todo: TodoItem, now: number): string {
  if (todo.done) {
    return todo.dueAt === null ? '已完成' : `已完成 · ${dueLabel(todo.dueAt, now)}`;
  }
  if (todo.dueAt === null) return '无期限';
  const relative = remainingLabel(todo.dueAt, now);
  if (todo.dueAt <= now) return relative;
  return `${dueLabel(todo.dueAt, now)} · ${relative}`;
}

/**
 * Write the timestamp as the local character string recognized by the `datetime-local` input box.
 *
 * @param ms - epoch milliseconds.
 * @returns `YYYY-MM-DDTHH:mm` (local time zone).
 */
export function formatDateTimeLocal(ms: number): string {
  const date = new Date(ms);
  return (
    `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}` +
    `T${pad2(date.getHours())}:${pad2(date.getMinutes())}`
  );
}

/**
 * Read the value of `datetime-local` ; the empty string means "no expiration".
 *
 * @param value - the value of the input box, in the shape of `YYYY-MM-DDTHH:mm` .
 * @returns epoch milliseconds; null is returned when the string is empty, the format is invalid, or the date does not
 * exist (such as February 30).
 */
export function parseDateTimeLocal(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  const date = new Date(year, month - 1, day, hour, minute, 0, 0);
  // Component readback verification: February 30th will be rolled to March by Date. Here it is judged as invalid rather than quietly rescheduled.
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date.getTime();
}
