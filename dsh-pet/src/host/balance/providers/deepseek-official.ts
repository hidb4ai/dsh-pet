/**
 * DeepSeek official API Key route (provider id deepseek-official): account amount.
 *
 * Get GET https:// api.deepseek.com/user/balance and then move out balance_infos one by one according to currency;
 * only taking the first one will make the subsequent currencies disappear out of thin air. The amount is transmitted
 * as it is and will not be recalculated based on the gift plus recharge. The state benchmark and peak and valley are
 * taken from ./deepseek-common.ts; retry and verification details are unified from ./internal.ts.
 *
 * @module dsh-pet/src/host/balance/providers/deepseek-official
 */
import { deepseekFullBalance, deepseekPricingTier } from '../deepseek-common.ts';
import { fetchWithRetry, obj, str } from '../internal.ts';
import type { BalanceProvider } from '../types.ts';

/** DeepSeek Official built-in definition of API Key route. */
export const deepseekOfficial: BalanceProvider = {
  id: 'deepseek-official',
  credential: { mode: 'ref', ref: 'DEEPSEEK_API_KEY' },
  async fetch({ key, provider }) {
    const res = await fetchWithRetry('https://api.deepseek.com/user/balance', key);
    if (!res.ok) throw new Error('deepseek balance HTTP ' + res.status);
    const body: unknown = await res.json();
    const infos = (body as { balance_infos?: unknown })?.balance_infos;
    if (!Array.isArray(infos) || infos.length === 0)
      throw new Error('dsh-pet: deepseek balance response is missing balance_infos');
    const wallets = infos.map((raw) => {
      const w = obj(raw) ?? {};
      const currency = str(w.currency, 'currency');
      const fullBalance = deepseekFullBalance(currency);
      return {
        currency,
        total: str(w.total_balance, 'total_balance'),
        granted: str(w.granted_balance, 'granted_balance'),
        toppedUp: str(w.topped_up_balance, 'topped_up_balance'),
        ...(fullBalance === undefined ? {} : { fullBalance }),
      };
    });
    return {
      ok: true,
      provider,
      shape: 'money',
      data: { wallets, tier: deepseekPricingTier() },
    };
  },
};
