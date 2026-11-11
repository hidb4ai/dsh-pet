/**
 * Balance pulling and period conversion: fetch the period according to the configuration, refresh the balance and
 * write it into the polling snapshot.
 *
 * The number access protocol of each service provider is not implemented (returned to ./balance/providers).
 * Dependencies are explicitly passed in by apply (see input type), and the module does not read globals or create
 * singletons.
 * @module dsh-pet/src/host/plugin/balance-poll
 */
import { flattenPetList, readAllConfig } from '../config.ts';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PACKAGE_ROOT } from '../paths.ts';
import { queryBalance } from '../balance/index.ts';
import { credentialRef } from '@deepseek-ai/dsh-credentials';
import type { ChatMemory } from './chat-memory.ts';
import type { HostSetup } from './setup.ts';
import type { HostContext } from './context.ts';

/** Input of balance and period: assembly period objects and earlier plants. */
export type BalancePollInput = {
  /** host context (the one apply received). */
  ctx: HostContext;
} & Pick<HostSetup, 'configPaths'> &
  Pick<ChatMemory, 'getActivePetId'> &
  Pick<HostSetup, 'log'> &
  Pick<HostSetup, 'standaloneAiBalance'> &
  Pick<HostSetup, 'state'>;

/**
 * Create balance and period.
 */
export function createBalancePoll(deps: BalancePollInput) {
  const { ctx, configPaths, getActivePetId, log, state, standaloneAiBalance } = deps;
  /** Currently effective pet list: the resolved configuration is flat (the merger has ensured that id is unique and the fields are filled), and the command is shared with desktop mode. */
  const effectivePetList = (): Record<string, unknown>[] => flattenPetList(readAllConfig(configPaths));

  /** Balance refresh period (seconds): eventsRefreshSec.balance of resolved value main entry (the combiner has filled in the default; invalid fallback 1800) */
  const balancePeriodSec = (cfg: Record<string, Record<string, unknown>>): number => {
    const ers = cfg.main?.eventsRefreshSec as Record<string, unknown> | undefined;
    const n = Number(ers?.balance);
    return Number.isFinite(n) && n > 0 ? n : 1800;
  };

  /**
   * whisper period (seconds): eventsRefreshSec.whisper of the entry to which the pet belongs (the merger has filled in
   * the default; invalid fallback 300). Collect the parsed entry configuration: the only caller is periodic
   * scheduling, and its petId is flattened from the same cfg.
   */
  const whisperPeriodSec = (conf: Record<string, unknown>): number => {
    const ers = conf.eventsRefreshSec as Record<string, unknown> | undefined;
    const n = Number(ers?.whisper);
    return Number.isFinite(n) && n > 0 ? n : 300;
  };

  /**
   * The caller identity required by the account service (`AccountClientMetadata`): only affects the request source
   * identifier and server localization copy, and does not affect the balance value and currency. version reads itself
   * package.json (cannot read fallback '0.0.0'); locale fixes zh-CN.
   */
  const accountClientMetadata = (): { version: string; locale: string; timezoneOffsetSeconds: number } => {
    let version = '0.0.0';
    try {
      const raw = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')) as { version?: unknown };
      if (typeof raw.version === 'string' && raw.version.length > 0) version = raw.version;
    } catch {
      // Failure to read does not affect the query: version is just the source identifier on the platform side
    }
    return { version, locale: 'zh-CN', timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60 };
  };

  /**
   * Refresh the balance and write the polling status: The only balance query point on the host side, and both ends
   * read the same result from / state. Failure is also written into the status (reason distinguishes unsupported /
   * credential-missing / fetch-error): If the balance is unavailable, a text description must be played and cannot be
   * silent; unexpected exceptions are also completed fetch-error.
   *
   * @param manual - Whether this refresh is triggered by the user (/ balance command, desktop "View Balance" menu);
   * the mark is written with the data
   * Leaf, based on which the front end decides whether the text description must be played when the balance is
   * unavailable (the periodic refresh only plays once when the reason changes).
   */
  const refreshBalance = async (manual = false): Promise<void> => {
    // Start + Result each have one line: Otherwise, neither "Has it been checked" nor "Checked but the balance has not changed" can be seen in logs.txt.
    log.info(`[dsh-pet] Balance refresh started (${manual ? 'manual' : 'scheduled'})`);
    const mark = <T>(v: T): T | (T & { manual: true }) => (manual ? { ...v, manual: true } : v);
    try {
      // In standalone mode, you choose the balance service provider and hold the key yourself: its provider is not
      // the one used for chatting, and it cannot be parsed by DSH’s credential store, so the certificate handed over
      // by standaloneAi is given priority.
      const standalone = standaloneAiBalance();
      const provider = standalone?.provider || ctx.agentDefaultModel.currentSelection().provider;
      const result = await queryBalance(
        provider,
        async (ref) => {
          if (standalone?.apiKey) return standalone.apiKey;
          const rc = await ctx.credentials.resolve(credentialRef(ref));
          return rc?.value;
        },
        // `deepseek-account` (free quota/platform login) does not have API Key: Its certificate is the authorization
        // record held by the DSH account service, which can only be queried through getBalance. The account service is
        // an optional service (soft fetch, do not put inject) - it is not present when the account plugin is not
        // installed. At this time, the route reports credential-missing instead of crashing.
        async () => {
          const account = ctx.get('deepseekAccount', false);
          if (!account) return undefined;
          return account.getBalance(accountClientMetadata());
        },
      );
      state.writeSection('balance', mark(result));
      // If it fails, write S (front-end pop-up text description), and also leave a message in the log: otherwise
      // "checked, failed" and "not checked at all" will look exactly the same in the file. Use info for success, and
      // warn for failure (the brightness is different, you can tell it at a glance).
      if (result.ok) {
        log.info(`[dsh-pet] Balance refresh succeeded provider=${result.provider} (${result.shape})`);
      } else {
        log.warn(
          `[dsh-pet] Balance refresh failed provider=${result.provider} reason=${result.reason}` +
            (result.message ? ' ' + result.message : ''),
        );
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      state.writeSection(
        'balance',
        mark({
          ok: false,
          provider: 'unknown',
          reason: 'fetch-error',
          message,
        }),
      );
      log.warn('[dsh-pet] Balance refresh threw an error:' + message);
    }
  };

  /** Current interaction desktop pet id: / pet selected and still exists → the pet; unselected/invalid → the first pet in the valid pet list (in-process, restart to default) */
  const resolveActivePetId = (): string => {
    try {
      const eff = effectivePetList();
      if (eff.length === 0) return '';
      if (getActivePetId() && eff.some((p) => String(p.id) === getActivePetId())) return getActivePetId();
      return String(eff[0].id);
    } catch {
      return getActivePetId();
    }
  };

  /** Pet's display name (name, missing fallback id) - for command text */
  const petDisplayName = (pet: Record<string, unknown>): string => {
    const n = String(pet.name ?? '').trim();
    return n || String(pet.id ?? '');
  };
  return { effectivePetList, balancePeriodSec, whisperPeriodSec, refreshBalance, resolveActivePetId, petDisplayName };
}
/** Balance and cycle output (for downstream factories on demand Pick). */
export type BalancePoll = ReturnType<typeof createBalancePoll>;
