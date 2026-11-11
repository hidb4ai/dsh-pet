/**
 * Type definition of balance layer: wire input parameters, parsed view, bubble row data and custom node tree.
 *
 * For pure type files, the only import is `import type` , which disappears after compilation, so it does not rely on
 * any logical modules and does not introduce circular dependencies.
 *
 * @module dsh-pet/src/shared/balance/types
 */

import type { QuotaTone } from './tone.ts';

/**
 * Display form: three built-in forms plus one completely customized, without any service provider information.
 *
 * - `windows` : three-window usage, bubble reports the used percentage of the most urgent window and resets the
 * countdown.
 * - `money` : Account amount, bubble reports balance and peak and valley levels.
 * - `points` : Non-monetary balance of points or points.
 * - `custom` : The node tree handed over by a third party. For service providers that cannot be expressed in the first
 * three types (multiple models separately for balance, remaining times, stored value plus bonus columns...), this
 * method is adopted. The plugins do not need to be implemented one by one.
 *
 * Here is the key type of `Record<BalanceShape, ShapeHandler>` . Missing handler when adding the form will be blocked
 * by compilation.
 */
export type BalanceShape = 'windows' | 'money' | 'points' | 'custom';

/**
 * Custom bubble tag whitelist: only the ones needed for typesetting and layout are open.
 *
 * By using a tree instead of the HTML character string, the renderers at both ends can share a whitelist renderer
 * without going through innerHTML. Therefore, there is no XSS side, and there is no need to write a set of cleaners
 * each. Out-of-bounds content is discarded at the parsing layer (see parse.ts). The renderer is only responsible for
 * drawing and does not perform a second verification.
 */
export type CustomTag = 'div' | 'span' | 'i' | 'b' | 'strong' | 'em' | 'img';

/** Customize a bubble node: label, optional text or child nodes, and inline styles. */
export interface CustomNode {
  tag: CustomTag;
  /** Text fragments are rendered before child nodes */
  text?: string;
  /** Only `img` is valid, only http and https are accepted */
  src?: string;
  /** Inline style, key is camelCase, parsing layer has been filtered by whitelist */
  style?: Record<string, string>;
  children?: CustomNode[];
}

/**
 * For payloads in the form of custom, the parsing layer has normalized the two writing methods of wire into views.
 *
 * Pages are switched cyclically by clicking: the first item is the initial page, click to change to the next page, and
 * the last page returns to the first page; when there is only one page, the bubble cannot be clicked, and the upper
 * limit of the number of pages is shown in CUSTOM_LIMITS.maxViews.
 */
export interface CustomBalance {
  views: CustomNode[];
  /** The used percentage drives the balance state animation; the default means no animation is played. */
  percent?: number;
}

/**
 * The original response in the balance leaf is manually remains isomorphic with the host side BalanceResult.
 *
 * The reason why both ends declare structures separately instead of sharing a module is because the host side is
 * subject to the DSH single file loading constraint and cannot import this directory.
 */
export interface RawBalanceResult {
  ok: boolean;
  provider?: string;
  /** Display form, brought by host when writing leaves */
  shape?: BalanceShape;
  reason?: string;
  message?: string;
  data?: {
    rolling?: unknown;
    weekly?: unknown;
    monthly?: unknown;
    rollingResetsAt?: unknown;
    weeklyResetsAt?: unknown;
    monthlyResetsAt?: unknown;
    rollingCapUsd?: unknown;
    weeklyCapUsd?: unknown;
    monthlyCapUsd?: unknown;
    rollingLabel?: unknown;
    /** windows: Accumulated usage in the interval (optional page). If the total amount is not provided, the entire page will not be displayed. */
    usage?: unknown;
    /** money: Multi-currency wallet array, one currency per item */
    wallets?: unknown;
    tier?: unknown;
    /** points: display unit, only spelled after the number, not involved in calculation */
    unit?: unknown;
    /** points: Current balance, no conversion */
    total?: unknown;
    /** points: state base, by default it does not participate in percentage conversion */
    full?: unknown;
    /** custom: Multi-page view, the first item is the initial page, taking precedence over rows */
    views?: unknown;
    /** custom: Single-page node tree, choose one from views */
    rows?: unknown;
    /** custom: The second page of the old two-page writing method, matched with rows */
    detailRows?: unknown;
    /** custom: Used percentage, the state animation is not played by default */
    percent?: unknown;
  };
}

/** Pricing stall decoration: calculated by the service provider and then brought out with the data, and the display layer is rendered as it is. */
export type PricingTier = 'peak' | 'idle';

/**
 * Interval cumulative usage (this issue): Currently only commandcode is returned, which is the third page of the
 * bubble.
 *
 * They are not interchangeable with the window percentage - that one is the real-time quota, and this one is the batch
 * aggregate account, which may be delayed by several minutes; tokens is the gross value.
 */
