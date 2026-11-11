/**
 * Parsing layer: Cut the raw response of the host write/state leaf into client view.
 *
 * Whitelist transparent transmission - fields are selected one by one, and the unwritten fields are silently discarded
 * (new fields must be added here); the shape is not recognized or the field is invalid and null is returned, allowing
 * the caller to skip this beat. Never throw an exception: 1 Throwing once in s polling will interrupt the whole shot,
 * and the other leaves will not be rendered.
 *
 * @module dsh-pet/src/shared/balance/parse
 */

import type { BalanceState, BalanceUsage, CustomNode, CustomTag, MoneyWalletView, RawBalanceResult } from './types.ts';

// Customize the white list of the bubble node tree: The tree handed over by the third party is external input, and the
// parsing layer is responsible for cutting it into the range of "a bubble can be drawn". The renderer only draws it
// and does not verify it.

/** Valid tag: Only the few needed for typesetting and layout are open; `script`, `style`, `iframe`, `svg` and the like will not be recognized, and the invalid tag tree will be invalidated. */
export const CUSTOM_TAGS: readonly CustomTag[] = ['div', 'span', 'i', 'b', 'strong', 'em', 'img'];

/**
 * Valid inline style key (camelCase, same shape as React style object): covers flex layout, box model, text, rounded
 * corners and background.
 *
 * Deliberately does not include position, zIndex, transform and inset: the bubble hangs above the pet's head, which
 * will cause the content to escape from the bubble, cover the pet body or the host page.
 */
export const CUSTOM_STYLE_KEYS: ReadonlySet<string> = new Set([
  'display',
  'flex',
  'flexDirection',
  'flexWrap',
  'alignItems',
  'justifyContent',
  'gap',
  'margin',
  'marginTop',
  'marginRight',
  'marginBottom',
  'marginLeft',
  'padding',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'width',
  'height',
  'minWidth',
  'maxWidth',
  'minHeight',
  'maxHeight',
  'color',
  'fontSize',
  'fontWeight',
  'fontStyle',
  'lineHeight',
  'letterSpacing',
  'textAlign',
  'textDecoration',
  'whiteSpace',
  'verticalAlign',
  'fontVariantNumeric',
  'background',
  'backgroundColor',
  'border',
  'borderTop',
  'borderBottom',
  'borderLeft',
  'borderRight',
  'borderRadius',
  'overflow',
  'opacity',
]);

