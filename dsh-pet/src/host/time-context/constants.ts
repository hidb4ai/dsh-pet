/**
 * Time period and week: Convert the hours into Chinese time periods, and convert the days of the week into working
 * days/weekends.
 *
 * Pure conversion, excluding holiday table; time always takes the local field of Date (according to the user's time
 * zone). This must always be true: the time periods are consecutive and cover 0–23 points.
 * @module dsh-pet/src/host/time-context/constants
 */

/** Time period copy: One day is divided into 9 levels (see SLOTS for division). */
export type TimeSlot = '凌晨' | '清晨' | '早上' | '上午' | '中午' | '下午' | '傍晚' | '晚上' | '深夜';

/**
 * Period division table: [Start hour, Period], arranged from late to early in the starting hour - when matching, the
 * first bin that does not exceed the current hour is taken. Conventions include starting hours (0–23 full coverage,
 * non-overlapping): 0–4 am, 5–6 am, 7–8 am, 9–10 am, 11–12 noon, 13–16 pm, 17–18 evening, 19–22 pm, 23 late at night.
 */
const SLOTS: ReadonlyArray<readonly [number, TimeSlot]> = [
  [23, '深夜'],
  [19, '晚上'],
  [17, '傍晚'],
  [13, '下午'],
  [11, '中午'],
  [9, '上午'],
  [7, '早上'],
  [5, '清晨'],
  [0, '凌晨'],
];

/** Weekday copy: Index = Date.getDay() (0 = Sunday). */
export const WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'] as const;

/** Number of milliseconds in a day (date arithmetic uses UTC milliseconds to avoid local time zone). */
export const DAY_MS = 86_400_000;

/** Default window: 3 days for warm-up, 1 day for itself, and 3 days for review. */
export const DEFAULT_AHEAD = 3;

export const DEFAULT_SPAN = 1;

export const DEFAULT_AFTER = 3;

/** The window of the holiday period: warm up 3 days in advance, say "it's almost over" at the end 3 days, and reflect on it 3 days after the end. */
export const SEASON_AHEAD = 3;

export const SEASON_ENDING_AHEAD = 3;

export const SEASON_AFTER = 3;

/** Two-digit zero padding (only used for hours and minutes; month/day is deliberately not padded with zeros - writing "February 17th" in Chinese is more natural than "February 17th"). */
export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Hour → Period.
 * @param hour - Number of hours (from Date.getHours(), normal 0–23).
 * @returns corresponds to the time period; out of bounds or NaN (abnormal input) press "early morning" fallback and
 * never throw an error - the prompt word path cannot fail due to time format issues.
 */
export function timeSlotOf(hour: number): TimeSlot {
  for (const [start, slot] of SLOTS) {
    if (hour >= start) return slot;
  }
  return '凌晨';
}

/**
 * Day of the week → working day/weekend (Saturday and Sunday are considered weekends; the same conventions as the
 * bottom balance determination, see balance/deepseek-common.ts).
 * @param day - Date.getDay() (0 = Sunday).
 * @returns "Weekend" (Saturday/Sunday) or "Working Day".
 */
export function dayKindOf(day: number): '工作日' | '周末' {
  return day === 0 || day === 6 ? '周末' : '工作日';
}
