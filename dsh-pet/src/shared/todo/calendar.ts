/**
 * Pure calculation of calendar grid: arrange 7 columns and rows of a certain year and month, and which grids belong to
 * the preceding and following months.
 *
 * Do not touch DOM and the current time; the column offset and padding rules calculated from Monday are tested by
 * verify .
 * @module dsh-pet/src/shared/todo/calendar
 */

/** Calendar grid: a 7-column grid for a certain month of a certain year, including the preceding and following months. */
export interface MonthCell {
  /** The date corresponding to this box; it may belong to the previous/next month. */
  readonly date: Date;
  /** Does it not belong to this month (rendered in light color). */
  readonly out: boolean;
}

/**
 * The calendar grid of a certain month: starting from Monday and filling up the last whole week.
 *
 * @param year - Four digit year.
 * @param month - Month starting from 0.
 * @returns A row-major grid whose length is a multiple of 7 (usually 5 rows, 6 rows across a 6-week month).
 */
export function monthCells(year: number, month: number): MonthCell[] {
  const first = new Date(year, month, 1);
  // Sunday in getDay is 0, here it is replaced by the column offset of "counting on Monday".
  const lead = (first.getDay() + 6) % 7;
  const days = new Date(year, month + 1, 0).getDate();
  const rows = Math.ceil((lead + days) / 7);
  const cells: MonthCell[] = [];
  for (let i = 0; i < rows * 7; i++) {
    const date = new Date(year, month, 1 - lead + i);
    cells.push({ date, out: date.getMonth() !== month });
  }
  return cells;
}
