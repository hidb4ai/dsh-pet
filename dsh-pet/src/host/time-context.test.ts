/**
 * Time background unit test - verify injects the line of text at the end of system:
 * - Time period 0–23 hourly mapping (0-4 am / 5-6 am / 7-8 am / 9-10 am / 11-12 noon / 13-16 pm / 17-18 evening /
 * 19-22 evening / late night 23), the minute boundary does not cross the state (04:59 is still early morning, 05:00 is
 * early morning);
 * - Entire row = no zero month and day + zero padded hour and minute + day of the week + period + weekend/working day
 * (Saturday and Sunday, the same conventions as the balance bottom) + optional holiday clause + restrained
 * introductory sentence;
 * - Holiday clauses: before the holiday "It's almost X"/"Tomorrow is X", on the day "Today is X", during the holiday
 * period "It's still X holiday"/"X is the last day of holiday", after the holiday "X has just passed"/"X" It’s over so
 * quickly." Each press their own span / after;
 * - Length: 3 days each for New Year's Day/Dragon Boat Festival/Qingming/Labor Day/Mid-Autumn Festival, 7 days for
 * National Day, 15 days for Spring Festival (New Year's Eve → the 15th day of the first lunar month), 30 days for
 * winter vacation, and 60 days for summer vacation;
 * - When multiple holidays are hit in one day, the PRIORITY array sequence is used to select the first one: 2/14, 2/16
 * New Year's Eve, 3/3 Lantern Festival, 4/1, 5/4, 7/1 summer vacation, 8/19 Chinese Valentine's Day, 12/31 New Year's
 * Eve are all useful examples; the lunar calendar is converted according to ICU, and leap months will not be misjudged
 * (2028 The fifth day of leap May is not the Dragon Boat Festival);
 * - Invalid Date → empty string (never produce "NaN year NaN month"); the date is constructed using
 * `new Date(y, m, d, h, min)` local time, and the assertion does not change with the time zone of the running machine.
 * - ICU downgrade branch is not covered (global Intl needs to be replaced, which will interfere with other use cases);
 * running method: node --experimental-strip-types --test src/host/time-context.test.ts
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { dayKindOf, historyStampOf, timeContextOf, timeSlotOf, type TimeSlot } from './time-context.ts';

/** 0–23 point-by-hour expected period (this must be synchronized when changing the division conventions, otherwise the test will be red) */
const EXPECTED_BY_HOUR: TimeSlot[] = [
  '凌晨',
  '凌晨',
  '凌晨',
  '凌晨',
  '凌晨',
  '清晨',
  '清晨',
  '早上',
  '早上',
  '上午',
  '上午',
  '中午',
  '中午',
  '下午',
  '下午',
  '下午',
  '下午',
  '傍晚',
  '傍晚',
  '晚上',
  '晚上',
  '晚上',
  '晚上',
  '深夜',
];

/** Inject a fixed tail (introduction) into the text - advocate restraint and avoid mentioning time/holidays in every sentence of the model */
const TAIL = '。这只是背景，不必刻意报时，也别句句都提节日——多数时候正常说话就好，真贴切时才顺口带一句。';

/** The assertion injected text contains a clause specifying a holiday (the clause appears with ",..." in the entire line) */
function assertClause(date: Date, clause: string): void {
  const text = timeContextOf(date);
  assert.ok(
    text.includes('，' + clause + '。'),
    `${date.toDateString()} expected to contain " ${clause} ", actual: ${text}`,
  );
}

/** assertion The date does not have any holiday clause (directly followed by a period + introductory sentence after working days/weekends) */
function assertNoClause(date: Date): void {
  assert.match(timeContextOf(date), /(工作日|周末)。这只是背景/);
}

describe('timeSlotOf —— Hour → Period', () => {
  test('0–23 points hourly mapping (all state boundaries are nailed)', () => {
    const actual = Array.from({ length: 24 }, (_, h) => timeSlotOf(h));
    assert.deepEqual(actual, EXPECTED_BY_HOUR);
  });

  test('Out of bounds / NaN → early morning fallback (no error is thrown, the prompt word path cannot fail due to time format)', () => {
    assert.equal(timeSlotOf(-1), '凌晨');
    assert.equal(timeSlotOf(24), '深夜');
    assert.equal(timeSlotOf(Number.NaN), '凌晨');
  });
});

