/**
 * Contract test for the balance "unavailable" path: there must be visible feedback, and only one judgment is made at
 * both ends (browser overlay / desktop shell).
 *
 * Background: `/dsh-pet-7340/balance` returns `{ ok:false, reason:'unsupported' }` (HTTP 200) for unregistered service
 * providers. If the client strictly requires `balance.ok` and bubbles to be driven only by tick with "successfully
 * pulled" at the rendering point, there will be no response at all on the page: no animation will be played, no
 * bubbles will be played, and even console will not be played. Now src/shared and decideBalanceNotice uniformly
 * determine whether to pop up or not (explicit requests must pop up; automatic polling only pops up once when the
 * reason changes), and both ends are only responsible for drawing the row data.
 *
 * This document verifies four things: ① The copy of the unavailable state (including provider / certificate name, and
 * no blank lines, no double "missing certificate" prefix); ② Pop-up window judgment (explicit vs automatic, cause
 * change, ok status cleared); ③ Three windows of commandcode (cap Participate in the "most urgent window"
 * determination and do not add 0 when there is no window limit) The same set of conventions as opencode; ④ Source code
 * level guard - client rendering must no longer require balance.ok (it has React/DOM dependencies and can only read
 * the source code assertion).
 *
 * Use Node to build test runner (node:test) without introducing any npm dependencies.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  balanceBubbleView,
  balanceDetailView,
  balancePageCount,
  balancePageView,
  balancePercent,
  customClickable,
  customViews,
  decideBalanceNotice,
  toBalanceState,
  urgentWindow,
  CUSTOM_LIMITS,
  type BalanceState,
  type BalanceView,
  type CustomBalance,
} from './balance/index.ts';

/** Source code of files in the package (for guarding; relative to src/shared / parsing) */
const readSource = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

/** The prompt key saved after an "automatic polling" (equivalent to lastKey saved by the caller) */
const rememberedKey = (state: BalanceState): string | null => decideBalanceNotice(state, null, false).key;

const unsupported: BalanceState = { provider: 'unregistered-provider', ok: false, reason: 'unsupported' };

