/**
 * Text assembly: spell the hit festivals, solar terms and time periods into one sentence, and also provide the
 * time prefix for historical news.
 *
 * Do not read clock, do not touch IO; candidate provided by ./lunar. This must always be true: multiple calls on the
 * same date will produce consistent results, regardless of the order of calls.
 * @module dsh-pet/src/host/time-context/context
 */
import { MAX_AHEAD, MAX_LOOKBACK, SEASON_ENTRIES } from './entries.ts';
import type { Candidate, Entry, RankedEntry } from './entries.ts';
import {
  DEFAULT_AFTER,
  DEFAULT_AHEAD,
  DEFAULT_SPAN,
  SEASON_AFTER,
  SEASON_AHEAD,
  SEASON_ENDING_AHEAD,
  WEEKDAYS,
  dayKindOf,
  pad2,
  timeSlotOf,
} from './constants.ts';
import { dayOfYear, dayOfYearOf, entriesAt } from './lunar.ts';

/**
 * Phase → clause wording.
 * @param entry - holiday entry; `name` / `spoken` / `span` determine wording and default window.
 * @param delta - Number of days relative to the start day of the festival: > 0 = there are so many days left; 0 = the
 * start day; < 0 = already within or after the festival.
 */
function phraseOf(entry: Entry, delta: number): string {
  const span = entry.span ?? DEFAULT_SPAN;
  if (delta > 0) return delta === 1 ? '明天就是' + entry.name : '快要过' + entry.name + '了';
  if (delta === 0) return '今天是' + (entry.spoken ?? entry.name);
  // During the festival (long holidays are divided into sections to avoid repeating the same sentence for more than ten days): daysIn + 1 day into the festival
  const daysIn = -delta;
  if (daysIn < span) {
    return span - daysIn === 1 ? entry.name + '假期最后一天了' : '还在' + entry.name + '假期里';
  }
  // After the holiday: rest is "the number of days after the end" (starting from 0)
  const rest = daysIn - span;
  return rest <= 1 ? entry.name + '刚过完' : entry.name + '这么快就过完了';
}

/**
 * entry → candidate clause (returns undefined if not within own window).
 * @param ranked - Sorted entries; `priority` highest candidate first.
 * @param delta - The number of days relative to the start of the holiday.
 */
function candidateOf(ranked: RankedEntry, delta: number): Candidate | undefined {
  const { entry, priority } = ranked;
  const ahead = entry.ahead ?? DEFAULT_AHEAD;
  const span = entry.span ?? DEFAULT_SPAN;
  const after = entry.after ?? DEFAULT_AFTER;
  const daysIn = -delta;
  if (delta > 0) {
    if (delta > ahead) return undefined;
  } else if (delta < 0) {
    if (daysIn >= span + after) return undefined;
  }
  return { clause: phraseOf(entry, delta), priority };
}

/** Holiday interval → candidate clause (returns undefined not within the window). */
function seasonCandidateOf(date: Date): Candidate | undefined {
  const year = date.getFullYear();
  const today = dayOfYear(date);
  for (const ranked of SEASON_ENTRIES) {
    const { entry, priority, from: fromMd, to: toMd } = ranked;
    const name = entry.name;
    const from = dayOfYearOf(year, fromMd);
    const to = dayOfYearOf(year, toMd);
    if (today < from) {
      const ahead = from - today;
      if (ahead > SEASON_AHEAD) continue;
      return { clause: ahead === 1 ? '明天就放' + name + '了' : '快要放' + name + '了', priority };
    }
    if (today <= to) {
      if (today === from) return { clause: name + '开始了', priority };
      if (to - today < SEASON_ENDING_AHEAD) return { clause: name + '快结束了', priority };
      return { clause: '正在放' + name, priority };
    }
    const rest = today - to - 1;
    if (rest >= SEASON_AFTER) continue;
    return { clause: rest <= 1 ? name + '刚结束' : name + '这么快就过完了', priority };
  }
  return undefined;
}

/**
 * Festival Clause: Enumerate the items hit by each day in the scanning window, calculate their respective phases and
 * words, and select the one with the smallest priority (the highest in the array).
 * @returns Such as "Today is the first day of the Lunar New Year", "National Day is coming soon", "Still during the
 * Spring Festival holiday", "Summer vacation is on"; when there is no holiday ''.
 */
function holidayClauseOf(date: Date): string {
  let best: Candidate | undefined;
  const keep = (candidate: Candidate | undefined): void => {
    if (candidate && (!best || candidate.priority < best.priority)) best = candidate;
  };
  for (let delta = -MAX_LOOKBACK; delta <= MAX_AHEAD; delta++) {
    const day = new Date(date.getFullYear(), date.getMonth(), date.getDate() + delta);
    for (const ranked of entriesAt(day)) keep(candidateOf(ranked, delta));
  }
  keep(seasonCandidateOf(date));
  return best ? best.clause : '';
}

/**
 * Generate time context (one line) injected at the end of system.
 * @param date - Current time (production caller passes new Date(); test passes fixed date).
 * @returns shaped like
 * `【当下】现在是2026年10月8日星期四 21:32，晚上，工作日，国庆节刚过完。这只是背景，不必刻意报时，也别句句都提节日。` The middle paragraph is omitted when there is no
 * holiday; invalid Date → empty string (caller does not add this line accordingly).
 */
export function timeContextOf(date: Date): string {
  // getFullYear()/ getDay() of invalid Date both return NaN, and direct combination will produce "NaN year NaN month" - explicitly blocked
  if (Number.isNaN(date.getTime())) return '';
  const day = date.getDay();
  const hour = date.getHours();
  const holiday = holidayClauseOf(date);
  return (
    '【当下】现在是' +
    date.getFullYear() +
    '年' +
    (date.getMonth() + 1) +
    '月' +
    date.getDate() +
    '日' +
    (WEEKDAYS[day] ?? '星期?') +
    ' ' +
    pad2(hour) +
    ':' +
    pad2(date.getMinutes()) +
    '，' +
    timeSlotOf(hour) +
    '，' +
    dayKindOf(day) +
    (holiday ? '，' + holiday : '') +
    '。这只是背景，不必刻意报时，也别句句都提节日——多数时候正常说话就好，真贴切时才顺口带一句。'
  );
}

/**
 * The time prefix of historical messages (only for conversation history): `10月31日 22:53` , with the year when crossing
 * the new year.
 *
 * Without square brackets, the caller decides how to package; whether to add a prefix (threshold) is also judged by
 * the caller.
 *
 * @param ts - The sending time of that message (millisecond timestamp, each one in `memory.json` contains).
 * @param now - The current time; when it is different from the sending time, the year is prefixed with the year to
 * eliminate the ambiguity of "which year".
 * When @returns `ts` or `now` is invalid, an empty string is returned (the caller does not add a prefix and sends it
 * as it is).
 */
export function historyStampOf(ts: number, now: Date): string {
  const at = new Date(ts);
  if (Number.isNaN(at.getTime()) || Number.isNaN(now.getTime())) return '';
  const date =
    (at.getFullYear() === now.getFullYear() ? '' : at.getFullYear() + '年') +
    (at.getMonth() + 1) +
    '月' +
    at.getDate() +
    '日';
  return date + ' ' + pad2(at.getHours()) + ':' + pad2(at.getMinutes());
}
