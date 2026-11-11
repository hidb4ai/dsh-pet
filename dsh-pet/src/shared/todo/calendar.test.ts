/**
 * Calendar grid (src/shared/todo/calendar.ts): Monday is the first column, filling the whole week, and the month marks
 * before and after are out.
 *
 * Only pure calculations are covered; interaction and rendering of selectors are subject to manual acceptance.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { monthCells } from './calendar.ts';

/** Write the grid as `YYYY-MM-DD`, and the assertion is easier to read than the date competition Date. */
function days(year: number, month: number): string[] {
  return monthCells(year, month).map((cell) => {
    const d = cell.date;
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${mm}-${dd}`;
  });
}

describe('monthCells ——How many rows are there in a month?', () => {
  test('October 2026: The 1st is Thursday, fill in 3 spaces for the previous month, a total of 5 lines', () => {
    const list = days(2026, 9);
    assert.equal(list.length, 35, 'Should be 5 rows × 7 columns');
    assert.equal(list[0], '2026-09-28', 'The first digit should be the last Monday of the previous month');
    assert.equal(list[34], '2026-11-01', 'The last square should be the first Sunday of the next month');
  });

  test('August 2026: 6 weeks, 42 spaces filled', () => {
    const list = days(2026, 7);
    assert.equal(list.length, 42, 'Should be 6 rows × 7 columns');
    assert.equal(list[0], '2026-07-27');
    assert.equal(list[41], '2026-09-06');
  });

  test('February 2026: The 1st is Sunday, the whole line is added in front', () => {
    const list = days(2026, 1);
    assert.equal(list.length, 35);
    assert.equal(list[0], '2026-01-26', 'Sunday falls in the last column, fill up 6 spaces in front');
  });

  test('out only marks the grid before and after the month', () => {
    const cells = monthCells(2026, 9);
    assert.equal(
      cells.filter((cell) => cell.out).length,
      3 + 1,
      '3 squares for the previous month + 1 square for the next month',
    );
    assert.ok(
      cells.slice(3, 34).every((cell) => !cell.out),
      'out should not be marked on 31 days of this month',
    );
  });

  test('Each row is a whole week: the number of columns is always 7, and the first column is Monday', () => {
    for (let month = 0; month < 12; month++) {
      const cells = monthCells(2026, month);
      assert.equal(cells.length % 7, 0, `The calendar for month ${month + 1} must contain complete weeks`);
      assert.equal(cells[0]?.date.getDay(), 1, `The first calendar cell for month ${month + 1} must be Monday`);
    }
  });
});
