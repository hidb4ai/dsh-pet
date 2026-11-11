/**
 * Timestamp formatting: only give the time today, add the date earlier, and add the year across years.
 *
 * The time is all injected by parameters and does not rely on the real clock.
 *
 * Running method: node --experimental-strip-types --test src/client/chat/stamp.test.ts
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { formatStamp } from './stamp.ts';
import type { ChatTranslate } from './runtime.ts';
import { zh } from './locales/zh.ts';

/** Chinese pile: The date template is taken from the dictionary, and the parameters are replaced according to the `{name}` rule. */
const t = ((key: string, params?: Record<string, unknown>) => {
  const text = (zh as Record<string, string>)[key] ?? key;
  return text.replace(/\{(\w+)\}/g, (_match: string, name: string) => String(params?.[name] ?? ''));
}) as unknown as ChatTranslate;

/** Construct a timestamp using local time to avoid miscalculating "what time" due to time zone. */
const at = (year: number, month: number, day: number, hour = 0, minute = 0, second = 0): number =>
  new Date(year, month - 1, day, hour, minute, second).getTime();

describe('formatStamp ——Message time display', () => {
  const NOW = at(2026, 10, 28, 8, 27, 0);

  test('Today → Give only hours, minutes and seconds', () => {
    assert.equal(formatStamp(at(2026, 10, 28, 8, 26, 46), NOW, t), '08:26:46');
  });

  test('yesterday → prefix "yesterday"', () => {
    assert.equal(formatStamp(at(2026, 10, 27, 23, 5, 9), NOW, t), '昨天 23:05:09');
  });

  test('earlier in the same year → supplementary month day', () => {
    assert.equal(formatStamp(at(2026, 3, 1, 9, 0, 0), NOW, t), '3月1日 09:00:00');
  });

  test('New year → make up the year', () => {
    assert.equal(formatStamp(at(2025, 12, 31, 23, 59, 0), NOW, t), '2025年12月31日 23:59:00');
  });

  test('No time (0 / invalid) → empty string', () => {
    assert.equal(formatStamp(0, NOW, t), '');
    assert.equal(formatStamp(Number.NaN, NOW, t), '');
  });
});