describe('balanceBubbleView - The unavailable status must be given a readable text description', () => {
  test('unsupported: Report "not supported" + current service provider id (easy to self-check who it is)', () => {
    assert.deepEqual(balanceBubbleView(unsupported), [
      { role: 'error', text: '当前服务商暂不支持余额查询' },
      { role: 'sub', text: '当前服务商：unregistered-provider' },
    ]);
  });

  test('credential-missing: message of host has been prefixed and is no longer superimposed (no double "missing certificate")', () => {
    const rows = balanceBubbleView({
      provider: 'deepseek-official',
      ok: false,
      reason: 'credential-missing',
      message: '缺少凭证 DEEPSEEK_API_KEY',
    });
    assert.deepEqual(rows, [
      { role: 'error', text: '缺少余额查询凭证' },
      { role: 'sub', text: '缺少凭证 DEEPSEEK_API_KEY' },
    ]);
    assert.equal(
      rows.filter((r) => r.text.includes('缺少凭证')).length,
      1,
      '"Missing Credentials" should only appear once (used to be "Missing Credentials: Missing Credentials X")',
    );
  });

  test('fetch-error: Main row fixed copy + secondary behavior underlying error; no blank row will be left when message is missing', () => {
    assert.deepEqual(
      balanceBubbleView({ provider: 'deepseek-official', ok: false, reason: 'fetch-error', message: 'HTTP 401' }),
      [
        { role: 'error', text: '余额查询失败' },
        { role: 'sub', text: 'HTTP 401' },
      ],
    );
    assert.deepEqual(balanceBubbleView({ provider: 'deepseek-official', ok: false, reason: 'fetch-error' }), [
      { role: 'error', text: '余额查询失败' },
    ]);
  });

  test('The successful path is not affected (opencode two lines / deepseek single line including peak and valley states)', () => {
    // Take the most urgent (least remaining) among the three windows: weekly 75% remaining 7.5 USD least → "75% of the weekly quota has been used"
    const rows = balanceBubbleView({
      provider: 'opencode-go',
      ok: true,
      shape: 'windows',
      rolling: 10,
      rollingCapUsd: 12,
      weekly: 75,
      weeklyCapUsd: 30,
      monthly: 20,
      monthlyCapUsd: 60,
      rollingLabel: '5h',
    });
    assert.equal(rows[0]?.text, '周额度已用 75%');
    assert.equal(rows[1]?.role, 'sub');

    const ds = balanceBubbleView({
      provider: 'deepseek-official',
      ok: true,
      shape: 'money',
      wallets: [{ currency: 'CNY', total: '8.79', granted: '0.00', toppedUp: '8.79' }],
      tier: 'idle',
    });
    assert.equal(ds[0]?.text, '余额（');
    assert.equal(ds[1]?.role, 'tier'); // Peaks/troughs are brought out by data, here only the structure and amount are nailed
    assert.equal(ds[2]?.text, '）¥8.79');
  });

  test('money: When the service provider does not decorate the stall, the peak and valley will not be compiled, and it will degenerate into "Balance ¥ x.xx"', () => {
    const rows = balanceBubbleView({
      provider: 'some-wallet',
      ok: true,
      shape: 'money',
      wallets: [{ currency: 'CNY', total: '8.79', granted: '0.00', toppedUp: '8.79' }],
    });
    assert.deepEqual(rows, [{ role: 'label', text: '余额 ¥8.79' }]);
  });

  test('windows: The scrolling window display name is brought out by the data, the default fallback is 5 h', () => {
    const base = {
      provider: 'some-windows',
      shape: 'windows' as const,
      ok: true as const,
      rolling: 10,
      monthly: 1,
      monthlyResetsAt: '2999-01-01T00:00:00.000Z',
    };
    assert.equal(urgentWindow(base)?.label, '5h', 'missing rollingLabel → fallback 5 h');
    assert.equal(
      urgentWindow({ ...base, rollingLabel: '24h' })?.label,
      '24h',
      'The window name of data self-reporting takes precedence',
    );
  });

  test('deepseek-account and deepseek-official bubbles are completely isomorphic, only the currency symbol changes according to currency', () => {
    // Official route: CNY → ¥ (existing behavior, unchanged verbatim)
    const official = balanceBubbleView({
      provider: 'deepseek-official',
      ok: true,
      shape: 'money',
      wallets: [{ currency: 'CNY', total: '8.79', granted: '0.00', toppedUp: '8.79' }],
      tier: 'idle',
    });
    // Account route: same shape, same structure
    const account = balanceBubbleView({
      provider: 'deepseek-account',
      ok: true,
      shape: 'money',
      wallets: [{ currency: 'CNY', total: '9.99', granted: '0.00', toppedUp: '9.99' }],
      tier: 'idle',
    });
    assert.deepEqual(
      account.map((r) => r.role),
      official.map((r) => r.role),
      'The row structure at both ends must be consistent bit by bit.',
    );
    assert.equal(account[0]?.text, '余额（');
    assert.equal(account[2]?.text, '）¥9.99');

    // USD wallet: Replace the same position with $ (other words remain unchanged)
    const usd = balanceBubbleView({
      provider: 'deepseek-account',
      ok: true,
      shape: 'money',
      wallets: [{ currency: 'USD', total: '12.50', granted: '0.00', toppedUp: '12.50' }],
      tier: 'idle',
    });
    assert.equal(usd[2]?.text, '）$12.50');
  });
});

describe('decideBalanceNotice - text description of whether to play or not (both ends share the same judgment)', () => {
  test('ok status: Do not play, and clear key (the next unavailability will be regarded as a new reason)', () => {
    assert.deepEqual(
      decideBalanceNotice(
        { provider: 'opencode-go', ok: true, shape: 'windows', rolling: 1, weekly: 2, monthly: 3 },
        'unsupported:unregistered-provider',
        false,
      ),
      { show: false, key: null },
    );
  });

  test('Automatic polling: If it is unavailable for the first time, it will be polled (lastKey = null). It will not be polled again for the same reason.', () => {
    const first = decideBalanceNotice(unsupported, null, false);
    assert.deepEqual(first, { show: true, key: 'unsupported:unregistered-provider' });
    assert.equal(
      decideBalanceNotice(unsupported, first.key, false).show,
      false,
      'No repeated interruptions for the same reason',
    );
  });

  test('Automatic polling: If the reason changes, it will be polled again; changing to another unregistered service provider will also count as a change.', () => {
    assert.equal(decideBalanceNotice(unsupported, 'credential-missing:deepseek-official', false).show, true);
    assert.equal(
      decideBalanceNotice(
        { provider: 'openrouter', ok: false, reason: 'unsupported' },
        rememberedKey(unsupported),
        false,
      ).show,
      true,
    );
  });

  test('Explicit requests (/ balance, desktop "View Balance"): always play, not affected by deduplicate', () => {
    assert.equal(decideBalanceNotice(unsupported, rememberedKey(unsupported), true).show, true);
  });
});