describe('dayKindOf —— week → weekday/weekend', () => {
  test('Saturday (6)/Sunday (0) = weekend, Monday to Friday = working day', () => {
    assert.equal(dayKindOf(0), '周末');
    assert.equal(dayKindOf(6), '周末');
    for (const day of [1, 2, 3, 4, 5]) {
      assert.equal(dayKindOf(day), '工作日');
    }
  });
});

describe('timeContextOf - whole line format (no holiday)', () => {
  test('When there is no holiday, it is a complete line and does not contain a holiday clause.', () => {
    assert.equal(
      timeContextOf(new Date(2026, 4, 12, 15, 4)),
      '【当下】现在是2026年5月12日星期二 15:04，下午，工作日' + TAIL,
    );
  });

  test('Hours and minutes are padded with zeros, but months and days are not padded with zeros.', () => {
    assert.equal(
      timeContextOf(new Date(2026, 5, 5, 9, 7)),
      '【当下】现在是2026年6月5日星期五 09:07，上午，工作日' + TAIL,
    );
  });

  test('Saturday counts as weekend', () => {
    assert.equal(
      timeContextOf(new Date(2026, 4, 9, 23, 59)),
      '【当下】现在是2026年5月9日星期六 23:59，深夜，周末' + TAIL,
    );
  });

  test('Sunday counts as the weekend, and zeros are added every minute on the hour.', () => {
    assert.equal(
      timeContextOf(new Date(2026, 4, 10, 5, 0)),
      '【当下】现在是2026年5月10日星期日 05:00，清晨，周末' + TAIL,
    );
  });

  test('Restraint in the guideline: It is clearly required not to tell the time or mention holidays in every sentence.', () => {
    const text = timeContextOf(new Date(2026, 4, 12, 15, 4));
    assert.ok(text.includes('不必刻意报时'));
    assert.ok(text.includes('也别句句都提节日'));
  });

  test('The minute boundary does not cross the range: 04:59 is still early morning, and 05:00 is already early morning.', () => {
    assert.ok(timeContextOf(new Date(2026, 4, 12, 4, 59)).includes('，凌晨，工作日'));
    assert.ok(timeContextOf(new Date(2026, 4, 12, 5, 0)).includes('，清晨，工作日'));
  });

  test('Minute boundary does not cross: 22:59 is still night, 23:00 is already late at night', () => {
    assert.ok(timeContextOf(new Date(2026, 4, 12, 22, 59)).includes('，晚上，工作日'));
    assert.ok(timeContextOf(new Date(2026, 4, 12, 23, 0)).includes('，深夜，工作日'));
  });

  test('Invalid Date → empty string (without adding the entire line, no NaN garbled code will be generated)', () => {
    assert.equal(timeContextOf(new Date('not a date')), '');
  });
});

describe('Holiday - Single-day holiday (span = 1)', () => {
  test('Today: Today is National Day', () => {
    assertClause(new Date(2026, 9, 1, 12, 0), '今天是国庆节');
  });

  test('The colloquial name for the day: New Year\'s Day: "The first day of the new year"', () => {
    assertClause(new Date(2026, 0, 1, 8, 0), '今天是新年第一天');
  });

  test('New Year’s Eve: It comes before New Year’s Day. 12/31 says New Year’s Eve instead of “Tomorrow is New Year’s Day.”', () => {
    assertClause(new Date(2025, 11, 31, 20, 0), '今天是跨年夜');
  });

  test('Christmas Eve comes before Christmas without leaving any aftertaste: 12/24 talks about Christmas Eve, 12/25 talks about Christmas', () => {
    assertClause(new Date(2025, 11, 24, 20, 0), '今天是平安夜');
    assertClause(new Date(2025, 11, 25, 20, 0), '今天是圣诞节');
  });

  test('+3 / +2 days before the holiday: Children’s Day is coming soon', () => {
    assertClause(new Date(2026, 4, 29, 10, 0), '快要过儿童节了');
    assertClause(new Date(2026, 4, 30, 10, 0), '快要过儿童节了');
  });

  test('+1 day before the holiday: Tomorrow is Children’s Day', () => {
    assertClause(new Date(2026, 4, 31, 10, 0), '明天就是儿童节');
  });

  test('1/2 days after the holiday: Children’s Day has just passed', () => {
    assertClause(new Date(2026, 5, 2, 10, 0), '儿童节刚过完');
    assertClause(new Date(2026, 5, 3, 10, 0), '儿童节刚过完');
  });

  test('Day 3 after the holiday: Children’s Day is over so quickly', () => {
    assertClause(new Date(2026, 5, 4, 10, 0), '儿童节这么快就过完了');
  });

  test('No holiday is injected outside the window (4 days before and after)', () => {
    assertNoClause(new Date(2026, 4, 28, 10, 0));
    assertNoClause(new Date(2026, 5, 5, 10, 0));
  });
});

