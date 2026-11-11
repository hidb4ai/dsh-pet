/**
 * The rhythm and text of to-do reminders (host side pure logic).
 *
 * Only answer "when should the reminder be given" and "what should the reminder say": do not read the file, do not
 * touch the timer and HTTP, the time is injected by the caller. The closer the expiration is, the denser the reminder
 * is. This is the core contract of this module: to adjust the state, only change the following two tables, and
 * `nextReminderAt` will automatically follow.
 * @module dsh-pet/src/host/todo/policy
 */
import type { TodoRecord } from './types.ts';

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** Reminder state before expiration: `[minimum remaining milliseconds, reminder interval]`, matching from wide to narrow. */
const AHEAD_STEPS: ReadonlyArray<readonly [number, number]> = [
  [3 * DAY_MS, DAY_MS],
  [DAY_MS, 12 * HOUR_MS],
  [6 * HOUR_MS, 4 * HOUR_MS],
  [HOUR_MS, HOUR_MS],
  [15 * MINUTE_MS, 20 * MINUTE_MS],
  [0, 5 * MINUTE_MS],
];

/** Reminder interval after overdue: once every 30 minutes within 1 day, once every 6 hours within a week, no longer interrupting. */
const OVERDUE_FRESH_INTERVAL_MS = 30 * MINUTE_MS;
const OVERDUE_OLD_INTERVAL_MS = 6 * HOUR_MS;
/** If it is overdue for this long, no reminder will be given (the to-do will still remain in the list, waiting for the user to handle it). */
const OVERDUE_STOP_MS = 7 * DAY_MS;
/** Not reminding you at all before it is due so long: one-month long-term matters are not worth thinking about every day. */
const AHEAD_START_MS = 7 * DAY_MS;

/** The maximum length (code point) of the quotation text in the reminder copy: bubble cannot fit the entire to-do item. */
const REMINDER_TEXT_MAX = 18;

/**
 * Click "How long until expiration" to get the reminder interval.
 *
 * @param remainingMs - Expiration time minus the current time; ≤0 means it is overdue.
 * @returns interval milliseconds; `Infinity` indicates that no further reminders should be made at this stage.
 */
export function reminderIntervalMs(remainingMs: number): number {
  if (remainingMs <= 0) {
    const overdueBy = -remainingMs;
    if (overdueBy >= OVERDUE_STOP_MS) return Number.POSITIVE_INFINITY;
    return overdueBy >= DAY_MS ? OVERDUE_OLD_INTERVAL_MS : OVERDUE_FRESH_INTERVAL_MS;
  }
  if (remainingMs > AHEAD_START_MS) return Number.POSITIVE_INFINITY;
  for (const [minRemaining, interval] of AHEAD_STEPS) {
    if (remainingMs >= minRemaining) return interval;
  }
  return 5 * MINUTE_MS;
}

/**
 * When should this to-do item be reminded next?
 *
 * Use "last reminder (use creation time if not reminded) + current stage interval" as the next time: the closer the
 * time is to expiration, the shorter the interval, so the next reminder is automatically advanced; changing the period
 * or reopening will clear `lastRemindedAt` and reschedule. If the remaining time is shorter than the slot interval,
 * the remaining time is used; if it is overdue but has never been reminded, return to the starting point of the
 * schedule (i.e. "remind now"). Otherwise, if the first reminder is missed during inspection, the overdue slot will
 * push it to 30 minutes later.
 *
 * @param todo - Single to-do item.
 * @param now - the current moment ( epoch ms ).
 * @returns The next reminder time; null when it is completed, has no deadline or has passed the reminder stage.
 */
export function nextReminderAt(todo: TodoRecord, now: number): number | null {
  if (todo.done || todo.dueAt === null) return null;
  const intervalNow = reminderIntervalMs(todo.dueAt - now);
  if (!Number.isFinite(intervalNow)) return null;
  // Already reminded: continue the arrangement according to the current state from the last reminder time. The interval will be gradually shortened before expiration, and the next time will naturally be advanced.
  if (todo.lastRemindedAt !== null) return todo.lastRemindedAt + intervalNow;
  const remainingAtCreation = todo.dueAt - todo.createdAt;
  // The reminder window has not yet been entered when creating (future matters): first arrange according to the current state; this moment has long passed, and the first beat after entering the window will be added.
  if (remainingAtCreation > AHEAD_START_MS) return todo.createdAt + intervalNow;
  // The first reminder must be calculated using "the remaining amount at the moment of creation", not "the remaining
  // amount now": the latter will count the elapsed time repeatedly, so that the first reminder will be triggered
  // immediately after creation (the actual measurement of short-term events will be a whole state earlier).
  const intervalAtCreation = reminderIntervalMs(remainingAtCreation);
  const step = Math.min(Number.isFinite(intervalAtCreation) ? intervalAtCreation : 0, Math.max(0, remainingAtCreation));
  return todo.createdAt + step;
}

/** A timely reminder: the to-do entity and the time when it should be reminded. */
export interface DueReminder {
  todo: TodoRecord;
  at: number;
}

/**
 * Select the item from the list that "should be reminded now".
 *
 * A maximum of one reminder can be issued per shot: when multiple reminders are due at the same time, the order of
 * reminder time is followed by the order of expiration (the more urgent one takes priority).
 *
 * @param todos - All to be done.
 * @param now - the current moment ( epoch ms ).
 * @returns hits the to-do; returns null if the point is not reached.
 */
export function pickReminder(todos: readonly TodoRecord[], now: number): DueReminder | null {
  let best: DueReminder | null = null;
  for (const todo of todos) {
    const at = nextReminderAt(todo, now);
    if (at === null || at > now) continue;
    if (best === null || at < best.at) {
      best = { todo, at };
      continue;
    }
    if (at === best.at) {
      const todoDue = todo.dueAt ?? Number.POSITIVE_INFINITY;
      const bestDue = best.todo.dueAt ?? Number.POSITIVE_INFINITY;
      if (todoDue < bestDue) best = { todo, at };
    }
  }
  return best;
}

/**
 * Write the millisecond difference in human language.
 *
 * @param ms - Duration (non-negative; negative numbers take the absolute value first).
 * @returns For example, "25 minutes", "3 hours", and "2 days".
 */
export function spanText(ms: number): string {
  const minutes = Math.max(1, Math.round(Math.abs(ms) / MINUTE_MS));
  if (minutes < 60) return `${minutes}分钟`;
  const hours = Math.max(1, Math.round(minutes / 60));
  if (hours < 24) return `${hours}小时`;
  return `${Math.max(1, Math.round(hours / 24))}天`;
}

/** When the text is too long, it is truncated according to code points and ellipses are added. */
export function truncateTodoText(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length <= max ? text : chars.slice(0, max).join('') + '…';
}

/**
 * A reminder bubble copy.
 *
 * @param todo - To-dos with a deadline that are not completed.
 * @param now - the current time (epoch ms), used to determine how long is left.
 * @returns A reminder that can be spoken directly.
 */
export function reminderText(todo: TodoRecord, now: number): string {
  const label = truncateTodoText(todo.text, REMINDER_TEXT_MAX);
  const dueAt = todo.dueAt ?? now;
  if (dueAt <= now) {
    // Don't say "1 minute overdue" when it's less than a minute past o'clock - that's just rounding up and reads like it's way too late.
    if (now - dueAt < MINUTE_MS) return `「${label}」到点啦，记得处理`;
    return `「${label}」已经逾期${spanText(now - dueAt)}啦，记得处理`;
  }
  return `「${label}」还有${spanText(dueAt - now)}就到点啦`;
}
