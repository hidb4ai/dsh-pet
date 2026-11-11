/**
 * Contract layer of balance query (host side): service provider definition, access context, route results and display
 * form.
 *
 * Only the shape, without specific service provider knowledge: the interface address, quota and analysis are each in
 * ./providers/<name>.ts. There is no import presentation layer (DSH single file loading constraint), so it declares an
 * isomorphic type with src/shared. Always true: failure must be explicit, 0 balances can only come from the interface.
 * See openapi.yaml for the contract.
 *
 * @module dsh-pet/src/host/balance/types
 */

/**
 * Certificate source: ref is the name of DSH credentialRef, which is parsed and injected by the caller; none means
 * that the route does not have API Key. The certificate is the authorization record held by the DSH account service
 * and can only be queried by the service.
 */
export type CredentialSpec = { mode: 'ref'; ref: string } | { mode: 'none' };

/** The context received when the built-in service provider retrieves data. */
export interface BalanceFetchContext {
  /** Hitting provider id, backfill the result as it is. */
  provider: string;
  /** API Key has been parsed; none route is an empty string. */
  key: string;
  /** Account balance query; only used by none route. */
  resolveAccount?: () => Promise<AccountBalanceSnapshot | null | undefined>;
}

/**
 * provider of third-party register: only id can be retrieved. You cannot get the key parsed by the host, nor can you
 * get the resolveAccount; the certificate will be resolved by the register party.
 */
export interface PluginProvider {
  /** Hit provider id (must exactly match id reported by agentDefaultModel). */
  id: string;
  /** Get the number and analyze it; only take the successful path, throw an error if it fails, and queryBalance will be unified into fetch-error. */
  fetch(ctx: PluginFetchContext): Promise<BalanceSuccess>;
}

/** Third-party access context: only provider. */
export interface PluginFetchContext {
  /** Hitting provider id, backfill the result as it is. */
  provider: string;
}

/**
 * Balance query definition of a built-in service provider: a file is a self-contained service provider. The interface
 * address, business constants and response parsing are all in its own file under ./providers/.
 */
export interface BalanceProvider {
  /** Hittable provider id (agentDefaultModel reported id). */
  id: string;
  /** The source of the certificate determines whether queryBalance parses the certificate or adjusts the service. */
  credential: CredentialSpec;
  /** Get the number and analyze it; only take the successful path, throw an error if it fails, and queryBalance will be unified into fetch-error. */
  fetch(ctx: BalanceFetchContext): Promise<BalanceSuccess>;
}

/**
 * Display format: windows is the three-window usage, money is the account amount, points is the points, and custom is
 * the third-party declarative layout. The points are listed separately because granted/toppedUp has no meaning in the
 * points; custom also leaves the layout to the service provider. The form itself does not contain any service provider
 * information.
 */
export type BalanceShape = 'windows' | 'money' | 'points' | 'custom';

/** Customize the labels available for bubble nodes. */
export type CustomTag = 'div' | 'span' | 'i' | 'b' | 'strong' | 'em' | 'img';

/**
 * Custom bubble node (declarative layout tree when shape is custom). Isomorphic to CustomNode of
 * src/shared/balance/types.ts; valid tag, style whitelist and capacity limit are enforced by the client parsing layer,
 * and the host side is only responsible for writing the structure into the leaves as is.
 */
export interface CustomNode {
  tag: CustomTag;
  text?: string;
  /** img only: http/https address. */
  src?: string;
  /** camelCase inline style. */
  style?: Record<string, string>;
  children?: CustomNode[];
}

/** shape is the load of custom: multi-page view (or single page/two page writing) and optional state percentage. */
export interface CustomBalance {
  /** Multi-page view (1~4 items, the first item is the initial page); click the bubble to cycle through pages, and cannot be clicked when there is only 1 page. */
  views?: CustomNode[];
  /** Single page or two page writing method: collapse the state tree; giving detailRows is equivalent to views: [ rows , detailRows ]. */
  rows?: CustomNode;
  /** Expanded state tree: only two pages are used. */
  detailRows?: CustomNode;
  /** Used percentage (0-100), driving state animation; not played by default. */
  percent?: number;
}

