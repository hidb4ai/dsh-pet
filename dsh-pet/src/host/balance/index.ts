/**
 * Balance query entry point (host side): Get the balance according to the current service provider and normalize the
 * results.
 *
 * Only responsible for route and failure normalization, not responsible for display: service provider conventions are
 * in ./providers /, and the directory is in ./registry.ts. The certificate is injected by the caller after being
 * parsed by DSH credentialRef. The plugin does not directly read the certificate storage; the account route uses the
 * injected resolveAccount. Third parties cannot obtain key and resolveAccount through registerBalanceProvider
 * register. It is always true: the service provider only takes the path of success, any failure will be settled here
 * fetch-error, and will never forge a 0 balance.
 *
 * @module dsh-pet/src/host/balance/index
 */
import { BUILTIN_PROVIDERS, matchBalanceProvider } from './registry.ts';
import type { AccountBalanceSnapshot, BalanceResult } from './types.ts';

export { BUILTIN_PROVIDERS, listBalanceProviders, matchBalanceProvider, registerBalanceProvider } from './registry.ts';

/** Built-in service provider directory; use this export name to avoid changes to the existing caller. */
export const BALANCE_PROVIDERS = BUILTIN_PROVIDERS;

/** The upper limit of third-party access waiting time (ms); the built-in HTTP service provider implements its own timeout and retry. */
const PLUGIN_FETCH_TIMEOUT_MS = 20_000;

/**
 * Construction failure result: three types of reason take the same exit to avoid handwritten fields everywhere.
 * `message` This key is not written by default - the leaf shape is an external contract, and an additional undefined
 * key will destroy the strict comparison.
 */
function failed(
  provider: string,
  reason: 'unsupported' | 'credential-missing' | 'fetch-error',
  message?: string,
): BalanceResult {
  return message === undefined ? { ok: false, provider, reason } : { ok: false, provider, reason, message };
}

/** Normalize the number access exception to fetch-error (built-in same conventions as third party). */
function fetchFailed(provider: string, e: unknown): BalanceResult {
  return failed(provider, 'fetch-error', e instanceof Error ? e.message : String(e));
}

/**
 * Check the balance according to the current service provider.
 * @param provider - Current service provider id (agentDefaultModel.currentSelection(). provider).
 * @param resolveKey - Certificate resolution: ref name → key.
 * @param resolveAccount - Account balance query; only used by deepseek-account. By default, this route reports
 * credential-missing.
 * @returns is successful, not supported, lacks credentials or fails to capture; failure will never return a forged
 * number.
 */
export async function queryBalance(
  provider: string,
  resolveKey: (ref: string) => Promise<string | undefined>,
  resolveAccount?: () => Promise<AccountBalanceSnapshot | null | undefined>,
): Promise<BalanceResult> {
  const def = matchBalanceProvider(provider);
  if (!def) return failed(provider, 'unsupported');

  // The third party provider does not have credential: it does not parse key and does not give resolveAccount.
  // Otherwise, it is equivalent to allowing it to check the user's DSH account balance incidentally.
  if (!('credential' in def)) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Balance request timed out after 20 seconds. Try again later.')),
          PLUGIN_FETCH_TIMEOUT_MS,
        );
        timer.unref();
      });
      // Timeout only ends host waiting and does not declare cancellation of third-party requests; late results are discarded by race.
      return await Promise.race([def.fetch({ provider }), timeout]);
    } catch (e) {
      return fetchFailed(provider, e);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  // The credential check is placed outside try: the error in parsing the credential is an accident, and the caller fallback is used; the account route changes to determine whether the account service is present.
  let key = '';
  if (def.credential.mode === 'ref') {
    const resolved = await resolveKey(def.credential.ref);
    if (!resolved) return failed(provider, 'credential-missing', '缺少凭证 ' + def.credential.ref);
    key = resolved;
  } else if (!resolveAccount) {
    return failed(provider, 'credential-missing', '缺少账号服务（' + provider + '）');
  }

  try {
    return await def.fetch({ provider, key, resolveAccount });
  } catch (e) {
    return fetchFailed(provider, e);
  }
}

/** Export externally: caller (host and test) only need to recognize this entry point. */
export { parseAccountBalance } from './providers/deepseek-account.ts';
export { parseCommandCode } from './providers/commandcode.ts';
export type {
  AccountBalanceSnapshot,
  BalanceFetchContext,
  BalanceProvider,
  BalanceResult,
  BalanceShape,
  BalanceSuccess,
  CredentialSpec,
  CustomBalance,
  CustomNode,
  CustomTag,
  MoneyBalance,
  PluginFetchContext,
  PluginProvider,
  PointsBalance,
  PricingTier,
  WindowsUsage,
} from './types.ts';
