/**
 * Contract test of Command Code usage (provider id `commandcode` , control plane `/alpha/*` ).
 *
 * Background: Command The usage of Code is on the undocumented control plane route used by the official CLI. The
 * plugin maps its three windows of 5 h / week / month into three windows that are isomorphic to opencode. The display
 * layer therefore shares the same set of "take the most urgent window" logic.
 *
 * This document verifies three things: ① Parsing of real GOAT messages (including placeholder values such as
 * `resetAt: 0` must not be regarded as the reset time in 1970); ② Failure conventions: Required fields are
 * missing/invalid and an error will be thrown (→ fetch-error), optional information will be omitted and 0 will never
 * be forged; ③ Network link: the order of the four interfaces is the same as query, Bearer injection, certificate ref,
 * subscribe interface failure is not fatal.
 *
 * Use Node to build test runner (node:test) without introducing any npm dependencies; replace fetch with handwritten
 * stub (only run fake data, not connected to the Internet).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  listBalanceProviders,
  matchBalanceProvider,
  parseAccountBalance,
  parseCommandCode,
  queryBalance,
  registerBalanceProvider,
  type BalanceResult,
  type WindowsUsage,
} from './balance/index.ts';

/** Real GOAT package message (field names and values copy the online response; `resetAt: 0` is the placeholder value of the idle window) */
const GOAT_CREDITS = {
  credits: { belowThreshold: false, creditThreshold: 0, monthlyCredits: 70, purchasedCredits: 0, freeCredits: 0 },
  windowLimits: {
    limited: true,
    exceeded: null,
    fiveHour: { used: 0, cap: 14, exceeded: false, resetAt: 0 },
    weekly: { used: 0, cap: 35, exceeded: false, resetAt: 0 },
  },
};
const GOAT_SUBSCRIPTION = {
  success: true,
  data: {
    status: 'active',
    currentPeriodStart: '2026-09-13T01:01:27.000Z',
    currentPeriodEnd: '2026-10-13T01:01:27.000Z',
    planId: 'individual-goat',
  },
};
const GOAT_SUMMARY = { totalCost: 0, periodBasis: 'billing-period' };

/** Obtain successful commandcode data; if the shape is incorrect, it will directly fail (save the need to write and narrow down each use case) */
function dataOf(result: BalanceResult): WindowsUsage {
  if (!result.ok || result.shape !== 'windows') {
    assert.fail('期望 commandcode 的成功结果，实际：' + JSON.stringify(result));
  }
  return result.data;
}

/** The percentage is a calculated floating point number: press 1 e-9 tolerance ratio */
function assertClose(actual: number | undefined, expected: number, what: string): void {
  assert.equal(typeof actual, 'number', what + ' 应为数字');
  assert.ok(Math.abs((actual as number) - expected) < 1e-9, what + '：期望 ' + expected + '，实际 ' + actual);
}

/** Minimalist Response stand-in: the code under test only uses ok / status / json() */
function res(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

/** Mount fetch stub (return records and unmount function); only press URL route, do not do real network */
function stubFetch(handler: (url: string) => Response): {
  calls: string[];
  auths: (string | null)[];
  restore: () => void;
} {
  const calls: string[] = [];
  const auths: (string | null)[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    auths.push(new Headers(init?.headers).get('authorization'));
    return Promise.resolve(handler(url));
  }) as unknown as typeof fetch;
  return {
    calls,
    auths,
    restore: () => {
      globalThis.fetch = real;
    },
  };
}

/** Default route: All four control plane interfaces give real GOAT packets */
function goatRoute(url: string): Response {
  if (url.includes('/alpha/whoami')) return res({ success: true, user: { id: 'u-1' }, org: { id: 'org-1' } });
  if (url.includes('/alpha/billing/credits')) return res(GOAT_CREDITS);
  if (url.includes('/alpha/billing/subscriptions')) return res(GOAT_SUBSCRIPTION);
  if (url.includes('/alpha/usage/summary')) return res(GOAT_SUMMARY);
  return res({}, 404);
}

