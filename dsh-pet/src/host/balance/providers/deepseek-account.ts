/**
 * DSH account route (provider id deepseek-account): free quota and platform login account amount.
 *
 * There is no API Key, nor HTTP: the certificate is the authorization record held by the DSH account service, and only
 * resolveAccount injected by the caller takes a snapshot. The display conventions are consistent with
 * deepseek-official, the difference is only in the number. The state benchmark and peak and valley are taken from
 * ./deepseek-common.ts.
 *
 * @module dsh-pet/src/host/balance/providers/deepseek-account
 */
import { deepseekFullBalance, deepseekPricingTier } from '../deepseek-common.ts';
import { money, obj, sumMoney } from '../internal.ts';
import type { AccountBalanceSnapshot, BalanceProvider, BalanceSuccess } from '../types.ts';

/**
 * Account balance snapshot → successful result (pure function, the test can directly feed the real structure).
 * @param snapshot - Snapshot returned by the account service; when not logged in, it is null or undefined.
 * @param provider - Backfill the result of provider id .
 * @returns money format, one wallet for each currency.
 * @throws will not forge 0 balance when not logged in, query failed, no recharge wallet or the amount is invalid.
 */
export function parseAccountBalance(
  snapshot: AccountBalanceSnapshot | null | undefined,
  provider: string,
): BalanceSuccess {
  if (!snapshot) throw new Error('dsh-pet: account is not signed in (deepseek-account)');
  if (snapshot.status !== 'ready') throw new Error('dsh-pet: account balance request failed');
  const wallets = Array.isArray(snapshot.value) ? snapshot.value : [];
  // The recharge wallet is empty = there is no balance to display (such as only sending a new account without recharging), and an error is reported instead of displaying ¥0.00.
  if (wallets.length === 0) throw new Error('dsh-pet: account has no prepaid wallet balance');
  // All wallets are moved out by currency, and the display layer determines which ones are displayed; only taking the first one will treat the empty USD wallet in front as the balance.
  const candidates = wallets.map((w) => obj(w as unknown)).filter((w): w is Record<string, unknown> => w !== undefined);
  if (candidates.length === 0) throw new Error('dsh-pet: invalid account wallet structure');

  // Sum wallets by currency; multiple wallets may share the same currency.
  const toppedUpBy = new Map<string, string>();
  for (const w of candidates) {
    const currency = typeof w.currency === 'string' && w.currency.length > 0 ? w.currency : 'CNY';
    const amount = money(w.balance, 'balance');
    const prev = toppedUpBy.get(currency);
    toppedUpBy.set(currency, prev === undefined ? amount : sumMoney(prev, amount));
  }
  // The gift wallet with invalid currency cannot be assigned, skipped, and will not be hard-matched.
  const grantedBy = new Map<string, string>();
  for (const raw of Array.isArray(snapshot.bonusWallets) ? snapshot.bonusWallets : []) {
    const w = obj(raw as unknown);
    if (!w || typeof w.currency !== 'string' || w.currency.length === 0) continue;
    const amount = money(w.balance, 'bonus balance');
    const prev = grantedBy.get(w.currency);
    grantedBy.set(w.currency, prev === undefined ? amount : sumMoney(prev, amount));
  }
  // Add one additional point for currencies that only appear in the gift wallet: the balance is real and usable and cannot disappear because there is no recharge wallet.
  for (const currency of grantedBy.keys()) {
    if (!toppedUpBy.has(currency)) toppedUpBy.set(currency, '0.00');
  }

  const walletsOut = [...toppedUpBy.entries()].map(([currency, toppedUp]) => {
    const granted = grantedBy.get(currency) ?? '0.00';
    const fullBalance = deepseekFullBalance(currency);
    return {
      currency,
      // Isomorphic to the official route: total = gift + recharge, here the two wallets are added together.
      total: sumMoney(granted, toppedUp),
      granted,
      toppedUp,
      ...(fullBalance === undefined ? {} : { fullBalance }),
    };
  });
  return {
    ok: true,
    provider,
    shape: 'money',
    data: { wallets: walletsOut, tier: deepseekPricingTier() },
  };
}

/** Built-in definition of DSH account route. */
export const deepseekAccount: BalanceProvider = {
  id: 'deepseek-account',
  credential: { mode: 'none' },
  async fetch({ provider, resolveAccount }) {
    // The upstream has guaranteed the presence of resolveAccount of the none route; this is only triggered when the invariant is destroyed.
    if (!resolveAccount) throw new Error('dsh-pet: account service missing (' + provider + '）');
    return parseAccountBalance(await resolveAccount(), provider);
  },
};