describe('Festival - personalized length (span > 1, long holidays are divided into three sections)', () => {
  test('7 days of National Day: Beginning → During the holiday → Last day → Aftertaste', () => {
    assertClause(new Date(2026, 9, 1, 10, 0), '今天是国庆节');
    assertClause(new Date(2026, 9, 5, 10, 0), '还在国庆节假期里');
    assertClause(new Date(2026, 9, 7, 10, 0), '国庆节假期最后一天了');
    assertClause(new Date(2026, 9, 8, 10, 0), '国庆节刚过完');
    assertClause(new Date(2026, 9, 10, 10, 0), '国庆节这么快就过完了');
    assertNoClause(new Date(2026, 9, 11, 10, 0));
  });

  test('New Year’s Day 3 days: During the holiday → the last day → aftertaste', () => {
    assertClause(new Date(2026, 0, 2, 10, 0), '还在元旦假期里');
    assertClause(new Date(2026, 0, 3, 10, 0), '元旦假期最后一天了');
    assertClause(new Date(2026, 0, 4, 10, 0), '元旦刚过完');
  });

  test('Tomb Sweeping Day 3 days (roughly 4/4 onwards): Preheating starts on the day after April Fool’s Day', () => {
    assertNoClause(new Date(2026, 3, 2, 10, 0));
    assertClause(new Date(2026, 3, 3, 10, 0), '明天就是清明节');
    assertClause(new Date(2026, 3, 4, 10, 0), '今天是清明节');
    assertClause(new Date(2026, 3, 6, 10, 0), '清明节假期最后一天了');
    assertClause(new Date(2026, 3, 7, 10, 0), '清明节刚过完');
  });

  test('Three days of Labor Day give way to Youth Day: 5/4 talks about Youth Day, 5/5 talks about Labor Day', () => {
    assertClause(new Date(2026, 4, 1, 10, 0), '今天是劳动节');
    assertClause(new Date(2026, 4, 3, 10, 0), '劳动节假期最后一天了');
    assertClause(new Date(2026, 4, 4, 10, 0), '今天是青年节');
    assertClause(new Date(2026, 4, 5, 10, 0), '劳动节刚过完');
  });

  test('3 days of Mid-Autumn Festival: the middle and last day of the holiday', () => {
    assertClause(new Date(2026, 8, 25, 10, 0), '今天是中秋节');
    assertClause(new Date(2026, 8, 26, 10, 0), '还在中秋节假期里');
    assertClause(new Date(2026, 8, 27, 10, 0), '中秋节假期最后一天了');
    // Mid-Autumn Festival after has only 2 days, but its priority is higher than National Day: 9/28 is still the Mid-Autumn Festival, and 9/30 is the eve of National Day.
    assertClause(new Date(2026, 8, 28, 10, 0), '中秋节刚过完');
    assertClause(new Date(2026, 8, 30, 10, 0), '明天就是国庆节');
  });

  test('Mid-Autumn Festival after =2: The aftertaste window ends on the 2nd day (2027 verification)', () => {
    assertClause(new Date(2027, 8, 17, 10, 0), '中秋节假期最后一天了');
    assertClause(new Date(2027, 8, 18, 10, 0), '中秋节刚过完');
    assertClause(new Date(2027, 8, 19, 10, 0), '中秋节刚过完');
    assertNoClause(new Date(2027, 8, 20, 10, 0));
  });

  test('The 15 days of the Spring Festival (the first day of the first lunar month → the fifteenth day of the first lunar month): the whole period is in the flavor of the new year', () => {
    assertClause(new Date(2026, 1, 17, 10, 0), '今天是大年初一');
    assertClause(new Date(2026, 1, 20, 10, 0), '还在春节假期里');
  });

  test('Before the holiday and on the day, "during the holiday" is overridden: 3/2 means that tomorrow is the Lantern Festival, and 3/3 is the day of the Lantern Festival.', () => {
    assertClause(new Date(2026, 2, 2, 10, 0), '明天就是元宵节');
    assertClause(new Date(2026, 2, 3, 10, 0), '今天是元宵节');
  });

  test('The Lantern Festival comes before the Spring Festival: the day and aftertaste of the Lantern Festival belong to the Lantern Festival', () => {
    assertClause(new Date(2026, 2, 4, 10, 0), '元宵节刚过完');
    assertClause(new Date(2026, 2, 5, 10, 0), '元宵节刚过完');
    assertClause(new Date(2026, 2, 7, 10, 0), '明天就是妇女节');
  });
});