describe('Source Guard - Unavailable status must no longer be silently discarded', () => {
  test('Browser overlay: The rendering department is no longer allowed to request balance.ok, and the bubble is driven by noticeTick, and the judgment comes from shared', () => {
    // The rendering entry point and command processing are separated into two files: the bubble is in pet.ts, and the judgment when pressing tick is in card/cue-effects.ts.
    const clientPet = readSource('../client/pet.ts') + '\n' + readSource('../client/pet/card/cue-effects.ts');
    assert.ok(
      !/balance\.ok\s*&&\s*cfg\.balanceEnabled/.test(clientPet),
      'The balance bubble can no longer be requested balance.ok: That is the root cause of "the unregistered service provider has no response at all", the text description is to go to the same bubble',
    );
    assert.ok(
      /balanceNoticeTick/.test(clientPet),
      'The container must pass "the reason why the prompt is unavailable" to each pet',
    );
    assert.ok(
      /decideBalanceNotice/.test(clientPet),
      'The pop-up window judgment must come from src/shared (the same copy at both ends), and it is not allowed to write one copy at each end.',
    );
  });

  test('Desktop shell: The same judgment + bubble rendering is used if it is unavailable (no longer write-only console)', () => {
    const events = readSource('../../runtime/electron-helper/events.js');
    // The pet body has been split into sprite.js and sprite -*.js: The guard must read the entire file, otherwise it will be false positive as soon as the file is moved.
    const sprite = [
      readSource('../../runtime/electron-helper/sprite.js'),
      ...readdirSync(fileURLToPath(new URL('../../runtime/electron-helper/sprite/', import.meta.url))).map((name) =>
        readSource('../../runtime/electron-helper/sprite/' + name),
      ),
    ].join('\n');
    assert.ok(
      /S\.decideBalanceNotice/.test(events),
      'Desktop polling must call the same decision (shared-core of S.decideBalanceNotice)',
    );
    assert.ok(
      /showBalanceNotice/.test(events) && /showBalanceNotice/.test(sprite),
      'The desktop must have an unavailable bubble rendering path (showBalanceNotice), not just console.error',
    );
  });
});