describe('BALANCE_PROVIDERS —— commandcode has been registered (certificate COMMANDCODE_API_KEY)', () => {
  test('provider id hits commandcode, the certificate ref is COMMANDCODE_API_KEY, and the definition has its own number.', () => {
    const def = matchBalanceProvider('commandcode');
    assert.ok(def && 'credential' in def, 'The built-in service provider must have a certificate statement');
    assert.equal(def.id, 'commandcode');
    assert.deepEqual(def.credential, { mode: 'ref', ref: 'COMMANDCODE_API_KEY' });
    assert.equal(
      typeof def.fetch,
      'function',
      'The service provider definition must come with its own access number (add a write-only file for the service provider)',
    );
  });

  test('Unregistered service provider still misses (→ unsupported, not silently forged 0)', () => {
    assert.equal(matchBalanceProvider('unregistered-provider'), undefined);
    assert.equal(
      matchBalanceProvider('opencode'),
      undefined,
      'Zen volume-based version (opencode) and Go are two id, the former has no volume interface',
    );
  });
});

describe('parseCommandCode - real GOAT message', () => {
  test('Idle window (resetAt: 0): The placeholder reset time is discarded, and the monthly reset is at the end of the subscribe cycle', () => {
    const data = dataOf(parseCommandCode(GOAT_CREDITS, GOAT_SUBSCRIPTION, GOAT_SUMMARY, 'commandcode'));
    assert.equal(data.monthly, 0);
    assert.equal(data.monthlyCapUsd, 70, 'Monthly pool = current consumption 0 + remaining 70');
    assert.equal(data.monthlyResetsAt, '2026-10-13T01:01:27.000Z');
    assert.equal(data.rolling, 0);
    assert.equal(data.rollingCapUsd, 14);
    assert.equal(data.weekly, 0);
    assert.equal(data.weeklyCapUsd, 35);
    assert.equal(
      data.rollingResetsAt,
      undefined,
      'resetAt: 0 is a placeholder value and cannot be changed to the reset time in 1970',
    );
    assert.equal(data.weeklyResetsAt, undefined);
  });

  test('There is consumption: 5 h/weekly used/cap, monthly consumption/(consumption+remaining), the character string reset time remains unchanged', () => {
    // The old variant of windowLimits embedded in credits: the same needs to be recognized (the actual message is at the same level as credits)
    const credits = {
      credits: {
        monthlyCredits: 12.5,
        purchasedCredits: 3,
        freeCredits: 0.5,
        windowLimits: {
          limited: true,
          fiveHour: { used: 4, cap: 14, resetAt: '2026-09-12T18:00:00.000Z' },
          weekly: { used: 12, cap: 40, resetAt: '2026-09-16T00:00:00.000Z' },
        },
      },
    };
    const subscription = { data: { currentPeriodEnd: '2026-10-01T00:00:00.000Z' } };
    const data = dataOf(parseCommandCode(credits, subscription, { totalCost: 7 }, 'commandcode'));

    assertClose(data.rolling, (4 / 14) * 100, '5h 窗口');
    assertClose(data.weekly, (12 / 40) * 100, '周窗口');
    assertClose(data.monthly, (7 / 23) * 100, '月度：消耗 7 /（7 + 16）');
    assert.equal(data.monthlyCapUsd, 23);
    assert.equal(data.rollingResetsAt, '2026-09-12T18:00:00.000Z');
    assert.equal(data.weeklyResetsAt, '2026-09-16T00:00:00.000Z');
    assert.equal(data.monthlyResetsAt, '2026-10-01T00:00:00.000Z');
  });

  test('No window limit (limited: false): only monthly window, no 5 h/weekly recharge', () => {
    const credits = {
      credits: { monthlyCredits: 0, purchasedCredits: 18.25, freeCredits: 0 },
      windowLimits: { limited: false },
    };
    const data = dataOf(parseCommandCode(credits, undefined, { totalCost: 0 }, 'commandcode'));
    assert.equal(data.monthly, 0);
    assert.equal(data.monthlyCapUsd, 18.25);
    assert.equal(data.rolling, undefined);
    assert.equal(data.weekly, undefined);
    assert.equal(data.rollingCapUsd, undefined);
    assert.equal(data.weeklyCapUsd, undefined);
    assert.equal(
      data.monthlyResetsAt,
      undefined,
      'subscribe is missing → the countdown is not reset, but one is not programmed',
    );
  });

  test('cap is 0 / used missing windows are skipped and the remaining windows are not affected.', () => {
    const credits = {
      credits: { monthlyCredits: 5, purchasedCredits: 0, freeCredits: 0 },
      windowLimits: {
        limited: true,
        fiveHour: { used: 1, cap: 0 },
        weekly: { cap: 10 },
      },
    };
    const data = dataOf(parseCommandCode(credits, undefined, { totalCost: 1 }, 'commandcode'));
    assert.equal(data.rolling, undefined, 'Windows with cap as 0 are not counted (not "0% used")');
    assert.equal(data.weekly, undefined, 'used missing windows do not count');
  });

  test('Digital reset time: Second-level/millisecond-level timestamps are converted to ISO', () => {
    const credits = {
      credits: { monthlyCredits: 5, purchasedCredits: 0, freeCredits: 0 },
      windowLimits: {
        limited: true,
        fiveHour: { used: 1, cap: 10, resetAt: 1790000000 },
        weekly: { used: 1, cap: 10, resetAt: 1790000000000 },
      },
    };
    const data = dataOf(parseCommandCode(credits, undefined, { totalCost: 0 }, 'commandcode'));
    assert.equal(data.rollingResetsAt, new Date(1790000000 * 1000).toISOString());
    assert.equal(data.weeklyResetsAt, new Date(1790000000000).toISOString());
  });

  test('Negative usage (meaningless data) is read as "not consumed": no negative percentage is generated (the state index will be out of bounds)', () => {
    const credits = {
      credits: { monthlyCredits: 5, purchasedCredits: 0, freeCredits: 0 },
      windowLimits: { limited: true, fiveHour: { used: -3, cap: 14 } },
    };
    const data = dataOf(parseCommandCode(credits, undefined, { totalCost: 0 }, 'commandcode'));
    assert.equal(data.rolling, 0);
  });
});

