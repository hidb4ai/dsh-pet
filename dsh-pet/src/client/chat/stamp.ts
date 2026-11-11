/**
 * Display format of message timestamp.
 *
 * Pure function: `now` is passed in by caller and does not read the clock, which is convenient for testing. Today's
 * message only gives time, add the date earlier - when the chat history spans two days, you can't tell which day it is
 * just by looking at `08:26:46` .
 * @module dsh-pet/src/client/chat/stamp
 */
import type { ChatTranslate } from './runtime.ts';

/** The number of milliseconds in a day; only used to calculate "how many days apart", the date boundary is rounded according to the local time zone. */
const DAY_MS = 24 * 60 * 60 * 1000;

/** Two digits are padded with zeros. */
const pad = (value: number): string => String(value).padStart(2, '0');

/** hour:minute:second. */
const clockOf = (date: Date): string =>
  pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds());

/** Timestamp of local date boundary (00:00 today). */
const startOfDay = (date: Date): number => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

/**
 * timestamp → display text.
 *
 * @param ts - Message timestamp (milliseconds); non-positive numbers are treated as no time.
 * @param now - Current time (milliseconds), injected by caller.
 * @param t - text translation; the date format is given by the dictionary by language, and Chinese is not
 * written in the code.
 * @returns Today `HH:mm:ss` ; Yesterday with "yesterday"; Fill in the month and day in the same year; Fill in the year
 * in the new year.
 */
export function formatStamp(ts: number, now: number, t: ChatTranslate): string {
  if (!Number.isFinite(ts) || ts <= 0) return '';
  const date = new Date(ts);
  const today = new Date(now);
  const days = Math.round((startOfDay(today) - startOfDay(date)) / DAY_MS);
  const clock = clockOf(date);
  if (days <= 0) return clock; // Today (and the "future" caused by clock deviation are treated as today)
  if (days === 1) return t('stampYesterday') + ' ' + clock;
  const monthDay = t('stampMonthDay', { month: date.getMonth() + 1, day: date.getDate() });
  if (date.getFullYear() === today.getFullYear()) return monthDay + ' ' + clock;
  return (
    t('stampFullDate', { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() }) + ' ' + clock
  );
}