describe('commandcode - Three-window usage is displayed in the same set of conventions as opencode', () => {
  test('toBalanceState: real leaf → view (cap is brought along with the reset time)', () => {
    const s = toBalanceState({
      ok: true,
      provider: 'commandcode',
      shape: 'windows',
      data: {
        monthly: 30,
        monthlyCapUsd: 70,
        monthlyResetsAt: '2026-10-13T01:01:27.000Z',
        rolling: 10,
        rollingCapUsd: 14,
        weekly: 75,
        weeklyCapUsd: 35,
      },
    });
    assert.ok(s && s.ok, 'commandcode leaf must resolve available views');
    if (!s || !s.ok) throw new Error('unreachable');
    assert.equal(s.shape, 'windows');
    assert.equal(s.monthly, 30);
    assert.equal(s.monthlyCapUsd, 70);
    assert.equal(s.monthlyResetsAt, '2026-10-13T01:01:27.000Z');
    assert.equal(s.rolling, 10);
    assert.equal(s.rollingCapUsd, 14);
    assert.equal(s.weekly, 75);
    assert.equal(s.weeklyCapUsd, 35);
    assert.equal(s.rollingResetsAt, undefined);
  });

  test('When there is no window limit, only monthly window is used (no 0 is added): both percentage and bubble only say monthly', () => {
    const view: BalanceView = {
      provider: 'commandcode',
      shape: 'windows',
      ok: true,
      monthly: 40,
      monthlyCapUsd: 70,
      monthlyResetsAt: '2999-01-01T00:00:00.000Z',
    };
    assert.equal(balancePercent(view), 40);
    const rows = balanceBubbleView(view);
    assert.equal(rows[0]?.text, '月额度已用 40%');
    assert.equal(rows[1]?.role, 'sub');
  });

  test('The monthly window is missing/the field that appears is invalid → null (NaN is not sent to the display layer)', () => {
    const leaf = (data: Record<string, unknown>) => ({
      ok: true,
      provider: 'commandcode',
      shape: 'windows',
      data,
    });
    assert.equal(toBalanceState(leaf({ rolling: 10 })), null, 'Missing monthly window = response not recognized');
    assert.equal(toBalanceState(leaf({ monthly: 'x' })), null);
    assert.equal(
      toBalanceState(leaf({ monthly: 10, rolling: 'x' })),
      null,
      '5 h window appears but is illegal → skip the entire shot',
    );
    assert.equal(toBalanceState(leaf({ monthly: 10, monthlyCapUsd: 'x' })), null);
  });

  test('Emergency window: full quota → absolute conventions (the one with the least remaining quota), the same rules as opencode', () => {
    // 5 h left 12.6 / week left 8.75 / month left 56 (USD) → most urgent week
    const rows = balanceBubbleView({
      provider: 'commandcode',
      shape: 'windows',
      ok: true,
      rolling: 10,
      rollingCapUsd: 14,
      weekly: 75,
      weeklyCapUsd: 35,
      monthly: 20,
      monthlyCapUsd: 70,
    });
    assert.equal(rows[0]?.text, '周额度已用 75%');
  });

  test('Emergency window: There is a window that cannot provide the full quota → degenerate into percentage conventions (no hard ratio absolute surplus)', () => {
    // cap cannot be calculated when the monthly pool is 0 (no quota, no consumption): at this time, 5 h is 10% and
    // only 12.6 USD is left, which is "less" than the weekly 50% of 17.5 USD. However, pressing the absolute
    // conventions will report "5 h used" 10%" - the rule is to take the percentage if the quota is short: 50% per week
    // is more urgent
    const rows = balanceBubbleView({
      provider: 'commandcode',
      shape: 'windows',
      ok: true,
      rolling: 10,
      rollingCapUsd: 14,
      weekly: 50,
      weeklyCapUsd: 35,
      monthly: 0,
    });
    assert.equal(rows[0]?.text, '周额度已用 50%');
  });

  test('balancePercent: Take the maximum of three windows (the state animation is the same as opencode)', () => {
    assert.equal(
      balancePercent({ provider: 'commandcode', shape: 'windows', ok: true, rolling: 10, weekly: 75, monthly: 20 }),
      75,
    );
  });

  test('Interval usage: all five numbers are complete → usage enters the view (the number of pages changes to three pages)', () => {
    const usage = {
      totalTokens: 95967948,
      inputTokens: 95489675,
      outputTokens: 478273,
      requests: 745,
      spentUsd: 1.5968,
    };
    const s = toBalanceState({
      ok: true,
      provider: 'commandcode',
      shape: 'windows',
      data: { monthly: 2, usage },
    });
    assert.ok(s && s.ok, 'Leaves with usage must still be available views');
    if (!s || !s.ok) throw new Error('unreachable');
    assert.deepEqual(s.usage, usage);
    assert.equal(balancePageCount(s), 3, 'One more page if necessary');
  });

  test('Interval usage: missing field or invalid → skip the whole shot (do not spell half of the usage page)', () => {
    const leaf = (usage: unknown) => ({
      ok: true,
      provider: 'commandcode',
      shape: 'windows',
      data: { monthly: 50, usage },
    });
    assert.equal(
      toBalanceState(leaf({ totalTokens: 1, inputTokens: 1, outputTokens: 0, requests: 1 })),
      null,
      'Missing spentUsd = Incomplete fields',
    );
    assert.equal(
      toBalanceState(leaf({ totalTokens: 'x', inputTokens: 1, outputTokens: 0, requests: 1, spentUsd: 0 })),
      null,
      'Appears but illegal',
    );
    assert.equal(toBalanceState(leaf('nope')), null, 'Not an object');
    const noUsage = toBalanceState({ ok: true, provider: 'opencode-go', shape: 'windows', data: { monthly: 5 } });
    assert.ok(noUsage && noUsage.ok);
    if (!noUsage || !noUsage.ok) throw new Error('unreachable');
    assert.equal(noUsage.usage, undefined, 'Service providers that do not have this data do not carry usage');
    assert.equal(balancePageCount(noUsage), 2);
  });

  test('The third page: One row usage carries the entire card (three rows and two columns + in and out ratio), the compact number is fixed to one decimal place', () => {
    const rows = balancePageView(
      {
        provider: 'commandcode',
        shape: 'windows',
        ok: true,
        monthly: 2,
        usage: {
          totalTokens: 95967948,
          inputTokens: 95489675,
          outputTokens: 478273,
          requests: 745,
          spentUsd: 1.5968,
        },
      },
      2,
    );
    const [row] = rows;
    assert.equal(row?.role, 'usage', 'Only this line appears on the third page');
    if (!row || row.role !== 'usage') throw new Error('unreachable');
    assert.equal(row.total, '96.0M');
    assert.equal(row.input, '95.5M 入');
    assert.equal(row.output, '478.3K 出');
    assert.equal(row.period, '本期 745 次');
    assert.equal(row.spend, '$1.60');
    assert.equal(
      row.inputPercent,
      (95489675 / (95489675 + 478273)) * 100,
      'The proportion bar uses the real proportion and does not enlarge the minimum width.',
    );
    // There is still plain text fallback outside the scale bar, which can be read by consumers who do not know usage.
    assert.equal(row.text, 'Token 96.0M · 95.5M 入 / 478.3K 出 · 本期 745 次 · $1.60');
  });

  test('The first page is still collapsed, and the second page is still window details (the new page will not crowd out the original two pages)', () => {
    const view: BalanceView = {
      provider: 'commandcode',
      shape: 'windows',
      ok: true,
      rolling: 10,
      rollingCapUsd: 14,
      monthly: 20,
      monthlyCapUsd: 70,
      usage: { totalTokens: 1, inputTokens: 1, outputTokens: 0, requests: 1, spentUsd: 0.1 },
    };
    assert.equal(balancePageView(view, 0)[0]?.text, '5h额度已用 10%');
    assert.equal(balancePageView(view, 1)[0]?.role, 'quota');
  });
});