describe('parseCommandCode - If required or missing/invalid, an error will be thrown (never forged 0)', () => {
  test('Missing credits → throw error', () => {
    assert.throws(() => parseCommandCode({}, undefined, { totalCost: 0 }, 'commandcode'), /credits/);
  });

  test('All three quota fields in credits are missing → throw an error (otherwise if the denominator is 0, "100% used" will be calculated)', () => {
    assert.throws(() => parseCommandCode({ credits: {} }, undefined, { totalCost: 0 }, 'commandcode'), /quota fields/);
  });

  test('Missing/invalid totalCost → throw error', () => {
    const credits = { credits: { monthlyCredits: 1, purchasedCredits: 0, freeCredits: 0 } };
    assert.throws(() => parseCommandCode(credits, undefined, {}, 'commandcode'), /totalCost/);
    assert.throws(() => parseCommandCode(credits, undefined, { totalCost: 'abc' }, 'commandcode'), /totalCost/);
  });

  test('The invalid response of the subscribe interface is not a fatal error (optional information: only affects the monthly reset countdown)', () => {
    const credits = { credits: { monthlyCredits: 5, purchasedCredits: 0, freeCredits: 0 } };
    for (const subscription of [undefined, {}, { data: null }, { data: { currentPeriodEnd: 0 } }]) {
      const data = dataOf(parseCommandCode(credits, subscription, { totalCost: 0 }, 'commandcode'));
      assert.equal(data.monthlyResetsAt, undefined);
    }
  });

  test('Interval usage: totalTokens / input / output / number of requests / cost → usage (bubble page 3)', () => {
    const data = dataOf(
      parseCommandCode(
        { credits: { monthlyCredits: 70 } },
        undefined,
        {
          totalCost: 1.5968,
          totalTokens: 95967948,
          totalTokensIn: 95489675,
          totalTokensOut: 478273,
          totalCount: 745,
        },
        'commandcode',
      ),
    );
    assert.deepEqual(data.usage, {
      totalTokens: 95967948,
      inputTokens: 95489675,
      outputTokens: 478273,
      requests: 745,
      spentUsd: 1.5968,
    });
  });

  test('The interval usage field is incomplete → this page will not appear (do not replace it with 0)', () => {
    for (const summary of [
      { totalCost: 1 },
      { totalCost: 1, totalTokens: 10, totalTokensIn: 8, totalTokensOut: 2 },
      { totalCost: 1, totalTokens: 10, totalTokensIn: 8, totalTokensOut: 2, totalCount: 'x' },
    ]) {
      const data = dataOf(parseCommandCode({ credits: { monthlyCredits: 70 } }, undefined, summary, 'commandcode'));
      assert.equal(data.usage, undefined, '缺字段时必须整页缺省：' + JSON.stringify(summary));
    }
  });
});

