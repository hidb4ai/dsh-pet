/**
 * Date conversion: determine the day of the year, lunar month and day, and New Year’s Eve.
 *
 * Rely on the Chinese lunar calendar of ICU (not using third-party libraries), see lunarPartsOf for the accuracy
 * boundary. Must always be true: return undefined when the lunar calendar is not available, do not guess an
 * approximate value.
 * @module dsh-pet/src/host/time-context/lunar
 */
import { DAY_MS } from './constants.ts';
import { LUNAR_EVE, LUNAR_INDEX, SOLAR_INDEX } from './entries.ts';
import type { LunarParts, RankedEntry } from './entries.ts';

/** ICU Chinese lunar calendar formatter; null = This environment has been determined to be unavailable (no retrying, no error thrown). */
let lunarFormatter: Intl.DateTimeFormat | null | undefined;

/**
 * Get the ICU lunar calendar formatter. Intl will not throw an error when the calendar is missing, but will silently
 * return to the Gregorian calendar - that will make each month be regarded as the same month and day in the lunar
 * calendar, so use resolvedOptions(). calendar to confirm that it is really parsed into 'chinese', otherwise it will
 * be unavailable.
 */
function getLunarFormatter(): Intl.DateTimeFormat | undefined {
  if (lunarFormatter === null) return undefined;
  if (!lunarFormatter) {
    const fmt = new Intl.DateTimeFormat('en-u-ca-chinese', { month: 'numeric', day: 'numeric', year: 'numeric' });
    lunarFormatter = fmt.resolvedOptions().calendar === 'chinese' ? fmt : null;
  }
  return lunarFormatter ?? undefined;
}

/** Day serial number in the year (starting from 0, calculated according to UTC, leap year is naturally correct) - use it for holiday interval comparison. */
export function dayOfYear(date: Date): number {
  return (Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - Date.UTC(date.getFullYear(), 0, 1)) / DAY_MS;
}

/** 'month-day' → day number (starting from 0) in the year. */
export function dayOfYearOf(year: number, monthDay: string): number {
  const [month, day] = monthDay.split('-').map(Number);
  return (Date.UTC(year, (month ?? 1) - 1, day ?? 1) - Date.UTC(year, 0, 1)) / DAY_MS;
}

/**
 * Gregorian calendar date → lunar calendar month and day.
 *
 * Known accuracy bounds (evaluated and accepted): New moon time is close to UTC +8. At midnight, ICU will put the
 * first day of the lunar calendar on the wrong day - 2 of the 445 starting points of the 2025–2060 months are wrong,
 * both are the first month (2027-02-06 is 8 minutes from midnight, 2030-02-03 is 5 minutes from midnight), which is
 * expressed as The Spring Festival and the Lantern Festival are each one day apart in the two years; one case in 2027
 * has been checked with the official comparison table of the Hong Kong Observatory. To be absolutely accurate, you
 * only need to replace the implementation of this function (change the library or add a correction table), and no line
 * of downstream logic needs to be changed.
 * @returns lunar month/day (leap month month is negative); the environment does not support the lunar calendar, the
 * month and day cannot be obtained, or the lunar year does not match the Gregorian calendar year
 * (Self-consistent verification: the lunar year can only be the current year or the previous year, preventing the
 * Gregorian calendar from returning to the lunar calendar when ICU degenerates) → undefined.
 */
function lunarPartsOf(date: Date): LunarParts | undefined {
  const fmt = getLunarFormatter();
  if (!fmt) return undefined;
  const parts = fmt.formatToParts(date);
  const pick = (type: string): string | undefined => parts.find((p) => p.type === type)?.value;
  const rawMonth = pick('month');
  const rawDay = pick('day');
  const rawYear = pick('relatedYear') ?? pick('year');
  if (!rawMonth || !rawDay || !rawYear) return undefined;
  const month = Number.parseInt(rawMonth, 10);
  const day = Number.parseInt(rawDay, 10);
  const year = Number.parseInt(rawYear, 10);
  if (!Number.isFinite(month) || !Number.isFinite(day) || !Number.isFinite(year)) return undefined;
  const gregorianYear = date.getFullYear();
  // The lunar year will only be the current year or the previous year (January to February before the Spring Festival is still the previous lunar year)
  if (year !== gregorianYear && year !== gregorianYear - 1) return undefined;
  return { month: /bis/i.test(rawMonth) ? -month : month, day };
}

/** Is it New Year's Eve (the last day of the twelfth lunar month: it is established that the next day is the first day of the first lunar month, and it can be recognized on the 29th and 30th). */
function isLunarEve(date: Date): boolean {
  const today = lunarPartsOf(date);
  if (!today || today.month !== 12) return false;
  const next = lunarPartsOf(new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1));
  return Boolean(next && next.month === 1 && next.day === 1);
}

/** All entries for a certain day (three categories: Gregorian calendar, lunar calendar, and New Year's Eve; holiday intervals are not checked by day and will be processed separately). */
export function entriesAt(date: Date): RankedEntry[] {
  const out: RankedEntry[] = [];
  const solar = SOLAR_INDEX.get(date.getMonth() + 1 + '-' + date.getDate());
  if (solar) out.push(solar);
  const lunar = lunarPartsOf(date);
  // Leap months (month < 0) do not participate in matching: the fifth day of the leap month is not the Dragon Boat Festival
  if (lunar && lunar.month > 0) {
    const hit = LUNAR_INDEX.get(lunar.month + '-' + lunar.day);
    if (hit) out.push(hit);
  }
  if (LUNAR_EVE && isLunarEve(date)) out.push(LUNAR_EVE);
  return out;
}