/** The pricing state decoration (the "peak/valley" on the bubble) is calculated by the service provider according to its own pricing rules and then brought out with the data. */
export type PricingTier = 'peak' | 'idle';

/**
 * Interval cumulative usage (this issue): Currently, only commandcode is returned. If it is not available, the entire
 * field will be defaulted, and bubble will not have this page.
 *
 * tokens is a gross value - the interface does not provide cache hit splitting; requests and tokens are from the batch
 * aggregate and may lag several minutes behind the window percentage.
 */
export interface BalanceUsage {
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  requests: number;
  spentUsd: number;
}

/**
 * Three-window usage (windows form): opencode and commandcode are shared, so the display layer shares the "take the
 * most urgent window" logic. monthly must be present; rolling and weekly default to indicate that the service provider
 * does not have this window, not 0. When the three full quotas are complete, the comparison is based on the remaining
 * quota, otherwise it is reduced to a used percentage; rollingLabel is the service provider's business fact, and the
 * reset time is treated as "reset" by default.
 */
export interface WindowsUsage {
  monthly: number;
  rolling?: number;
  weekly?: number;
  rollingCapUsd?: number;
  weeklyCapUsd?: number;
  monthlyCapUsd?: number;
  rollingLabel?: string;
  rollingResetsAt?: string;
  weeklyResetsAt?: string;
  monthlyResetsAt?: string;
  /** Interval cumulative usage (optional page); the default means that the service provider does not have this data */
  usage?: BalanceUsage;
}

/**
 * The balance of a currency (money form): DeepSeek official route is isomorphic to DSH account route. The amount
 * string is consistent with the interface, and no conversion or recalculation is performed; fullBalance is the level
 * benchmark of the currency, and the default means no benchmark and no conversion. The account can hold multiple
 * currencies at the same time, so it is an array; the benchmarks of different currencies cannot be interchanged.
 */
export interface MoneyWallet {
  currency: string;
  total: string;
  granted: string;
  toppedUp: string;
  fullBalance?: string;
}

/** Account amount (money form); tier is an optional peak and valley decoration, which is only provided by service providers that provide this rule. */
export interface MoneyBalance {
  wallets: MoneyWallet[];
  tier?: PricingTier;
}

/**
 * Points/Points Balance (points form): total is consistent with the interface, no conversion or recalculation. unit is
 * just a numeric suffix and does not participate in the calculation; full is the state benchmark and does not convert
 * or play state animations by default.
 */
export interface PointsBalance {
  unit: string;
  total: string;
  full?: string;
}

/**
 * Balance snapshot of DSH account service (return of ctx.deepseekAccount.getBalance, only the used fields are taken).
 * Isomorphic to AccountDetails [' balance '] of dsh-deepseek-account; the amount is a decimal character string that
 * preserves server-side precision. failed means it was checked but failed, which is different from null which is not
 * logged in.
 */
export interface AccountBalanceSnapshot {
  status: 'ready' | 'failed';
  /** Recharge wallet (normal_wallets). */
  value?: readonly { currency?: unknown; balance?: unknown }[];
  /** Free wallet (bonus_wallets). */
  bonusWallets?: readonly { currency?: unknown; balance?: unknown }[];
}

/** Success result: shape is the display form, provider is the service provider that actually retrieves the number; client and host are used isomorphically. */
export type BalanceSuccess =
  | { ok: true; provider: string; shape: 'windows'; data: WindowsUsage }
  | { ok: true; provider: string; shape: 'money'; data: MoneyBalance }
  | { ok: true; provider: string; shape: 'points'; data: PointsBalance }
  | { ok: true; provider: string; shape: 'custom'; data: CustomBalance };

/**
 * Query result: success, or failure with reason; failure will never return a forged number. reason is unsupported,
 * credential-missing or fetch-error, message is optional.
 */
export type BalanceResult =
  | BalanceSuccess
  | { ok: false; provider: string; reason: 'unsupported' | 'credential-missing' | 'fetch-error'; message?: string };
