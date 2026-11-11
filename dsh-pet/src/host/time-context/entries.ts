/**
 * Table of holidays and solar terms: entries arranged by priority, and indexes built by date.
 *
 * Pure data and index building. Must always be true: new entries must have the range ahead/after, otherwise the index
 * will miss it.
 * @module dsh-pet/src/host/time-context/entries
 */
import { DEFAULT_AFTER, DEFAULT_AHEAD, DEFAULT_SPAN } from './constants.ts';

/** Public fields for holiday/holiday entries. */
interface EntryBase {
  /** Formal name: Use it before/during/after the festival ("It's almost the Spring Festival", "Still during the Spring Festival holiday") */
  name: string;
  /** Colloquial name of the day: used for "Today is..."; default = use name */
  spoken?: string;
  ahead?: number;
  span?: number;
  after?: number;
}

/** Festival/holiday entry (discrimination combination: Gregorian calendar day/lunar calendar day/New Year's Eve/holiday interval). */
export type Entry = EntryBase &
  (
    | { kind: 'solar'; key: string }
    | { kind: 'lunar'; key: string }
    | { kind: 'lunarEve' }
    | { kind: 'season'; from: string; to: string }
  );

/**
 * Order = priority (the one in front speaks first). There is only one clause per day, so when the same day is covered
 * by multiple festivals/holidays, whoever is at the top of the array will be the one to decide; if you want to change
 * the priority, just move those rows without using logic. There are a few hard constraints: only the short sections
 * worth mentioning on that day should be ranked before those next to you, and the aftertaste should be eliminated; New
 * Year's Eve and Lantern Festival must be ranked before the Spring Festival; winter and summer vacations should be
 * ranked after traditional festivals and before anniversaries - festivals during holidays are still dominated by
 * festivals, and days that collide with anniversaries such as 7/1 are dominated by summer vacations.
 * `ahead / span / after` default 3 / 1 / 3.
 */
const PRIORITY: readonly Entry[] = [
  { kind: 'solar', key: '2-14', name: '情人节', after: 0 }, // Don’t let the 3 days before the Spring Festival eat up the Valentine’s Day
  { kind: 'solar', key: '12-31', name: '跨年夜', after: 0 }, // Before New Year’s Day: 12/31 means New Year’s Eve, 1/1 means New Year’s Day
  { kind: 'solar', key: '4-1', name: '愚人节', after: 0 }, // Arrange before Qingming Festival, otherwise 4/1 will say "Qingming Festival is coming soon"
  { kind: 'solar', key: '5-4', name: '青年节', ahead: 0, after: 0 }, // Arrange before Labor Day, otherwise 5/4 will be overwhelmed by the aftertaste of Labor Day; leave no front and rear windows to avoid grabbing the last day of 5/3

  // ahead:1 → Only warm up on 2/15, so as not to say "New Year's Eve is almost over" on 2/14; after:0 → 2/17 Leave it to the Spring Festival day, do not say "New Year's Eve has just passed"
  { kind: 'lunarEve', name: '除夕', ahead: 1, after: 0 },
  { kind: 'lunar', key: '1-15', name: '元宵节' },
  { kind: 'lunar', key: '1-1', name: '春节', spoken: '大年初一', span: 15 }, // The first day of the first lunar month → the fifteenth day of the first lunar month

  { kind: 'lunar', key: '8-15', name: '中秋节', span: 3, after: 2 }, // The Mid-Autumn Festival holiday lasts for 3 days; the festival is over
  { kind: 'solar', key: '10-1', name: '国庆节', span: 7 }, // National Day holiday 7 days
  { kind: 'solar', key: '1-1', name: '元旦', spoken: '新年第一天', span: 3 }, // New Year's Day holiday 3 days
  { kind: 'lunar', key: '5-5', name: '端午节', span: 3 },
  { kind: 'solar', key: '4-4', name: '清明节', span: 3, ahead: 1 }, // Approximately 3 days from 4/4 (the real date is 4/4 or 4/5); ahead:1 gives up 4/1–4/2 for April Fool’s Day
  { kind: 'solar', key: '5-1', name: '劳动节', span: 3 },
  { kind: 'solar', key: '6-1', name: '儿童节' },

  { kind: 'lunar', key: '7-7', name: '七夕' },
  { kind: 'lunar', key: '7-15', name: '中元节' },
  { kind: 'lunar', key: '2-2', name: '龙抬头' },
  { kind: 'lunar', key: '9-9', name: '重阳节' },
  { kind: 'lunar', key: '12-8', name: '腊八节' },
  { kind: 'lunar', key: '12-23', name: '小年' },

  { kind: 'season', from: '1-20', to: '2-18', name: '寒假' }, // 30 days
  { kind: 'season', from: '7-1', to: '8-29', name: '暑假' }, // 60 days

  { kind: 'solar', key: '3-8', name: '妇女节' },
  { kind: 'solar', key: '9-10', name: '教师节' },
  { kind: 'solar', key: '7-1', name: '建党节' },
  { kind: 'solar', key: '8-1', name: '建军节' },
  { kind: 'solar', key: '10-31', name: '万圣夜' },
  // Christmas Eve comes before Christmas (12/24 is Christmas Eve), after:0, let’s not eat up the Christmas day on 12/25 with the aftertaste
  { kind: 'solar', key: '12-24', name: '平安夜', after: 0 },
  { kind: 'solar', key: '12-25', name: '圣诞节' },
];

/** Entry with priority (priority = index in PRIORITY, the smaller the priority). */
export interface RankedEntry {
  entry: Entry;
  priority: number;
}

/** Index of Gregorian calendar/lunar calendar/New Year's Eve/holiday interval (create once by PRIORITY when loading the module). */
export const SOLAR_INDEX = new Map<string, RankedEntry>();

export const LUNAR_INDEX = new Map<string, RankedEntry>();

export const SEASON_ENTRIES: Array<RankedEntry & { from: string; to: string }> = [];

export let LUNAR_EVE: RankedEntry | undefined;

PRIORITY.forEach((entry, priority) => {
  if (entry.kind === 'solar') SOLAR_INDEX.set(entry.key, { entry, priority });
  else if (entry.kind === 'lunar') LUNAR_INDEX.set(entry.key, { entry, priority });
  else if (entry.kind === 'lunarEve') LUNAR_EVE = { entry, priority };
  else SEASON_ENTRIES.push({ entry, priority, from: entry.from, to: entry.to });
});

/** Candidate clauses (along with precedence) */
export interface Candidate {
  clause: string;
  priority: number;
}

/** Lunar month and day (ICU conversion result) */
export interface LunarParts {
  /** Lunar months: 1–12; leap months are negative (leap June = -6) to distinguish them from ordinary months */
  month: number;
  /** Lunar days: 1–30 */
  day: number;
}

/** The longest number of warm-up days and review distance in the entry (15 days for long vacation + 3 days for review) are used to determine the scanning window. */
const HOLIDAY_ENTRIES = PRIORITY.filter((e) => e.kind !== 'season');

export const MAX_AHEAD = Math.max(...HOLIDAY_ENTRIES.map((e) => e.ahead ?? DEFAULT_AHEAD));

export const MAX_LOOKBACK = Math.max(
  ...HOLIDAY_ENTRIES.map((e) => (e.span ?? DEFAULT_SPAN) - 1 + (e.after ?? DEFAULT_AFTER)),
);
