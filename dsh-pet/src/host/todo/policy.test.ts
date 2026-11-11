/**
 * Unit test of the to-do reminder strategy - verify three things: ① "The closer the expiration is, the denser the
 * reminders are": the state table is based on the interval from the expiration time, and after the expiration, the
 * frequency is gradually reduced and finally stopped; ② The next reminder = the last reminder (the creation time is
 * taken if there is no reminder) + the current state interval, rearrange by clear lastRemindedAt after changing the
 * period; ③ Only the most urgent one will be selected for each shot. When the same shot is tied, the order of
 * expiration will be used.
 *
 * Running method: node --experimental-strip-types --test src/host/todo/policy.test.ts
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  nextReminderAt,
  pickReminder,
  reminderIntervalMs,
  reminderText,
  spanText,
  truncateTodoText,
} from './policy.ts';
import type { TodoRecord } from './types.ts';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Create a to-do: only cover the fields that this document cares about. */
function todo(overrides: Partial<TodoRecord> = {}): TodoRecord {
  return {
    id: 'todo-1',
    text: '交周报',
    dueAt: 1_000_000,
    done: false,
    createdAt: 0,
    updatedAt: 0,
    completedAt: null,
    lastRemindedAt: null,
    ...overrides,
  };
}

describe('reminderIntervalMs ——The closer the expiry is, the shorter the interval is.', () => {
  test('No reminder at all for long-term (more than 7 days)', () => {
    assert.equal(reminderIntervalMs(8 * DAY), Number.POSITIVE_INFINITY);
    assert.equal(reminderIntervalMs(7 * DAY + 1), Number.POSITIVE_INFINITY);
  });

  test('Between 7 days and 1 day: 24 hours → 12 hours', () => {
    assert.equal(reminderIntervalMs(7 * DAY), DAY);
    assert.equal(reminderIntervalMs(3 * DAY), DAY);
    assert.equal(reminderIntervalMs(3 * DAY - 1), 12 * HOUR);
    assert.equal(reminderIntervalMs(DAY), 12 * HOUR);
  });

  test('Within 1 day: 4 hours → 1 hour → 20 minutes → 5 minutes', () => {
    assert.equal(reminderIntervalMs(DAY - 1), 4 * HOUR);
    assert.equal(reminderIntervalMs(6 * HOUR), 4 * HOUR);
    assert.equal(reminderIntervalMs(6 * HOUR - 1), HOUR);
    assert.equal(reminderIntervalMs(HOUR), HOUR);
    assert.equal(reminderIntervalMs(HOUR - 1), 20 * MINUTE);
    assert.equal(reminderIntervalMs(15 * MINUTE), 20 * MINUTE);
    assert.equal(reminderIntervalMs(15 * MINUTE - 1), 5 * MINUTE);
    assert.equal(reminderIntervalMs(1), 5 * MINUTE);
  });

  test('Overdue: 30 minutes within 1 day, 6 hours within a week, then stop', () => {
    assert.equal(reminderIntervalMs(0), 30 * MINUTE);
    assert.equal(reminderIntervalMs(-1), 30 * MINUTE);
    assert.equal(reminderIntervalMs(-DAY), 6 * HOUR);
    assert.equal(reminderIntervalMs(-7 * DAY + 1), 6 * HOUR);
    assert.equal(reminderIntervalMs(-7 * DAY), Number.POSITIVE_INFINITY);
  });
});