describe('Festival - Lunar calendar (ICU conversion)', () => {
  test("New Year's Eve: the last day of the twelfth lunar month (2026 is the 29th of the twelfth lunar month, not the 30th)", () => {
    assertClause(new Date(2026, 1, 16, 12, 0), '今天是除夕');
  });

  test("New Year's Eve ahead =1：2/14 Don't say New Year's Eve, say Valentine's Day", () => {
    assertClause(new Date(2026, 1, 14, 12, 0), '今天是情人节');
  });

  test('Lantern Festival', () => {
    assertClause(new Date(2026, 2, 3, 12, 0), '今天是元宵节');
  });

  test('Dragon Boat Festival (3 days off)', () => {
    assertClause(new Date(2026, 5, 19, 12, 0), '今天是端午节');
    assertClause(new Date(2026, 5, 21, 12, 0), '端午节假期最后一天了');
  });

  test('Mid-Autumn Festival', () => {
    assertClause(new Date(2026, 8, 25, 12, 0), '今天是中秋节');
  });

  test('Laba Festival (January in the Gregorian calendar, the lunar calendar is still in the previous year, and it is said as usual during the winter vacation)', () => {
    assertClause(new Date(2026, 0, 26, 12, 0), '今天是腊八节');
  });

  test('Chinese Valentine’s Day (it’s still a holiday during the summer vacation, so it won’t be overwhelmed by the holidays)', () => {
    assertClause(new Date(2026, 7, 19, 12, 0), '今天是七夕');
  });

  test('Leap months are not misjudged: the fifth day of the leap month in 2028 is not the Dragon Boat Festival, the real Dragon Boat Festival is on 2028-05-28', () => {
    assertClause(new Date(2028, 4, 28, 12, 0), '今天是端午节');
    assertNoClause(new Date(2028, 5, 27, 12, 0)); // The fifth day of leap May: the month is negative and does not participate in matching
  });
});

describe('Holiday period - 30 days for winter vacation / 60 days for summer vacation', () => {
  test('Winter vacation: warm-up → start → during vacation', () => {
    assertClause(new Date(2026, 0, 17, 10, 0), '快要放寒假了');
    assertClause(new Date(2026, 0, 19, 10, 0), '明天就放寒假了');
    assertClause(new Date(2026, 0, 20, 10, 0), '寒假开始了');
    assertClause(new Date(2026, 1, 5, 10, 0), '正在放寒假');
  });

  test('The end of winter vacation (the days between 2028 and 2026 are occupied by the Spring Festival)', () => {
    assertClause(new Date(2028, 1, 18, 10, 0), '寒假快结束了');
    assertClause(new Date(2028, 1, 19, 10, 0), '寒假刚结束');
    assertClause(new Date(2028, 1, 21, 10, 0), '寒假这么快就过完了');
    assertNoClause(new Date(2028, 1, 22, 10, 0));
  });

  test('Summer vacation: warm-up → first day → during vacation', () => {
    // Summer vacation comes before Party Founding Day: 7/1 said "summer vacation has begun" and is no longer suppressed by Party Founding Day.
    assertClause(new Date(2026, 5, 28, 10, 0), '快要放暑假了');
    assertClause(new Date(2026, 5, 30, 10, 0), '明天就放暑假了');
    assertClause(new Date(2026, 6, 1, 10, 0), '暑假开始了');
    assertClause(new Date(2026, 6, 15, 10, 0), '正在放暑假');
  });

  test('End of summer vacation: Ghost Festival first, followed by summer cleanup', () => {
    assertClause(new Date(2026, 7, 27, 10, 0), '今天是中元节');
    assertClause(new Date(2026, 7, 28, 10, 0), '中元节刚过完');
    assertClause(new Date(2026, 7, 31, 10, 0), '暑假刚结束');
    assertClause(new Date(2026, 8, 1, 10, 0), '暑假这么快就过完了');
    assertNoClause(new Date(2026, 8, 2, 10, 0));
  });
});