describe('queryBalance ——Network link (fetch stub)', () => {
  test('Four interfaces are requested in sequence, Bearer is injected, orgId is backfilled (summary without since)', async () => {
    const stub = stubFetch(goatRoute);
    const refs: string[] = [];
    try {
      const result = await queryBalance('commandcode', async (ref) => {
        refs.push(ref);
        return 'k-123';
      });
      assert.equal(result.ok, true);
      assert.deepEqual(stub.calls, [
        'https://api.commandcode.ai/alpha/whoami?limits=1',
        'https://api.commandcode.ai/alpha/billing/credits?orgId=org-1',
        'https://api.commandcode.ai/alpha/billing/subscriptions?orgId=org-1',
        'https://api.commandcode.ai/alpha/usage/summary?orgId=org-1',
      ]);
      assert.deepEqual([...new Set(stub.auths)], ['Bearer k-123']);
      assert.deepEqual(refs, ['COMMANDCODE_API_KEY']);
    } finally {
      stub.restore();
    }
  });

  test('whoami does not contain org → subsequent requests do not contain orgId (no null values are forced)', async () => {
    const stub = stubFetch((url) => {
      if (url.includes('/alpha/whoami')) return res({ success: true, user: { id: 'u-1' } });
      return goatRoute(url);
    });
    try {
      const result = await queryBalance('commandcode', async () => 'k');
      assert.equal(result.ok, true);
      assert.equal(stub.calls[1], 'https://api.commandcode.ai/alpha/billing/credits');
      assert.equal(stub.calls[2], 'https://api.commandcode.ai/alpha/billing/subscriptions');
      assert.equal(
        stub.calls[3],
        'https://api.commandcode.ai/alpha/usage/summary',
        'If orgId is not available, it will not be included; if summary is not available, since will not be included - the default interval of the server is the billing cycle',
      );
    } finally {
      stub.restore();
    }
  });

  test('The subscribe interface failed (the pay-as-you-go account may not have subscribe) → still successful, but the countdown is not reset.', async () => {
    const stub = stubFetch((url) => (url.includes('/alpha/billing/subscriptions') ? res({}, 500) : goatRoute(url)));
    try {
      const result = await queryBalance('commandcode', async () => 'k');
      const data = dataOf(result);
      assert.equal(data.monthlyResetsAt, undefined);
      assert.equal(data.rollingCapUsd, 14, 'The percentages and quotas of the three windows are quite large.');
      assert.equal(
        stub.calls[3],
        'https://api.commandcode.ai/alpha/usage/summary?orgId=org-1',
        'The subscribe failure only lacks the reset time; summary will never contain since (the interval is determined by the server based on the billing cycle)',
      );
    } finally {
      stub.restore();
    }
  });

  test('401 → fetch-error, the error message contains the interface path and status code (does not degrade to "not supported")', async () => {
    const stub = stubFetch(() => res({ error: { code: 'UNAUTHORIZED' } }, 401));
    try {
      assert.deepEqual(await queryBalance('commandcode', async () => 'bad-key'), {
        ok: false,
        provider: 'commandcode',
        reason: 'fetch-error',
        message: 'commandcode /alpha/whoami HTTP 401',
      });
    } finally {
      stub.restore();
    }
  });

  test('Missing credentials → credential-missing, and no request is sent', async () => {
    const stub = stubFetch(goatRoute);
    try {
      assert.deepEqual(await queryBalance('commandcode', async () => undefined), {
        ok: false,
        provider: 'commandcode',
        reason: 'credential-missing',
        message: '缺少凭证 COMMANDCODE_API_KEY',
      });
      assert.deepEqual(stub.calls, []);
    } finally {
      stub.restore();
    }
  });

  test('Unregistered service provider → unsupported, and no request is sent', async () => {
    const stub = stubFetch(goatRoute);
    let asked = 0;
    try {
      assert.deepEqual(
        await queryBalance('unregistered-provider', async () => {
          asked += 1;
          return 'k';
        }),
        { ok: false, provider: 'unregistered-provider', reason: 'unsupported' },
      );
      assert.equal(asked, 0, 'Unregistered service providers should not even parse their credentials.');
      assert.deepEqual(stub.calls, []);
    } finally {
      stub.restore();
    }
  });
});

