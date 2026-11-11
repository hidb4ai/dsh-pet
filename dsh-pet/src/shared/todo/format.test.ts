/**
 * Unit test for to-do display formatting: expiration statement, relative remaining, urgency and `datetime-local`
 * conversion.
 *
 * All use cases are constructed using local time (`new Date(y, m, d, h, min)`), so running in different time zones is
 * stable. Running method: node --experimental-strip-types --test src/shared/todo/format.test.ts
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  dueLabel,
  formatDateTimeLocal,
  metaLabel,
  parseDateTimeLocal,
  remainingLabel,
  spanText,
  todoUrgency,
} from './format.ts';
import type { TodoItem } from './types.ts';

/** Base time: 2026-10-29 (Thursday) 09:30 local time. */
const NOW = new Date(2026, 9, 29, 9, 30).getTime();

/** Create a to-do: only cover the fields of concern for formatting. */
function todo(overrides: Partial<TodoItem> = {}): TodoItem {
  return {
    id: 'todo-1',
    text: '交周报',
    dueAt: null,
    done: false,
    createdAt: NOW,
    updatedAt: NOW,
    completedAt: null,
    ...overrides,
  };
}

describe('spanText ——The duration is written in adult language', () => {
  test('minutes / hours / days, minimum one minute', () => {
    assert.equal(spanText(0), '1分钟');
    assert.equal(spanText(25 * 60 * 1000), '25分钟');
    assert.equal(spanText(2 * 60 * 60 * 1000), '2小时');
    assert.equal(spanText(3 * 24 * 60 * 60 * 1000), '3天');
  });
});

describe('dueLabel——Absolute statement', () => {
  test('No expiration date', () => {
    assert.equal(dueLabel(null, NOW), '无期限');
  });

  test('Today/tomorrow/the day after tomorrow/within this week/further', () => {
    assert.equal(dueLabel(new Date(2026, 9, 29, 18, 0).getTime(), NOW), '今天 18:00');
    assert.equal(dueLabel(new Date(2026, 9, 30, 9, 0).getTime(), NOW), '明天 09:00');
    assert.equal(dueLabel(new Date(2026, 9, 31, 8, 5).getTime(), NOW), '后天 08:05');
    // 2026-11-02 is Monday (same week after Thursday 10-29)
    assert.equal(dueLabel(new Date(2026, 10, 2, 8, 0).getTime(), NOW), '周一 08:00');
    assert.equal(dueLabel(new Date(2026, 10, 8, 8, 0).getTime(), NOW), '11月8日 08:00');
  });
});

describe('remainingLabel - relative statement', () => {
  test('Not expired / Overdue / No expiration date', () => {
    assert.equal(remainingLabel(NOW + 90 * 60 * 1000, NOW), '还剩2小时');
    assert.equal(remainingLabel(NOW - 2 * 60 * 60 * 1000, NOW), '已逾期2小时');
    assert.equal(remainingLabel(null, NOW), '');
  });
});

describe('todoUrgency —— Urgency', () => {
  test('Unlimited / Overdue / Within 6 hours / Within 24 hours / Further', () => {
    assert.equal(todoUrgency(null, NOW), 'undated');
    assert.equal(todoUrgency(NOW - 1, NOW), 'overdue');
    assert.equal(todoUrgency(NOW + 5 * 60 * 60 * 1000, NOW), 'soon');
    assert.equal(todoUrgency(NOW + 20 * 60 * 60 * 1000, NOW), 'today');
    assert.equal(todoUrgency(NOW + 3 * 24 * 60 * 60 * 1000, NOW), 'later');
  });
});

describe('metaLabel —— List subtitle', () => {
  test('Unfinished: absolute + relative; overdue, only relative', () => {
    const dueAt = new Date(2026, 9, 29, 17, 30).getTime();
    assert.equal(metaLabel(todo({ dueAt }), NOW), '今天 17:30 · 还剩8小时');
    assert.equal(metaLabel(todo({ dueAt: NOW - 2 * 60 * 60 * 1000 }), NOW), '已逾期2小时');
    assert.equal(metaLabel(todo(), NOW), '无期限');
  });

  test('Completed: statement in underlined state', () => {
    const dueAt = new Date(2026, 9, 29, 17, 30).getTime();
    assert.equal(metaLabel(todo({ dueAt, done: true }), NOW), '已完成 · 今天 17:30');
    assert.equal(metaLabel(todo({ done: true }), NOW), '已完成');
  });
});

describe('datetime-local mutual conversion', () => {
  test('Formatted zero padding, minute precision', () => {
    assert.equal(formatDateTimeLocal(new Date(2026, 9, 29, 9, 5).getTime()), '2026-10-29T09:05');
  });

  test('Parse back to the same time; it can also be read with seconds', () => {
    const ms = new Date(2026, 9, 29, 9, 5).getTime();
    assert.equal(parseDateTimeLocal('2026-10-29T09:05'), ms);
    assert.equal(parseDateTimeLocal('2026-10-29T09:05:30'), ms);
  });

  test('Empty string / invalid format / non-existent date → null', () => {
    assert.equal(parseDateTimeLocal(''), null);
    assert.equal(parseDateTimeLocal('明天'), null);
    assert.equal(parseDateTimeLocal('2026-02-30T09:00'), null);
    assert.equal(parseDateTimeLocal('2026-13-01T09:00'), null);
  });
});