export interface BalanceUsage {
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  requests: number;
  spentUsd: number;
}

/** Parsed balance view for display and state calculation */
export interface BalanceView {
  provider: string;
  shape: BalanceShape;
  ok: true;
  /**
   * Three windows used percentage (0-100) and respective reset time. `monthly` is required (the monthly window is the
   * bottom line of the data); `rolling` and `weekly` by default indicate that the service provider does not have this
   * window.
   */
  rolling?: number;
  weekly?: number;
  monthly?: number;
  rollingResetsAt?: string;
  weeklyResetsAt?: string;
  monthlyResetsAt?: string;
  /**
   * The full quota of each window (USD) is brought out by the service provider with the data and is used for the
   * absolute conventions of the most urgent window; by default, it is reduced to percentage conventions. The display
   * layer does not write down the quota of any service provider.
   */
  rollingCapUsd?: number;
  weeklyCapUsd?: number;
  monthlyCapUsd?: number;
  /** Rolling window display name, self-reported by the service provider, default fallback to DEFAULT_ROLLING_LABEL */
  rollingLabel?: string;
  /** windows: cumulative usage in the interval; the default means that the service provider does not have this data, and the bubble only has two pages */
  usage?: BalanceUsage;
  /** money: Multi-currency wallet, one currency for each item */
  wallets?: MoneyWalletView[];
  /** money: Pricing state decoration, by default it is rendered as a balance without peaks and valleys */
  tier?: PricingTier;
  /** points: Points or point balance, unit is for display only */
  points?: PointsView;
  /** custom: Third-party custom bubble, only this form carries this data */
  custom?: CustomBalance;
}

/** Points or points balance; `full` default means there is no benchmark and does not participate in state conversion */
export interface PointsView {
  unit: string;
  total: string;
  full?: string;
}

/** The balance of a currency; `fullBalance` default means that the currency has no benchmark and does not participate in state conversion */
export interface MoneyWalletView {
  currency: string;
  total: string;
  granted: string;
  toppedUp: string;
  fullBalance?: string;
}

/** Balance unavailable: not supported, missing credentials or failed to fetch, explicitly marked but not silently */
export interface BalanceUnavailable {
  provider: string;
  ok: false;
  reason: 'unsupported' | 'credential-missing' | 'fetch-error';
  message?: string;
}

/** Balance status: available view or unavailable flag */
export type BalanceState = BalanceView | BalanceUnavailable;

/** Window category, has nothing to do with service provider */
export type WindowKey = 'rolling' | 'weekly' | 'monthly';

/** A window's quota overview, used for sentence judgment of the association box */
export interface WindowUsage {
  label: string;
  percent: number;
  /** Full quota (USD), default if cannot be calculated */
  quotaUsd?: number;
  /** Remaining quota (USD), default when the full quota is unknown */
  remainingUsd?: number;
  resetsAt?: string;
}

/** bubble row data: role determines the style class at both ends, tier is used for peak and valley coloring */
export type BalanceBubbleRow =
  | { role: 'label'; text: string }
  | { role: 'sub'; text: string }
  | { role: 'error'; text: string }
  | { role: 'tier'; tier: PricingTier; text: string }
  | {
      /** A line in the expanded state corresponds to a window */
      role: 'quota';
      /** Plain text fallback, consumers who do not know the role can also display this line as is */
      text: string;
      label: string;
      /** Progress bar length, the value is the used percentage */
      percent: number;
      tone: QuotaTone;
      usedText: string;
      resetText: string;
    }
  | {
      /** Usage page: Cards with three rows and two columns. The text has been arranged by shared. The renderer is only responsible for coloring and alignment. */
      role: 'usage';
      /** Plain text fallback, consumers who do not recognize the role can also display this block as a line */
      text: string;
      /** Upper left: fixed label */
      title: string;
      /** Upper right: Total amount of interval (large characters, the only visual focus of the entire card) */
      total: string;
      /** Second line left: input */
      input: string;
      /** Second row right: output */
      output: string;
      /** Third row left: interval and number of requests */
      period: string;
      /** Third row on the right: Spending */
      spend: string;
      /** Enter the proportion (0-100) to drive the in and out proportion bar; the default is when the total amount is 0, no bar is drawn at this time */
      inputPercent?: number;
    };

/** Judgment result of whether to pop up text description for unavailable status */
export interface BalanceNoticeDecision {
  /** true indicates that the bubble should be played this time, false indicates that the same reason has been prompted and is not an explicit request */
  show: boolean;
  /** The reason for this prompt is identified. The status of ok is null. The caller saves it for next comparison. */
  key: string | null;
}