describe('deepseek-account —— DSH account route (account service, not HTTP + API Key)', () => {
  /** Real `AccountDetails['balance']` shape: ready with value (recharge)/bonusWallets (gift) two wallet arrays */
  const READY = {
    status: 'ready' as const,
    value: [{ currency: 'CNY', balance: '8.79' }],
    bonusWallets: [{ currency: 'CNY', balance: '5.00' }],
  };

  test('provider id hits deepseek-account, shape is the same as deepseek-official, and the certificate mode is none (without API Key)', () => {
    const def = matchBalanceProvider('deepseek-account');
    assert.ok(def && 'credential' in def, 'The built-in service provider must have a certificate statement');
    assert.equal(def.id, 'deepseek-account');
    assert.deepEqual(
      def.credential,
      { mode: 'none' },
      'The account route does not have API Key, and the certificate is held by the account service',
    );
    assert.equal(typeof def.fetch, 'function');
  });

  test('ready: One wallet for each currency, total = recharge + gift (same structure as the official total_balance)', () => {
    const r = parseAccountBalance(READY, 'deepseek-account');
    assert.ok(r.ok && r.shape === 'money');
    assert.equal(r.provider, 'deepseek-account');
    assert.deepEqual(r.data.wallets, [
      { currency: 'CNY', total: '13.79', granted: '5.00', toppedUp: '8.79', fullBalance: '20' },
    ]);
    assert.ok(
      r.data.tier === 'peak' || r.data.tier === 'idle',
      'The gear is calculated by the service provider and then brought out with the data.',
    );
  });

  test('No gift wallet → granted is 0.00, total is equal to the recharge (no omissions or inflated increases due to lack of gifts)', () => {
    const r = parseAccountBalance(
      { status: 'ready', value: [{ currency: 'CNY', balance: '8.79' }] },
      'deepseek-account',
    );
    assert.ok(r.ok && r.shape === 'money');
    assert.deepEqual(r.data.wallets, [
      { currency: 'CNY', total: '8.79', granted: '0.00', toppedUp: '8.79', fullBalance: '20' },
    ]);
  });

  test('USD wallet: The currency is brought out as it is (the display layer selects the symbol accordingly), the amount is not converted, and the benchmark is looked up according to the currency.', () => {
    const r = parseAccountBalance(
      { status: 'ready', value: [{ currency: 'USD', balance: '12.5' }], bonusWallets: [] },
      'deepseek-account',
    );
    assert.ok(r.ok && r.shape === 'money');
    assert.deepEqual(r.data.wallets, [
      { currency: 'USD', total: '12.50', granted: '0.00', toppedUp: '12.50', fullBalance: '5' },
    ]);
  });

  test('Multi-currency wallet: move them all out (no longer just pick one), one for each currency', () => {
    const r = parseAccountBalance(
      {
        status: 'ready',
        value: [
          { currency: 'USD', balance: '0.00' },
          { currency: 'CNY', balance: '20.00' },
        ],
        bonusWallets: [{ currency: 'CNY', balance: '5.00' }],
      },
      'deepseek-account',
    );
    assert.ok(r.ok && r.shape === 'money');
    assert.deepEqual(r.data.wallets, [
      { currency: 'USD', total: '0.00', granted: '0.00', toppedUp: '0.00', fullBalance: '5' },
      { currency: 'CNY', total: '25.00', granted: '5.00', toppedUp: '20.00', fullBalance: '20' },
    ]);
  });

  test('Multiple wallets of the same currency → Accumulation, no money lost', () => {
    const r = parseAccountBalance(
      {
        status: 'ready',
        value: [
          { currency: 'CNY', balance: '1.00' },
          { currency: 'CNY', balance: '2.50' },
        ],
        bonusWallets: [{ currency: 'CNY', balance: '0.50' }],
      },
      'deepseek-account',
    );
    assert.ok(r.ok && r.shape === 'money');
    assert.deepEqual(r.data.wallets, [
      { currency: 'CNY', total: '4.00', granted: '0.50', toppedUp: '3.50', fullBalance: '20' },
    ]);
  });

  test('The real platform precision string (16 decimal places) → converges to two digits, consistent with the ¥8.79 style of the official route', () => {
    const r = parseAccountBalance(
      {
        status: 'ready',
        value: [{ currency: 'CNY', balance: '9.9902690000000000' }],
        bonusWallets: [{ currency: 'CNY', balance: '0' }],
      },
      'deepseek-account',
    );
    assert.ok(r.ok && r.shape === 'money');
    assert.equal(r.data.wallets[0]?.total, '9.99');
    assert.equal(r.data.wallets[0]?.granted, '0.00');
  });

  test('The gift wallet currencies are different → each belongs to his own: CNY has no bonus, USD has the bonus', () => {
    const r = parseAccountBalance(
      {
        status: 'ready',
        value: [{ currency: 'CNY', balance: '8.79' }],
        bonusWallets: [{ currency: 'USD', balance: '1' }],
      },
      'deepseek-account',
    );
    assert.ok(r.ok && r.shape === 'money');
    assert.deepEqual(r.data.wallets, [
      { currency: 'CNY', total: '8.79', granted: '0.00', toppedUp: '8.79', fullBalance: '20' },
      { currency: 'USD', total: '1.00', granted: '1.00', toppedUp: '0.00', fullBalance: '5' },
    ]);
  });

  test('null (not logged in)/failed (query failed)/empty wallet → always throw an error, never forge 0 balance', () => {
    assert.throws(() => parseAccountBalance(null, 'deepseek-account'), /not signed in/);
    assert.throws(() => parseAccountBalance(undefined, 'deepseek-account'), /not signed in/);
    assert.throws(
      () => parseAccountBalance({ status: 'failed' }, 'deepseek-account'),
      /account balance request failed/,
    );
    assert.throws(
      () => parseAccountBalance({ status: 'ready', value: [], bonusWallets: [] }, 'deepseek-account'),
      /no prepaid wallet balance/,
    );
    assert.throws(
      () => parseAccountBalance({ status: 'ready', value: [{ currency: 'CNY', balance: '' }] }, 'deepseek-account'),
      /invalid|balance/,
    );
    assert.throws(
      () => parseAccountBalance({ status: 'ready', value: [{ currency: 'CNY', balance: 'abc' }] }, 'deepseek-account'),
      /invalid/,
    );
  });

  test('queryBalance: The account route does not parse the credentials, does not send any HTTP, and only adjusts resolveAccount.', async () => {
    const stub = stubFetch(goatRoute);
    let asked = 0;
    try {
      const r = await queryBalance(
        'deepseek-account',
        async () => {
          asked += 1;
          return 'should-not-be-used';
        },
        async () => READY,
      );
      assert.ok(r.ok && r.shape === 'money');
      assert.equal(
        r.data.wallets.find((w) => w.currency === 'CNY')?.total,
        '13.79',
        'Same conventions as parseAccountBalance: Free 5.00 + Recharge 8.79',
      );
      assert.equal(asked, 0, 'There is no account route API Key that can be resolved');
      assert.deepEqual(stub.calls, [], 'Account route does not go fetch');
    } finally {
      stub.restore();
    }
  });

  test('queryBalance: Account service is not present (not injected) → credential-missing, does not degenerate into unsupported', async () => {
    assert.deepEqual(await queryBalance('deepseek-account', async () => 'k'), {
      ok: false,
      provider: 'deepseek-account',
      reason: 'credential-missing',
      message: '缺少账号服务（deepseek-account）',
    });
  });

  test('queryBalance: Account query throws an error → fetch-error, error information is transparently transmitted', async () => {
    const r = await queryBalance(
      'deepseek-account',
      async () => 'k',
      async () => {
        throw new Error('dsh-pet: account balance request failed');
      },
    );
    assert.deepEqual(r, {
      ok: false,
      provider: 'deepseek-account',
      reason: 'fetch-error',
      message: 'dsh-pet: account balance request failed',
    });
  });
});