/** Fragments that are always prohibited in style values: external resources, expressions, and comment truncation. Please use the `img` node if you want a diagram (the address is subject to other restrictions). */
const BANNED_STYLE_VALUE = /url\(|expression|javascript:|vbscript:|@import|\\|\/\*/i;

/**
 * The maximum capacity of the node tree: the bubble width is only about 155 px, and it hangs above the pet's head.
 *
 * There are two types of processing for exceeding the limit: text truncation (the content can still be read) and
 * invalidation of the entire tree (if you draw less one piece, you will get a deceptive tree. It is better not to
 * display this shot).
 */
export const CUSTOM_LIMITS = {
  /** The upper limit of depth, the root is 0, if it exceeds the depth limit, the entire tree will be discarded. */
  maxDepth: 6,
  /** The upper limit of the number of nodes in the whole tree. If it exceeds the upper limit, the whole tree will be invalid. */
  maxNodes: 200,
  /** The upper limit of the number of child nodes of a single node is exceeded. If the number of child nodes exceeds the limit, the entire tree will be invalid. */
  maxChildren: 24,
  /** The upper limit of a single paragraph of text exceeds the truncation limit */
  maxText: 120,
  /** The upper limit of a single style value. If it exceeds the upper limit, only the attribute will be lost. */
  maxStyleValue: 64,
  /** img address upper limit, including scheme */
  maxSrc: 512,
  /** Maximum number of multi-page pages: Too many pages can easily burst the bubble capacity. */
  maxViews: 4,
} as const;

/**
 * Recursively parse and verify a node and convert external input into a view tree.
 *
 * If any node is invalid, the entire tree will return null: Partial rendering will result in a bubble with a missing
 * piece, which is more misleading than not displaying it at all; if a single style attribute is invalid, only that one
 * will be lost, and it is not worth invalidating the entire tree.
 *
 * @param raw - external node; the type is unknown, and it is checked layer by layer before entering the view tree.
 * @param depth - Current depth, root at 0.
 * @param budget - Full tree node count, shared across recursions.
 * @returns is a valid node; if it is invalid, it returns null, and the caller skips this beat accordingly.
 */
function parseCustomNode(raw: unknown, depth: number, budget: { nodes: number }): CustomNode | null {
  if (!raw || typeof raw !== 'object') return null;
  if (depth >= CUSTOM_LIMITS.maxDepth) return null;
  budget.nodes += 1;
  if (budget.nodes > CUSTOM_LIMITS.maxNodes) return null;

  const n = raw as Record<string, unknown>;
  const tag = typeof n.tag === 'string' ? n.tag : '';
  if (!CUSTOM_TAGS.includes(tag as CustomTag)) return null;

  const node: CustomNode = { tag: tag as CustomTag };

  // Text that is too long is truncated without being invalidated: It is very common for third parties to write long text, and the bubble is still readable after truncation.
  if (typeof n.text === 'string' && n.text.length > 0) node.text = n.text.slice(0, CUSTOM_LIMITS.maxText);

  // The img address only recognizes http and https: `file:` will cause the rendering process to read any local file.
  if (tag === 'img') {
    const src = typeof n.src === 'string' ? n.src.trim() : '';
    if (!/^https?:\/\//i.test(src) || src.length > CUSTOM_LIMITS.maxSrc) return null;
    node.src = src;
  }

  // Style keys are whitelisted, and values are filtered one by one: if they are too long, contain references to external resources, or are empty, only this one will be discarded.
  if (n.style && typeof n.style === 'object' && !Array.isArray(n.style)) {
    const style: Record<string, string> = {};
    for (const [k, v] of Object.entries(n.style as Record<string, unknown>)) {
      if (!CUSTOM_STYLE_KEYS.has(k)) continue;
      if (typeof v !== 'string') continue;
      const value = v.trim();
      if (value === '' || value.length > CUSTOM_LIMITS.maxStyleValue) continue;
      if (BANNED_STYLE_VALUE.test(value)) continue;
      style[k] = value;
    }
    if (Object.keys(style).length > 0) node.style = style;
  }

  if (Array.isArray(n.children)) {
    if (n.children.length > CUSTOM_LIMITS.maxChildren) return null;
    const children: CustomNode[] = [];
    for (const child of n.children) {
      const parsed = parseCustomNode(child, depth + 1, budget);
      if (parsed === null) return null;
      children.push(parsed);
    }
    if (children.length > 0) node.children = children;
  }

  return node;
}

/** Optional number: undefined is returned by default, null is returned if it occurs but is invalid, so the caller skips this beat instead of sending the bad number to the display layer. */
function optNum(value: unknown): number | undefined | null {
  if (value === undefined || value === null) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Accumulated usage in the parsing interval: undefined is returned by default (the service provider does not have this
 * data), null is returned if it is incomplete or invalid.
 *
 * Five numbers are indispensable - if one is missing, it will not be possible to construct a credible usage on the
 * page. It would rather not be displayed in the entire film than to be replaced by 0.
 */
function parseUsage(raw: unknown): BalanceUsage | undefined | null {
  if (raw === undefined) return undefined;
  if (!raw || typeof raw !== 'object') return null;
  const u = raw as Record<string, unknown>;
  const fields = [u.totalTokens, u.inputTokens, u.outputTokens, u.requests, u.spentUsd].map(optNum);
  if (fields.some((n) => typeof n !== 'number')) return null;
  const [totalTokens, inputTokens, outputTokens, requests, spentUsd] = fields as number[];
  return { totalTokens, inputTokens, outputTokens, requests, spentUsd };
}

/**
 * Convert the original response of the balance of host (`sections.balance` leaf) into the client view.
 *
 * If the shape is invalid or shape is not recognized, null is returned, and the consumer skips this beat accordingly;
 * no exception is thrown here, the reason is shown in the module header. Fetching failure does not occur here: host
 * fetching failure will write the status as `ok:false` , which is normally mapped to an unavailable view.
 */
export function toBalanceState(raw: unknown): BalanceState | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as RawBalanceResult;
  const provider = String(r.provider ?? 'unknown');
  if (r.ok !== true) {
    const reason =
      r.reason === 'unsupported' || r.reason === 'credential-missing' || r.reason === 'fetch-error'
        ? r.reason
        : 'fetch-error';
    return { provider, ok: false, reason, message: typeof r.message === 'string' ? r.message : undefined };
  }

  const d = r.data;
  if (!d || typeof d !== 'object') return null;

  if (r.shape === 'windows') {
    const monthly = optNum(d.monthly);
    const rolling = optNum(d.rolling);
    const weekly = optNum(d.weekly);
    const rollingCapUsd = optNum(d.rollingCapUsd);
    const weeklyCapUsd = optNum(d.weeklyCapUsd);
    const monthlyCapUsd = optNum(d.monthlyCapUsd);
    const usage = parseUsage(d.usage);
    // The monthly window is the bottom line of this data: if it is missing or invalid, the response cannot be recognized. The rolling window, weekly window and each window quota are all optional.
    if (monthly === undefined || monthly === null) return null;
    // The optional window appears but is invalid, and the whole shot is also skipped: bad numbers are not sent to the display layer.
    if (
      rolling === null ||
      weekly === null ||
      rollingCapUsd === null ||
      weeklyCapUsd === null ||
      monthlyCapUsd === null ||
      usage === null
    ) {
      return null;
    }
    return {
      provider,
      shape: 'windows',
      ok: true,
      rolling,
      weekly,
      monthly,
      rollingCapUsd,
      weeklyCapUsd,
      monthlyCapUsd,
      // If there is no usage, this key will not be included: the page number is determined by "the presence or absence of the key". Writing undefined will cause the consumer to judge both writing methods once.
      ...(usage ? { usage } : {}),
      rollingLabel: typeof d.rollingLabel === 'string' && d.rollingLabel.length > 0 ? d.rollingLabel : undefined,
      rollingResetsAt: typeof d.rollingResetsAt === 'string' ? d.rollingResetsAt : undefined,
      weeklyResetsAt: typeof d.weeklyResetsAt === 'string' ? d.weeklyResetsAt : undefined,
      monthlyResetsAt: typeof d.monthlyResetsAt === 'string' ? d.monthlyResetsAt : undefined,
    };
  }
  if (r.shape === 'money') {
    // Multiple currencies: Each item must have currency and total. granted and toppedUp are recorded as '0.00' by
    // default (only used to display sub-items and do not participate in the scale). fullBalance by default means that
    // the currency has no benchmark. If a single structure is invalid, discard this one - one less currency is better
    // than not rendering the entire shot.
    const raw = Array.isArray(d.wallets) ? d.wallets : [];
    const wallets: MoneyWalletView[] = [];
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const w = item as Record<string, unknown>;
      if (typeof w.currency !== 'string' || w.currency.length === 0) continue;
      if (typeof w.total !== 'string' || w.total.length === 0) continue;
      wallets.push({
        currency: w.currency,
        total: w.total,
        granted: typeof w.granted === 'string' && w.granted.length > 0 ? w.granted : '0.00',
        toppedUp: typeof w.toppedUp === 'string' && w.toppedUp.length > 0 ? w.toppedUp : '0.00',
        fullBalance: typeof w.fullBalance === 'string' && w.fullBalance.length > 0 ? w.fullBalance : undefined,
      });
    }
    // There is no wallet, that is, the response cannot be recognized: host. The empty wallet is written as fetch-error. Coming here means that the structure is broken.
    if (wallets.length === 0) return null;
    return {
      provider,
      shape: 'money',
      ok: true,
      wallets,
      tier: d.tier === 'peak' || d.tier === 'idle' ? d.tier : undefined,
    };
  }
  if (r.shape === 'points') {
    // unit and total are indispensable: "800 points" cannot be spelled out without units, and it cannot be displayed
    // without numbers. The default or empty string of full means that there is no basis and does not participate in
    // state conversion. It has the same conventions as fullBalance of money.
    if (typeof d.unit !== 'string' || d.unit.length === 0) return null;
    if (typeof d.total !== 'string' || d.total.length === 0) return null;
    return {
      provider,
      shape: 'points',
      ok: true,
      points: {
        unit: d.unit,
        total: d.total,
        full: typeof d.full === 'string' && d.full.length > 0 ? d.full : undefined,
      },
    };
  }
  if (r.shape === 'custom') {
    // The two writing methods are unified: views multi-page priority, rows plus optional detailRows is the old
    // two-page writing method; when both are given, views shall prevail. Don’t let the mixing of old and new result in
    // the failure of the whole shooting.
    let views: CustomNode[] = [];
    if (Array.isArray(d.views) && d.views.length > 0) {
      if (d.views.length > CUSTOM_LIMITS.maxViews) return null;
      for (const raw of d.views) {
        const page = parseCustomNode(raw, 0, { nodes: 0 });
        // If any page is invalid, the entire page will be skipped: it will not be in a semi-bad state of "the first few pages are normal, but the next page will crash".
        if (!page) return null;
        views.push(page);
      }
    } else {
      const rows = parseCustomNode(d.rows, 0, { nodes: 0 });
      if (!rows) return null;
      views = [rows];
      if (d.detailRows !== undefined) {
        const detail = parseCustomNode(d.detailRows, 0, { nodes: 0 });
        // If you give it but it is invalid, the entire shot will be skipped: silently discarding the "cutable page" will make the third party think that clicking it has an effect.
        if (!detail) return null;
        views.push(detail);
      }
    }
    // The percentage is clamped between 0 and 100: out of bounds is a data error and does not mean exhausted or not consumed; if the value is invalid, the state animation will not be played.
    const pct =
      typeof d.percent === 'number' && Number.isFinite(d.percent) ? Math.max(0, Math.min(100, d.percent)) : undefined;
    return { provider, shape: 'custom', ok: true, custom: { views, percent: pct } };
  }
  return null;
}
