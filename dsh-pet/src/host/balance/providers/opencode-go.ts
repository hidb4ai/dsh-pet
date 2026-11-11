/**
 * OpenCode Go (provider id opencode-go): three-window usage.
 *
 * Take GET https:// opencode.ai/zen/go/v1/usage; the interface ensures that the three windows and three reset times
 * are complete. If one is missing, the response will be regarded as deformed and an error will be reported. The full
 * quota is a business constant that the interface does not return and is brought out with the data; the rolling window
 * is 5 hours. opencode-go and opencode are two id. The latter has no usage interface and is not registered.
 *
 * @module dsh-pet/src/host/balance/providers/opencode-go
 */
import { fetchWithRetry, num, str } from '../internal.ts';
import type { BalanceProvider } from '../types.ts';

/** The full quota of each window (USD): rolling 12, week 30, month 60; the interface does not return, it is a business constant. */
const QUOTA_USD = {
  rolling: 12,
  weekly: 30,
  monthly: 60,
} as const;

/** The display name of the rolling window: This service provider is 5 hours. */
const ROLLING_LABEL = '5h';

/** Built-in definition of OpenCode Go. */
export const opencodeGo: BalanceProvider = {
  id: 'opencode-go',
  credential: { mode: 'ref', ref: 'OPENCODE_GO_API_KEY' },
  async fetch({ key, provider }) {
    const res = await fetchWithRetry('https://opencode.ai/zen/go/v1/usage', key);
    if (!res.ok) throw new Error('opencode usage HTTP ' + res.status);
    const body: unknown = await res.json();
    const usage = (body as { usage?: unknown })?.usage;
    if (!usage || typeof usage !== 'object') throw new Error('dsh-pet: opencode usage response is missing usage');
    const u = usage as Record<string, { percent?: unknown; resetsAt?: unknown }>;
    const rolling = u.rolling,
      weekly = u.weekly,
      monthly = u.monthly;
    if (!rolling || !weekly || !monthly) throw new Error('dsh-pet: opencode usage response is missing windows');
    return {
      ok: true,
      provider,
      shape: 'windows',
      data: {
        rolling: num(rolling.percent, 'rolling.percent'),
        weekly: num(weekly.percent, 'weekly.percent'),
        monthly: num(monthly.percent, 'monthly.percent'),
        rollingCapUsd: QUOTA_USD.rolling,
        weeklyCapUsd: QUOTA_USD.weekly,
        monthlyCapUsd: QUOTA_USD.monthly,
        rollingLabel: ROLLING_LABEL,
        rollingResetsAt: str(rolling.resetsAt, 'rolling.resetsAt'),
        weeklyResetsAt: str(weekly.resetsAt, 'weekly.resetsAt'),
        monthlyResetsAt: str(monthly.resetsAt, 'monthly.resetsAt'),
      },
    };
  },
};
