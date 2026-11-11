/**
 * Balance service provider register table: built-in (compilation time) and third-party (runtime) directory and search.
 *
 * It does not include service provider knowledge, and the built-in definitions are all in ./providers/; it is not
 * responsible for data retrieval and voucher analysis. Add a new built-in service provider: add a provider file and
 * register a row in this table. Always true: built-in priority, third parties are not allowed to occupy built-in id;
 * repeated registration of the same id will throw an error; logout will only delete the share registered by you.
 *
 * @module dsh-pet/src/host/balance/registry
 */
import { commandCode } from './providers/commandcode.ts';
import { deepseekAccount } from './providers/deepseek-account.ts';
import { deepseekOfficial } from './providers/deepseek-official.ts';
import { opencodeGo } from './providers/opencode-go.ts';
import type { BalanceProvider, PluginProvider } from './types.ts';

/** Built-in service provider: registered during compilation, the order is the priority. */
export const BUILTIN_PROVIDERS: BalanceProvider[] = [opencodeGo, commandCode, deepseekOfficial, deepseekAccount];

/** Third-party runtime registry: provider id → Definition. */
const external = new Map<string, PluginProvider>();

/**
 * Register a third-party service provider.
 * @param def - provider definition; id must be consistent with id reported by agentDefaultModel.
 * @returns cancel function; after the same id is re-registered, the old cancel function will not delete the new one by
 * mistake.
 * When @throws is invalidly defined, id conflicts with the built-in, or has been registered by a third party
 */
export function registerBalanceProvider(def: PluginProvider): () => void {
  if (!def || typeof def !== 'object') throw new TypeError('Provider definition must be an object');
  if (typeof def.id !== 'string' || def.id.length === 0) throw new TypeError('id must be a nonempty string');
  if (typeof def.fetch !== 'function') throw new TypeError('fetch must be a function');
  if (BUILTIN_PROVIDERS.some((p) => p.id === def.id)) throw new Error('Cannot override a built-in provider: ' + def.id);
  if (external.has(def.id)) throw new Error('Provider ID already registered: ' + def.id);

  external.set(def.id, def);
  return () => {
    // Only delete the share that still belongs to you to prevent late logouts from overthrowing latecomers.
    if (external.get(def.id) === def) external.delete(def.id);
  };
}

/**
 * List the currently available service providers id for troubleshooting "Why is the current service provider not
 * supported?"
 * @returns builtin is the built-in id and external is the third-party registered id (each call returns a new array).
 */
export function listBalanceProviders(): { builtin: string[]; external: string[] } {
  return { builtin: BUILTIN_PROVIDERS.map((p) => p.id), external: [...external.keys()] };
}

/** Press id to search the definition: first built-in and then third-party, if neither is found, it is not supported. */
export function matchBalanceProvider(provider: string): BalanceProvider | PluginProvider | undefined {
  return BUILTIN_PROVIDERS.find((p) => p.id === provider) ?? external.get(provider);
}