describe('money ——The state benchmark is brought out by data (the display layer no longer hard-codes the quota of any service provider)', () => {
  const view = (fullBalance?: string, total = '10.00'): BalanceView => ({
    provider: 'some-wallet',
    shape: 'money',
    ok: true,
    wallets: [
      {
        currency: 'CNY',
        total,
        granted: '0.00',
        toppedUp: total,
        ...(fullBalance === undefined ? {} : { fullBalance }),
      },
    ],
  });

  test('Baseline 20: Balance 20 → 0%, 10 → 50%, 0 → 100%, negative numbers are used up', () => {
    assert.equal(balancePercent(view('20', '20.00')), 0);
    assert.equal(balancePercent(view('20', '10.00')), 50);
    assert.equal(balancePercent(view('20', '0.00')), 100);
    assert.equal(balancePercent(view('20', '-0.02')), 100, 'Overdraft is equivalent to 0');
  });

  test('Change the benchmark to another value: Different percentages are calculated for the same balance (proof that the benchmark really comes from data)', () => {
    assert.equal(balancePercent(view('10', '5.00')), 50);
    assert.equal(balancePercent(view('100', '5.00')), 95);
  });

  test('No benchmark / Invalid benchmark / Invalid amount → undefined (no state animation, no guessing for the service provider)', () => {
    assert.equal(balancePercent(view(undefined)), undefined);
    assert.equal(balancePercent(view('0')), undefined);
    assert.equal(balancePercent(view('-5')), undefined);
    assert.equal(balancePercent(view('abc')), undefined);
    assert.equal(balancePercent(view('20', 'abc')), undefined);
  });

  test('Multi-currency: Each currency calculates the remaining proportion according to its own basis and then superimposes it (no exchange rate is required)', () => {
    const multi = (cny: string, usd: string): BalanceView => ({
      provider: 'deepseek-account',
      shape: 'money',
      ok: true,
      wallets: [
        { currency: 'CNY', total: cny, granted: '0.00', toppedUp: cny, fullBalance: '20' },
        { currency: 'USD', total: usd, granted: '0.00', toppedUp: usd, fullBalance: '5' },
      ],
    });
    // 100 − 100×(8.16/20 + 0/5) = 59.2 (binary floating point will have a tail difference, which is 1 e-9)
    const near = (a: number | undefined, b: number): boolean => a !== undefined && Math.abs(a - b) < 1e-9;
    assert.ok(near(balancePercent(multi('8.16', '0.00')), 59.2), String(balancePercent(multi('8.16', '0.00'))));
    // 100 − 100×(8.16/20 + 5/5) = −40.8 → Clamped to 0 (the consumption is offset by the full amount of US dollars)
    assert.equal(balancePercent(multi('8.16', '5.00')), 0);
    // Both are empty → 100
    assert.equal(balancePercent(multi('0.00', '0.00')), 100);
    // A currency has no benchmark → it does not participate, only the one that exists is counted.
    const partial: BalanceView = {
      provider: 'x',
      shape: 'money',
      ok: true,
      wallets: [{ currency: 'JPY', total: '100', granted: '0.00', toppedUp: '100' }],
    };
    assert.equal(balancePercent(partial), undefined, 'There is no standard at all → No playback');
  });

  test('toBalanceState: money leaves the wallet array and state decoration; invalid state values are regarded as not given', () => {
    const s = toBalanceState({
      ok: true,
      provider: 'some-wallet',
      shape: 'money',
      data: {
        wallets: [{ currency: 'CNY', total: '8.79', granted: '1.00', toppedUp: '7.79', fullBalance: '20' }],
        tier: 'peak',
      },
    });
    assert.ok(s && s.ok && s.shape === 'money');
    assert.deepEqual(s.wallets, [
      { currency: 'CNY', total: '8.79', granted: '1.00', toppedUp: '7.79', fullBalance: '20' },
    ]);
    assert.equal(s.tier, 'peak');

    const bad = toBalanceState({
      ok: true,
      provider: 'some-wallet',
      shape: 'money',
      data: { wallets: [{ currency: 'CNY', total: '8.79', fullBalance: 20 }], tier: '???' },
    });
    assert.ok(bad && bad.ok && bad.shape === 'money');
    assert.equal(bad.tier, undefined, 'Unknown gear value → Do not render peaks and valleys');
    assert.equal(bad.wallets?.[0]?.fullBalance, undefined, 'Non-character string reference → treated as not given');
    assert.equal(bad.wallets?.[0]?.granted, '0.00', 'Missing item → mark 0.00');
  });

  test('toBalanceState: wallets is empty/invalid structure → null (cannot recognize the response and do not render this beat)', () => {
    assert.equal(toBalanceState({ ok: true, provider: 'x', shape: 'money', data: { wallets: [] } }), null);
    assert.equal(toBalanceState({ ok: true, provider: 'x', shape: 'money', data: {} }), null);
    assert.equal(
      toBalanceState({ ok: true, provider: 'x', shape: 'money', data: { wallets: [{ total: '8.79' }] } }),
      null,
      'The items missing currency are discarded and cannot be recognized if they are all missing.',
    );
  });
});