describe('nextReminderAt —— Schedule', () => {
  test('Completed/Indefinite → null', () => {
    assert.equal(nextReminderAt(todo({ done: true }), 0), null);
    assert.equal(nextReminderAt(todo({ dueAt: null }), 0), null);
  });

  test('Never reminded: ranked first according to the remaining amount at the moment of creation (not according to the current remaining amount)', () => {
    const dueAt = 10 * HOUR;
    // The creation time is about 10 hours before expiration → 4 hours → the first time is scheduled 4 hours after creation
    const at = nextReminderAt(todo({ createdAt: 1000, dueAt }), dueAt - 5 * HOUR);
    assert.equal(at, 1000 + 4 * HOUR);
  });

  test('Remindered: Recalculate the interval from the last reminder time', () => {
    const dueAt = 10 * HOUR;
    const lastRemindedAt = dueAt - 4 * HOUR;
    const at = nextReminderAt(todo({ createdAt: 0, dueAt, lastRemindedAt }), dueAt - 3 * HOUR);
    assert.equal(at, lastRemindedAt + HOUR);
  });

  test('The remaining time is shorter than the state interval → take the remaining time (will not be later than expiration)', () => {
    const dueAt = 2 * MINUTE;
    assert.equal(nextReminderAt(todo({ createdAt: 0, dueAt }), 0), dueAt);
    assert.equal(nextReminderAt(todo({ createdAt: 0, dueAt: 16 * MINUTE }), 0), 16 * MINUTE);
    // Expiration is less than one position: the first time is at the moment of expiration
    assert.equal(nextReminderAt(todo({ createdAt: 0, dueAt: 60 * 1000 }), 0), 60 * 1000);
  });

  test('Expired when created → The first time is reached immediately', () => {
    const createdAt = 1000;
    const dueAt = 0;
    const at = nextReminderAt(todo({ createdAt, dueAt }), createdAt);
    assert.equal(at, createdAt);
  });

  test('After the forward matter enters the 7-day window: it will be made up during the next inspection', () => {
    const dueAt = 30 * DAY;
    const now = dueAt - 6 * DAY;
    const at = nextReminderAt(todo({ createdAt: 0, dueAt }), now);
    assert.ok(at !== null && at <= now, 'You should make up for it immediately after entering the reminder window.');
  });

  test('Overdue but never reminded → Arrive immediately (if the inspection misses the first reminder, it will not be postponed until 30 minutes later)', () => {
    const dueAt = 74 * 1000;
    const at = nextReminderAt(todo({ createdAt: 0, dueAt }), dueAt + 16 * 1000);
    assert.ok(at !== null && at <= dueAt + 16 * 1000, 'Overdue reminders must be completed');
  });

  test('Overdue and reminded → Continue according to the overdue level (30 minutes)', () => {
    const dueAt = 1000;
    const last = dueAt + 1000;
    assert.equal(nextReminderAt(todo({ createdAt: 0, dueAt, lastRemindedAt: last }), dueAt + 2000), last + 30 * MINUTE);
  });

  test('Alert stage has passed → null', () => {
    assert.equal(nextReminderAt(todo({ dueAt: 1000 }), 1000 - 8 * DAY), null);
  });
});

describe('pickReminder —— Only pick the most urgent one in one shot', () => {
  test('Only pick things that have reached the point and don’t do anything about the future to-dos', () => {
    const now = 100 * HOUR;
    // Both items were created two hours ago: 5 hours/2 hours before expiration, and the stalls are both 1 hour, so they have reached the end.
    const later = todo({ id: 'later', dueAt: now + 5 * HOUR, createdAt: now - 2 * HOUR });
    const due = todo({ id: 'due', dueAt: now + 2 * HOUR, createdAt: now - 2 * HOUR });
    const picked = pickReminder([later, due], now);
    assert.equal(picked?.todo.id, 'due');
  });

  test('When tied, the order of expiration will be followed (more urgent priority will be given)', () => {
    const now = 100 * HOUR;
    // Both items were reminded one hour ago, and the time until expiration is 2 hours / 1.5 hours respectively. The states are both 1 hour → the next time will be now.
    const a = todo({ id: 'a', dueAt: now + 2 * HOUR, createdAt: now - HOUR, lastRemindedAt: now - HOUR });
    const b = todo({ id: 'b', dueAt: now + 1.5 * HOUR, createdAt: now - HOUR, lastRemindedAt: now - HOUR });
    const picked = pickReminder([a, b], now);
    assert.equal(picked?.todo.id, 'b');
  });

  test('Not to the point → null', () => {
    const now = 100 * HOUR;
    assert.equal(pickReminder([todo({ dueAt: now + DAY, createdAt: now })], now), null);
  });
});

describe('spanText / truncateTodoText / reminderText', () => {
  test('The duration is written in human words, and the minimum unit is 1 minute.', () => {
    assert.equal(spanText(0), '1分钟');
    assert.equal(spanText(25 * MINUTE), '25分钟');
    assert.equal(spanText(2 * HOUR), '2小时');
    assert.equal(spanText(3 * DAY), '3天');
  });

  test('The text is truncated according to code points and ellipses are added.', () => {
    assert.equal(truncateTodoText('交周报', 10), '交周报');
    assert.equal(truncateTodoText('一二三四五', 3), '一二三…');
  });

  test('There are two options: unexpired and overdue', () => {
    const dueAt = 10 * HOUR;
    assert.equal(reminderText(todo({ dueAt }), dueAt - 2 * HOUR), '「交周报」还有2小时就到点啦');
    assert.equal(reminderText(todo({ dueAt }), dueAt + 2 * HOUR), '「交周报」已经逾期2小时啦，记得处理');
  });

  test("Less than a minute after o'clock: say \"it's time\", don't say it's overdue", () => {
    const dueAt = 10 * HOUR;
    assert.equal(reminderText(todo({ dueAt }), dueAt + 10 * 1000), '「交周报」到点啦，记得处理');
  });

  test('Very long text is truncated in the reminder', () => {
    const text = '一二三四五六七八九十甲乙丙丁戊己庚辛壬癸';
    const dueAt = 10 * HOUR;
    const said = reminderText(todo({ text, dueAt }), dueAt - HOUR);
    assert.ok(!said.includes(text), 'Reminders should not bring out the complete text');
    assert.ok(said.includes('…'));
  });
});
