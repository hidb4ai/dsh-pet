/**
 * Command Code (provider id commandcode): three-window usage, using the undocumented control plane / alpha /*.
 *
 * The usage control plane used by the official CLI is different from the inference data plane: whoami first obtains
 * orgId, and then serially obtains the quota, subscribe and current consumption. The subscribe interface is optional.
 * Failure only lacks the reset time and does not result in overall failure. summary also gives the token of this issue
 * and the number of requests, as the third page of the windows form; if not given, the entire page will not be
 * published. The display form is the same as opencode (windows); it is not responsible for selecting the most urgent
 * window for the display layer.
 *
 * @module dsh-pet/src/host/balance/providers/commandcode
 */
import { fetchWithRetry, looseNum, num, obj, queryString, readWindow } from '../internal.ts';
import type { BalanceProvider, BalanceSuccess, BalanceUsage, WindowsUsage } from '../types.ts';

/** Control plane base address (/alpha/* fixed in the root domain name). */
const API_BASE = 'https://api.commandcode.ai';

/** The display name of the rolling window: The 5 h window of this service provider is windowLimits.fiveHour. */
const ROLLING_LABEL = '5h';

/** Catch JSON once, HTTP is not 2 xx and throw an error; label is the interface path and is only used for error information. */
async function fetchJson(url: string, key: string, label: string): Promise<unknown> {
  const res = await fetchWithRetry(url, key);
  if (!res.ok) throw new Error('commandcode ' + label + ' HTTP ' + res.status);
  return (await res.json()) as unknown;
}

/**
 * Response from usage to read the interval usage (accumulated in this period); it will be returned only if all five
 * fields are complete. If one is missing, it will be deemed that there is no such data.
 *
 * These fields come from batch aggregate (the window percentage is real-time), so it is better not to display the
 * entire page than to use half the numbers to make a card that will look blurry.
 */
function readUsage(summary: Record<string, unknown> | undefined): BalanceUsage | undefined {
  const totalTokens = looseNum(summary?.totalTokens);
  const inputTokens = looseNum(summary?.totalTokensIn);
  const outputTokens = looseNum(summary?.totalTokensOut);
  const requests = looseNum(summary?.totalCount);
  const spentUsd = looseNum(summary?.totalCost);
  if (
    totalTokens === undefined ||
    inputTokens === undefined ||
    outputTokens === undefined ||
    requests === undefined ||
    spentUsd === undefined
  ) {
    return undefined;
  }
  return { totalTokens, inputTokens, outputTokens, requests, spentUsd };
}

/**
 * Parse three responses for quota, subscribe and usage (pure function, test feed real messages directly). Monthly
 * percentage = current consumption / (consumption + remaining); remaining = monthlyCredits + purchasedCredits +
 * freeCredits. The window is only read when limited is true; subscribe only provides monthly reset times.
 * @throws When the required fields are missing or invalid, no forgery will occur. 0 balance
 */
export function parseCommandCode(
  creditsBody: unknown,
  subscriptionBody: unknown,
  summaryBody: unknown,
  provider: string,
): BalanceSuccess {
  const root = obj(creditsBody);
  const credits = obj(root?.credits);
  if (!credits) throw new Error('dsh-pet: commandcode response is missing credits');

  // If all three quota fields are missing, the response form cannot be recognized: it is better to report an error than to calculate "100% used" by treating the denominator as 0.
  const creditFields = [credits.monthlyCredits, credits.purchasedCredits, credits.freeCredits];
  if (creditFields.every((v) => looseNum(v) === undefined)) {
    throw new Error('dsh-pet: commandcode credits response is missing quota fields');
  }
  const remaining = creditFields.reduce<number>((sum, v) => sum + Math.max(0, looseNum(v) ?? 0), 0);

  const summary = obj(summaryBody);
  const spentRaw = summary?.totalCost;
  if (spentRaw === undefined || spentRaw === null)
    throw new Error('dsh-pet: commandcode usage response is missing totalCost');
  const spent = Math.max(0, num(spentRaw, 'totalCost'));

  const pool = spent + remaining;
  const data: WindowsUsage = { monthly: pool > 0 ? (spent / pool) * 100 : 0 };
  if (pool > 0) data.monthlyCapUsd = pool;
  const usage = readUsage(summary);
  if (usage) data.usage = usage;

  const subscription = obj(obj(subscriptionBody)?.data);
  const periodEnd = subscription?.currentPeriodEnd;
  if (typeof periodEnd === 'string' && periodEnd.length > 0) data.monthlyResetsAt = periodEnd;

  // The actual message places windowLimits at the same level as credits and is compatible with the variant embedded in credits.
  const limits = obj(root?.windowLimits) ?? obj(credits.windowLimits);
  if (limits?.limited === true) {
    const fiveHour = readWindow(limits.fiveHour);
    if (fiveHour) {
      data.rolling = fiveHour.percent;
      data.rollingCapUsd = fiveHour.capUsd;
      data.rollingLabel = ROLLING_LABEL;
      if (fiveHour.resetsAt) data.rollingResetsAt = fiveHour.resetsAt;
    }
    const weekly = readWindow(limits.weekly);
    if (weekly) {
      data.weekly = weekly.percent;
      data.weeklyCapUsd = weekly.capUsd;
      if (weekly.resetsAt) data.weeklyResetsAt = weekly.resetsAt;
    }
  }

  return { ok: true, provider, shape: 'windows', data };
}

/** Built-in definition of Command Code. */
export const commandCode: BalanceProvider = {
  id: 'commandcode',
  credential: { mode: 'ref', ref: 'COMMANDCODE_API_KEY' },
  async fetch({ key, provider }) {
    const whoami = obj(
      await fetchJson(API_BASE + '/alpha/whoami' + queryString({ limits: '1' }), key, '/alpha/whoami'),
    );
    const org = obj(whoami?.org);
    const orgId = typeof org?.id === 'string' && org.id.length > 0 ? org.id : undefined;

    const credits = await fetchJson(
      API_BASE + '/alpha/billing/credits' + queryString({ orgId }),
      key,
      '/alpha/billing/credits',
    );

    // subscribe is optional: when the pay-as-you-go account does not subscribe, the interface is not 2 xx, only the
    // monthly reset time is missing. The percentages of the three windows are not affected, so the overall failure
    // will not occur, and the reset time will not be fabricated.
    let subscription: unknown;
    try {
      subscription = await fetchJson(
        API_BASE + '/alpha/billing/subscriptions' + queryString({ orgId }),
        key,
        '/alpha/billing/subscriptions',
      );
    } catch {
      subscription = undefined;
    }

    // Without since: The default range of the server is the billing cycle; in actual measurement, with since, the
    // number of requests and the cost of this period will be calculated as one less (the periodStart of the two
    // responses are the same), so the default range of the server shall prevail.
    const summary = await fetchJson(
      API_BASE + '/alpha/usage/summary' + queryString({ orgId }),
      key,
      '/alpha/usage/summary',
    );

    return parseCommandCode(credits, subscription, summary, provider);
  },
};