describe('points form - points/points balance (non-monetary)', () => {
  const leaf = (data: Record<string, unknown>) => ({
    ok: true,
    provider: 'local-gateway',
    shape: 'points',
    data,
  });

  test('toBalanceState: unit + total is required, full is optional', () => {
    const s = toBalanceState(leaf({ unit: '积分', total: '800', full: '1000' }));
    assert.ok(s && s.ok && s.shape === 'points');
    assert.deepEqual(s.points, { unit: '积分', total: '800', full: '1000' });

    const noFull = toBalanceState(leaf({ unit: '点数', total: '0' }));
    assert.ok(noFull && noFull.ok && noFull.shape === 'points');
    assert.equal(noFull.points?.full, undefined, 'No benchmark is given → does not participate in gear conversion');
    assert.equal(noFull.points?.total, '0', '0 is a legal balance and is not filtered like 0 yuan');

    const emptyFull = toBalanceState(leaf({ unit: '积分', total: '800', full: '' }));
    assert.ok(emptyFull && emptyFull.ok && emptyFull.shape === 'points');
    assert.equal(emptyFull.points?.full, undefined, 'Empty string reference → regarded as not given');
  });

  test('toBalanceState: Missing unit / total → null (unrecognized, do not render this shot)', () => {
    assert.equal(toBalanceState(leaf({ total: '800' })), null, 'Missing unit = Cannot spell "800 points"');
    assert.equal(toBalanceState(leaf({ unit: '积分' })), null, 'Missing total = No number to display');
    assert.equal(toBalanceState(leaf({ unit: '', total: '800' })), null);
    assert.equal(toBalanceState(leaf({ unit: '积分', total: '' })), null);
    assert.equal(toBalanceState({ ok: true, provider: 'x', shape: 'points' }), null, 'Missing data segment');
  });

  test('balancePercent: converted according to points.full; there is no basis → undefined (not played)', () => {
    const view = (total: string, full?: string): BalanceView => ({
      provider: 'local-gateway',
      shape: 'points',
      ok: true,
      points: { unit: '积分', total, full },
    });
    assert.equal(balancePercent(view('1000', '1000')), 0);
    assert.equal(balancePercent(view('800', '1000')), 20);
    assert.equal(balancePercent(view('0', '1000')), 100);
    assert.equal(balancePercent(view('1200', '1000')), 0, 'Out of standard → Clamped to 0');
    assert.equal(balancePercent(view('-50', '1000')), 100, 'Negative numbers are equivalent to 0');
    assert.equal(balancePercent(view('800')), undefined, 'No benchmark → No level broadcast');
    assert.equal(balancePercent(view('800', '0')), undefined, 'Baseline is 0 → No conversion');
    assert.equal(balancePercent(view('abc', '1000')), undefined, 'Illegal number → Do not broadcast');
  });

  test('balanceBubbleView: One line "Balance 800 points", no currency symbol', () => {
    assert.deepEqual(
      balanceBubbleView({
        provider: 'local-gateway',
        shape: 'points',
        ok: true,
        points: { unit: '积分', total: '800', full: '1000' },
      }),
      [{ role: 'label', text: '余额 800 积分' }],
    );
    // Even if the unit is changed, it will not degenerate into ¥
    assert.deepEqual(
      balanceBubbleView({
        provider: 'local-gateway',
        shape: 'points',
        ok: true,
        points: { unit: '点数', total: '12' },
      }),
      [{ role: 'label', text: '余额 12 点数' }],
    );
  });

  test('balanceDetailView / urgentWindow: points has no window to expand and no emergency window.', () => {
    const view: BalanceView = {
      provider: 'local-gateway',
      shape: 'points',
      ok: true,
      points: { unit: '积分', total: '800', full: '1000' },
    };
    assert.deepEqual(
      balanceDetailView(view),
      balanceBubbleView(view),
      'The expanded state is consistent with the collapsed state',
    );
    assert.equal(urgentWindow(view), undefined, 'There is no "most urgent window" for points');
  });
});