describe('Festival - priority = array order (the first one speaks first)', () => {
  test('The day before the holiday: 2026-02-14 is Valentine’s Day (there are still 3 days before the Spring Festival)', () => {
    assertClause(new Date(2026, 1, 14, 12, 0), '今天是情人节');
  });

  test('Before the holiday, after the holiday: 2026-02-15 Saying "Tomorrow is New Year\'s Eve"', () => {
    assertClause(new Date(2026, 1, 15, 12, 0), '明天就是除夕');
  });

  test('New Year’s Eve comes before Spring Festival: 2026-02-16 Say New Year’s Eve instead of “Tomorrow is Spring Festival”', () => {
    assertClause(new Date(2026, 1, 16, 12, 0), '今天是除夕');
  });

  test('April Fool’s Day comes before Qingming Festival: 2026-04-01 Talking about April Fool’s Day', () => {
    assertClause(new Date(2026, 3, 1, 12, 0), '今天是愚人节');
  });

  test('The Spring Festival overwhelms the winter vacation: During the winter vacation, the Spring Festival still dominates', () => {
    assertClause(new Date(2026, 1, 18, 12, 0), '还在春节假期里');
  });

  test('Traditional festivals overwhelm summer vacation: 8/19 Chinese Valentine’s Day is about Chinese Valentine’s Day', () => {
    assertClause(new Date(2026, 7, 19, 12, 0), '今天是七夕');
  });

  test('Summer vacation surpasses the anniversary: 7/1 is both Party Founding Day and the first day of summer vacation. Let’s talk about summer vacation.', () => {
    assertClause(new Date(2026, 6, 1, 12, 0), '暑假开始了');
  });
});

describe('historyStampOf - time prefix of historical messages', () => {
  test('In the same year: no zeros are added to the month and day, and zeros are added to the hours and minutes.', () => {
    const at = new Date(2026, 9, 31, 22, 53).getTime();
    assert.equal(historyStampOf(at, new Date(2026, 10, 2, 0, 52)), '10月31日 22:53');
  });

  test('Zero padding for single digit hours/minutes: 09:05 cannot be written as 9:5', () => {
    const at = new Date(2026, 10, 2, 9, 5).getTime();
    assert.equal(historyStampOf(at, new Date(2026, 10, 2, 9, 5)), '11月2日 09:05');
  });

  test('New Year\'s Eve: Bring the year to eliminate the ambiguity of "which year"', () => {
    const at = new Date(2025, 11, 31, 23, 59).getTime();
    assert.equal(historyStampOf(at, new Date(2026, 0, 1, 0, 30)), '2025年12月31日 23:59');
  });

  test('ts is invalid (NaN / out of bounds) → empty string, the caller does not send a prefix accordingly', () => {
    assert.equal(historyStampOf(Number.NaN, new Date(2026, 10, 2)), '');
    assert.equal(historyStampOf(Number.POSITIVE_INFINITY, new Date(2026, 10, 2)), '');
  });

  test('now invalid → empty string (without "now", it is impossible to determine whether it is New Year\'s Eve)', () => {
    assert.equal(historyStampOf(new Date(2026, 9, 31).getTime(), new Date('nope')), '');
  });
});