describe('register table - third party provider (register / list / match)', () => {
  /** A minimal usable third party provider (points form) */
  const plugin = (id: string) => ({
    id,
    async fetch({ provider }: { provider: string }) {
      return {
        ok: true as const,
        provider,
        shape: 'points' as const,
        data: { unit: '积分', total: '800', full: '1000' },
      };
    },
  });

  test('Hit after register, visible in list; fallback unsupported after logout', () => {
    const dispose = registerBalanceProvider(plugin('plugin-a'));
    try {
      assert.equal(matchBalanceProvider('plugin-a')?.id, 'plugin-a');
      assert.ok(listBalanceProviders().external.includes('plugin-a'));
      assert.ok(listBalanceProviders().builtin.includes('commandcode'), 'Built-in is still in the list');
    } finally {
      dispose();
    }
    assert.equal(matchBalanceProvider('plugin-a'), undefined, 'No more hits after logging out');
  });

  test('Cannot overwrite built-in id', () => {
    assert.throws(() => registerBalanceProvider(plugin('deepseek-official')), /Cannot override a built-in provider/);
  });

  test('Register the same id repeatedly → throw an error (not silently override)', () => {
    const dispose = registerBalanceProvider(plugin('plugin-b'));
    try {
      assert.throws(() => registerBalanceProvider(plugin('plugin-b')), /already registered/);
    } finally {
      dispose();
    }
  });

  test('The old logout function will not accidentally delete the same id registered later.', () => {
    const first = registerBalanceProvider(plugin('plugin-c'));
    first();
    const second = registerBalanceProvider(plugin('plugin-c'));
    first(); // Late logout (cleanup for old plugin instance)
    try {
      assert.equal(matchBalanceProvider('plugin-c')?.id, 'plugin-c');
    } finally {
      second();
    }
  });

  test('queryBalance: The third-party branch does not parse key and does not pass resolveAccount', async () => {
    let keyAsked = 0;
    let seen: unknown;
    const dispose = registerBalanceProvider({
      id: 'plugin-d',
      async fetch(ctx) {
        seen = ctx;
        return { ok: true, provider: ctx.provider, shape: 'points', data: { unit: '积分', total: '1' } };
      },
    });
    try {
      const r = await queryBalance(
        'plugin-d',
        async () => {
          keyAsked++;
          return 'k';
        },
        async () => ({ status: 'ready' }),
      );
      assert.ok(r.ok && r.shape === 'points');
      assert.equal(keyAsked, 0, 'Third-party branches are not allowed to parse credentials');
      assert.deepEqual(seen, { provider: 'plugin-d' }, 'fetch can only get provider (no key / resolveAccount)');
    } finally {
      dispose();
    }
  });

  test('queryBalance: Third-party fetch throws an error → fetch-error (same conventions as built-in)', async () => {
    const dispose = registerBalanceProvider({
      id: 'plugin-e',
      async fetch() {
        throw new Error('boom');
      },
    });
    try {
      assert.deepEqual(await queryBalance('plugin-e', async () => 'k'), {
        ok: false,
        provider: 'plugin-e',
        reason: 'fetch-error',
        message: 'boom',
      });
    } finally {
      dispose();
    }
  });

  test('queryBalance: The third party returns the custom form for transparent transmission as it is (host does not verify or change the shape)', async () => {
    // The responsibility of the host side is only to "write the results submitted by the third party into the leaves":
    // the whitelist of tree is clipped at the client parsing layer (src/shared/balance/parse.ts). Here verify "no
    // tampering" - otherwise the layout designed by a third party will be deformed midway.
    const custom = {
      ok: true as const,
      provider: 'plugin-f',
      shape: 'custom' as const,
      data: {
        views: [
          { tag: 'div' as const, children: [{ tag: 'span' as const, text: '剩余 12 次' }] },
          { tag: 'div' as const, text: '本月已用 8 次' },
          { tag: 'div' as const, text: '下月 1 日重置' },
        ],
        percent: 40,
      },
    };
    const dispose = registerBalanceProvider({
      id: 'plugin-f',
      async fetch() {
        return custom;
      },
    });
    try {
      assert.deepEqual(await queryBalance('plugin-f', async () => 'k'), custom);
    } finally {
      dispose();
    }
  });

  test('id that is not registered is still unsupported', async () => {
    assert.deepEqual(await queryBalance('plugin-unknown', async () => 'k'), {
      ok: false,
      provider: 'plugin-unknown',
      reason: 'unsupported',
    });
  });
});