/**
 * Contract test for custom shape (third-party custom node tree).
 *
 * Why these assertions are important: The node tree is external input, and the parsing layer is the only line of
 * defense (the renderer does not do secondary verification). Verify four things here: whitelist cropping, capacity
 * limit, skipping the whole shot if it fails (the tree with missing blocks is not drawn), and "the row data channel is
 * empty" - the latter ensures that the entry point rendered at both ends must go through the tree branch, and will not
 * be mistakenly rendered into an empty bubble without knowing it.
 */
describe('custom form - third-party custom bubble (node tree)', () => {
  const leaf = (data: Record<string, unknown>): unknown => ({
    ok: true,
    provider: 'weird-provider',
    shape: 'custom',
    data,
  });
  const customOf = (raw: unknown): CustomBalance | undefined => {
    const s = toBalanceState(raw);
    return s && s.ok && s.shape === 'custom' ? s.custom : undefined;
  };
  const twoSpans = (): Record<string, unknown> => ({
    tag: 'div',
    style: { display: 'flex', gap: '4px' },
    children: [
      { tag: 'span', text: '额度', style: { color: '#666' } },
      { tag: 'b', text: '8.16' },
    ],
  });

  test('Parse the valid tree as is: tag / text / style / all child nodes are retained', () => {
    assert.deepEqual(customOf(leaf({ rows: twoSpans() }))?.views[0], {
      tag: 'div',
      style: { display: 'flex', gap: '4px' },
      children: [
        { tag: 'span', text: '额度', style: { color: '#666' } },
        { tag: 'b', text: '8.16' },
      ],
    });
  });

  test('views Multiple pages: keep in order; you can click only if there are more than 1 page (one page cannot be clicked)', () => {
    const three = customOf(
      leaf({ views: [twoSpans(), { tag: 'div', text: '第二页' }, { tag: 'div', text: '第三页' }] }),
    );
    assert.equal(three?.views.length, 3);
    assert.equal(three?.views[1]?.text, '第二页');
    assert.equal(three?.views[2]?.text, '第三页');

    const multi = toBalanceState(leaf({ views: [twoSpans(), twoSpans()] }))!;
    assert.equal(customClickable(multi), true, 'Two pages available');
    assert.equal(customClickable(toBalanceState(leaf({ rows: twoSpans() }))!), false, 'One page cannot be clicked');
  });

  test('views and rows/detailRows are given simultaneously: views takes priority (old fields are only compatible)', () => {
    const v = customOf(
      leaf({
        views: [{ tag: 'div', text: '新' }],
        rows: { tag: 'div', text: '旧' },
        detailRows: { tag: 'div', text: '旧2' },
      }),
    );
    assert.equal(v?.views.length, 1);
    assert.equal(v?.views[0]?.text, '新');
  });

  test('The number of pages exceeds the upper limit → null; exactly the upper limit → passes', () => {
    const pages = Array.from({ length: CUSTOM_LIMITS.maxViews + 1 }, () => ({ tag: 'div', text: 'x' }));
    assert.equal(toBalanceState(leaf({ views: pages })), null);
    assert.ok(customOf(leaf({ views: pages.slice(0, CUSTOM_LIMITS.maxViews) })));
  });

  test('The old two-page writing method (rows + detailRows) is equivalent to views: [ rows , detailRows ]', () => {
    const legacy = customOf(leaf({ rows: twoSpans(), detailRows: { tag: 'div', text: '第二页' } }));
    assert.equal(legacy?.views.length, 2);
    assert.equal(legacy?.views[1]?.text, '第二页');
    assert.equal(toBalanceState(leaf({ rows: twoSpans(), detailRows: { tag: 'script' } })), null);
  });

  test('img node only recognizes http/https (file: wait for the local protocol to be invalidated)', () => {
    assert.equal(
      customOf(leaf({ views: [{ tag: 'div', children: [{ tag: 'img', src: 'https://cdn.example/a.png' }] }] }))
        ?.views[0]?.children?.[0]?.src,
      'https://cdn.example/a.png',
    );
    assert.equal(toBalanceState(leaf({ views: [{ tag: 'img', src: 'file:///C:/secret.png' }] })), null);
  });

  test('The style only leaves whitelist keys; external resources/expressions/overlong values are lost and do not affect other styles.', () => {
    const style = customOf(
      leaf({
        views: [
          {
            tag: 'div',
            style: {
              color: '#123456',
              gap: '4px',
              position: 'absolute', // Outside the whitelist: allows content to escape the bubble
              background: 'url(https://tracker.example/x.png)', // External resource reference
              width: 'expression(alert(1))', // Expression
              fontSize: 'x'.repeat(CUSTOM_LIMITS.maxStyleValue + 1), // Extra long
            },
          },
        ],
      }),
    )?.views[0]?.style;
    assert.deepEqual(style, { color: '#123456', gap: '4px' });
  });

  test('If the text is too long, it will be truncated according to the upper limit (the content is still readable, and the whole tree will be invalid)', () => {
    const text = customOf(leaf({ views: [{ tag: 'span', text: 'x'.repeat(500) }] }))?.views[0]?.text;
    assert.equal(text?.length, CUSTOM_LIMITS.maxText);
  });

  test('Non-whitelist tag → null (skip the whole shot, never draw a tree with missing blocks)', () => {
    assert.equal(toBalanceState(leaf({ views: [{ tag: 'script', text: 'alert(1)' }] })), null);
    assert.equal(toBalanceState(leaf({ views: [{ tag: 'div', children: [{ tag: 'iframe' }] }] })), null);
    assert.equal(
      toBalanceState(leaf({ rows: { tag: 'script', text: 'alert(1)' } })),
      null,
      'The old writing method is also subject to the whitelist',
    );
  });

  test('Any page is invalid → null (do not do the semi-bad state of "the first few pages are normal, but the next page crashes")', () => {
    assert.equal(toBalanceState(leaf({ views: [twoSpans(), { tag: 'script' }] })), null);
    assert.ok(customOf(leaf({ views: [twoSpans(), twoSpans()] })));
  });

  test('The number of child nodes/tree depth/number of nodes in the whole tree exceeds the limit → null', () => {
    const many = Array.from({ length: CUSTOM_LIMITS.maxChildren + 1 }, () => ({ tag: 'span', text: 'x' }));
    assert.equal(toBalanceState(leaf({ views: [{ tag: 'div', children: many }] })), null);

    // Nesting beyond the upper limit of depth (the root is 0, the maxDepth layer is invalid)
    let deep: Record<string, unknown> = { tag: 'span', text: 'x' };
    for (let i = 0; i < CUSTOM_LIMITS.maxDepth; i++) deep = { tag: 'div', children: [deep] };
    assert.equal(toBalanceState(leaf({ views: [deep] })), null);

    // 1 + 24 + 576 > maxNodes (Each layer does not exceed maxChildren, but the total amount exceeds)
    const grandchildren = Array.from({ length: CUSTOM_LIMITS.maxChildren }, () => ({ tag: 'span', text: 'x' }));
    const huge = Array.from({ length: CUSTOM_LIMITS.maxChildren }, () => ({
      tag: 'div',
      children: grandchildren,
    }));
    assert.equal(toBalanceState(leaf({ views: [{ tag: 'div', children: huge }] })), null);
  });

  test('percent: clip to 0-100; non-numeric → do not play state animation (undefined)', () => {
    assert.equal(customOf(leaf({ rows: twoSpans(), percent: 140 }))?.percent, 100);
    assert.equal(customOf(leaf({ rows: twoSpans(), percent: -5 }))?.percent, 0);
    assert.equal(customOf(leaf({ rows: twoSpans(), percent: 'abc' }))?.percent, undefined);
    assert.equal(
      balancePercent({ provider: 'p', shape: 'custom', ok: true, custom: { views: [{ tag: 'div' }] } }),
      undefined,
    );
    assert.equal(
      balancePercent({ provider: 'p', shape: 'custom', ok: true, custom: { views: [{ tag: 'div' }], percent: 40 } }),
      40,
    );
  });

  test('The row data channel is empty: balanceBubbleView returns [] for custom (rendering entry point must go through the tree)', () => {
    const state = toBalanceState(leaf({ views: [twoSpans()] }))!;
    assert.deepEqual(balanceBubbleView(state), []);
    assert.deepEqual(balanceDetailView(state), []);
    // Only the tree accessor can get the content, and the entry points rendered at both ends are judged accordingly.
    assert.equal(customViews(state)?.length, 1);
    assert.equal(customClickable(state), false, 'Only one page = cannot be clicked');
  });

  test('customViews / customClickable: Only the status of custom and ok has value', () => {
    const state = toBalanceState(leaf({ views: [twoSpans(), twoSpans()] }))!;
    assert.equal(customViews(state)?.length, 2);
    assert.equal(customClickable(state), true);
    assert.equal(customViews(unsupported), undefined, 'No tree in unavailable state');
    assert.equal(
      customViews({
        provider: 'p',
        shape: 'money',
        ok: true,
        wallets: [{ currency: 'CNY', total: '1', granted: '0', toppedUp: '0' }],
      }),
      undefined,
      'There is no tree in the built-in shape',
    );
  });
});
