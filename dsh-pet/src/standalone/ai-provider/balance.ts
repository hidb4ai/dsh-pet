/**
 * Balance query in standalone mode: Inject the key filled in the settings page into the service provider definition
 * of host side.
 *
 * There is no DSH account service in standalone mode, nor is there credential store. The key is only the one saved on
 * the settings page; therefore, there is only one thing to do here - wrap key into the parsing callback required by
 * queryBalance, and use the host side for fetching and parsing.
 * @module dsh-pet/src/standalone/ai-provider/balance
 */
import { queryBalance as queryProviderBalance, type BalanceResult } from '../../host/balance/index.ts';

/**
 * Check the balance according to the service provider selected in the settings.
 * @param provider - balanceProvider in settings; an empty string means it is not selected and unsupported is returned
 * directly.
 * @param apiKey - the key saved in the settings page; when empty, it is completed by host side to credential-missing.
 * The normalized result of @returns host side; failure will never bring false numbers.
 */
export async function queryStandaloneBalance(provider: string, apiKey: string): Promise<BalanceResult> {
  if (!provider) return { ok: false, provider: '', reason: 'unsupported' };
  return queryProviderBalance(provider, async () => (apiKey ? apiKey : undefined));
}
