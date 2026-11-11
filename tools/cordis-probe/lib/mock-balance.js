/**
 * Five mock balance service providers: three built-in forms (windows / money / points) + two kinds of **custom
 * multi-page** (custom). It only verifies the presentation layer and third-party registration entry point, and does
 * not send any network requests.
 *
 * The key points of customizing the form (this is the meaning of the last two provider in this document):
 * - The content of the bubble is a **node tree** (tag + camelCase inline style + text/child node), which is verified
 * by the plugin whitelist, and the renderers at both ends draw according to the tree; the third party can arrange it
 * however they want, without waiting for the plugin to add a form for a certain service provider;
 * - The first item of `views` is the initial page, **Click the bubble to cycle through pages** (the last page returns
 * to the first page); it cannot be clicked when there is only one page;
 * - Always use `em` for size: relative to the bubble font size, when the pet increases the font size, it will scale
 * accordingly (if px is written in, it will not follow).
 *
 * @module dsh-cordis-probe/mock-balance
 */

/** Timestamp relative to the current time (ISO): Ensure that the "N hour/day reset" in the bubble is the future time every time. */
const inHours = (hours) => new Date(Date.now() + hours * 3_600_000).toISOString();

// ----A small tool for drawing layouts (the node tree of custom bubbles is pure data, and a few primitives are enough to create any layout) ----

/** Primary text color/secondary text color/bottom tank color (the same set of values as the dsh-pet bubble theme). */
const INK = '#1f1f1f';
const MUTED = 'rgba(43,43,43,.6)';
const TRACK = 'rgba(43,43,43,.12)';

/** A text node; style can cover the font size/color/weight (empty objects will be discarded in the parsing layer, leaving no empty style). */
const text = (value, style = {}) => ({ tag: 'span', text: value, style });

/** One line (flex, justified on both ends by default). */
const row = (children, style = {}) => ({ tag: 'div', style: { display: 'flex', ...style }, children });

/** Progress bar: outer frame + inner bar, inner bar width = used percentage (clip to 0-100). */
const bar = (percent, color) => ({
  tag: 'div',
  style: { flex: '1 1 auto', height: '0.28em', borderRadius: '0.14em', background: TRACK, overflow: 'hidden' },
  children: [
    {
      tag: 'i',
      style: {
        display: 'block',
        height: '100%',
        width: Math.max(0, Math.min(100, percent)) + '%',
        background: color,
      },
    },
  ],
});

/** Corner mark (such as PRO): small characters + thin border. */
const badge = (label) => text(label, { fontSize: '0.6em', color: '#2e9e4f', border: '1px solid rgba(46,158,79,.5)', borderRadius: '0.25em', padding: '0 0.2em' });

/** Summary row: name + mini bar + percentage (for custom shape page 4). */
const summaryRow = (name, percent, color) =>
  row(
    [
      text(name, { width: '2.4em', color: MUTED, fontSize: '0.77em', whiteSpace: 'nowrap' }),
      bar(percent, color),
      text(percent + '%', { width: '2.6em', textAlign: 'right', fontSize: '0.77em', color: MUTED }),
    ],
    { alignItems: 'center', gap: '0.3em' },
  );

/** Model remaining line: model name + bar + percentage + remaining (for custom form page 1). */
const modelRow = (name, percent, left, color) =>
  row(
    [
      text(name, { width: '4.6em', color: INK, fontSize: '0.85em', whiteSpace: 'nowrap' }),
      bar(percent, color),
      text(percent + '%', { width: '2.4em', textAlign: 'right', color: INK, fontSize: '0.8em', fontWeight: '650' }),
      text(left, { width: '3.6em', textAlign: 'right', color: MUTED, fontSize: '0.72em', whiteSpace: 'nowrap' }),
    ],
    { alignItems: 'center', gap: '0.25em', padding: '0.08em 0' },
  );

/** Wallet classification column: name at the top, amount at the bottom (for custom form page 2). */
const walletColumn = (name, value, color) => ({
  tag: 'div',
  style: { display: 'flex', flexDirection: 'column', gap: '0.05em' },
  children: [text(name, { fontSize: '0.72em', color: MUTED }), text(value, { fontSize: '1.05em', fontWeight: '650', color })],
});

/** Statistical grid: name + value, with thin border (for custom shape page 3). */
const statCell = (name, value, color) => ({
  tag: 'div',
  style: {
    flex: '1 1 0',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '0.05em',
    padding: '0.15em 0',
    border: '1px solid rgba(43,43,43,.12)',
    borderRadius: '0.3em',
  },
  children: [text(name, { fontSize: '0.68em', color: MUTED }), text(value, { fontSize: '0.95em', fontWeight: '650', color })],
});

// ----Three built-in forms (leave as is: they verify the "row data" channel) ----

/** Three window usage: rolling 31%/week 8%/month 72%, the most urgent is the monthly window. */
export const mockWindows = {
  id: 'mock-windows',
  async fetch({ provider }) {
    return {
      ok: true,
      provider,
      shape: 'windows',
      data: {
        rolling: 31,
        weekly: 8,
        monthly: 72,
        rollingCapUsd: 12,
        weeklyCapUsd: 30,
        monthlyCapUsd: 60,
        rollingLabel: '5h',
        rollingResetsAt: inHours(3),
        weeklyResetsAt: inHours(50),
        monthlyResetsAt: inHours(300),
      },
    };
  },
};

/** Dual currency balance + peak and valley decoration: CNY is surplus, USD is small. */
export const mockMoney = {
  id: 'mock-money',
  async fetch({ provider }) {
    return {
      ok: true,
      provider,
      shape: 'money',
      data: {
        wallets: [
          { currency: 'CNY', total: '8.79', granted: '1.00', toppedUp: '7.79', fullBalance: '20' },
          { currency: 'USD', total: '2.40', granted: '0.00', toppedUp: '2.40', fullBalance: '5' },
        ],
        tier: 'peak',
      },
    };
  },
};

/** Point balance: 800 / 1000 (the benchmark is brought out by data, driving state). */
export const mockPoints = {
  id: 'mock-points',
  async fetch({ provider }) {
    return {
      ok: true,
      provider,
      shape: 'points',
      data: { unit: '积分', total: '800', full: '1000' },
    };
  },
};

// ----Custom form ①: Copy the existing three forms into 4 pages using node tree (page 4 is a summary of the three)
// ----
//
// Significance: Prove that "a third party using custom can generate the equivalent of the built-in form by itself"
// without having to wait for the plugin to add the form.

/** Page 1: Equivalent of windows - most urgent window + progress bar + reset countdown. */
const kindsPageWindows = {
  tag: 'div',
  children: [
    row([text('月额度已用', { color: MUTED, fontSize: '0.85em' }), text('72%', { color: INK, fontWeight: '650' })], {
      justifyContent: 'space-between',
      alignItems: 'baseline',
      gap: '0.3em',
    }),
    row([bar(72, '#e8952f'), text('12.5 天重置', { color: MUTED, fontSize: '0.77em', whiteSpace: 'nowrap' })], {
      alignItems: 'center',
      gap: '0.3em',
      marginTop: '0.15em',
    }),
  ],
};

/** Page 2: The equivalent of money - "Balance (peak) ¥8.79/$2.40" three-stage mixed arrangement + stored value/free side row. */
const kindsPageMoney = {
  tag: 'div',
  children: [
    row(
      [
        text('余额（', { color: MUTED }),
        text('峰', { color: '#e53935', fontWeight: '700' }),
        text('）¥8.79/$2.40', { color: INK, fontWeight: '650' }),
      ],
      { alignItems: 'baseline', flexWrap: 'wrap', gap: '0.1em' },
    ),
    { tag: 'div', style: { fontSize: '0.77em', color: MUTED, marginTop: '0.1em' }, text: '储值 7.79 · 赠送 1.00' },
  ],
};

/** Page 3: The equivalent of points - "Points 800 / 1000" + a progress bar converted according to the benchmark. */
const kindsPagePoints = {
  tag: 'div',
  children: [
    row([text('积分', { color: MUTED, fontSize: '0.85em' }), text('800 / 1000', { color: INK, fontWeight: '650' })], {
      justifyContent: 'space-between',
      alignItems: 'baseline',
      gap: '0.3em',
    }),
    row([bar(80, '#2e9e4f')], { alignItems: 'center', marginTop: '0.15em' }),
  ],
};

/** Page 4: Summary of the three - three progress bars of different calibers are placed on one page (the built-in form cannot do this kind of mixing). */
const kindsPageSummary = {
  tag: 'div',
  style: { display: 'flex', flexDirection: 'column', gap: '0.18em' },
  children: [
    summaryRow('额度', 72, '#e8952f'),
    summaryRow('余额', 56, '#2e9e4f'),
    summaryRow('积分', 80, '#3b7ddd'),
  ],
};

/** 4 pages of customization: one page of each of the three built-in forms + one page of summary. percent drive state animation (monthly window 72%). */
export const mockCustomKinds = {
  id: 'mock-custom-kinds',
  async fetch({ provider }) {
    return {
      ok: true,
      provider,
      shape: 'custom',
      data: {
        views: [kindsPageWindows, kindsPageMoney, kindsPagePoints, kindsPageSummary],
        percent: 72,
      },
    };
  },
};

// ----Custom form ②: Completely self-designed 3 pages (multi-model margin/wallet composition/usage statistics) ----
//
// Meaning: Structures that cannot be accommodated in the built-in three forms (multiple rows, multiple columns,
// subscripts, dividing lines, and statistical grids) can be expressed here at once.

/** Page 1: Multi-model allowance - three lines, each with a progress bar calculated according to the model allowance. */
const fancyPageModels = {
  tag: 'div',
  style: { display: 'flex', flexDirection: 'column', gap: '0.1em' },
  children: [
    modelRow('GPT-5', 78, '余 22%', '#e53935'),
    modelRow('Claude', 41, '余 59%', '#e8952f'),
    modelRow('本地网关', 12, '余 88%', '#2e9e4f'),
  ],
};

/** Page 2: Wallet composition - title + PRO corner mark + separator + two columns for stored value/gift + small words at the bottom. */
const fancyPageWallet = {
  tag: 'div',
  children: [
    row(
      [text('钱包构成', { color: INK, fontSize: '0.9em', fontWeight: '650' }), badge('PRO')],
      { justifyContent: 'space-between', alignItems: 'center' },
    ),
    { tag: 'div', style: { height: '1px', background: TRACK, margin: '0.15em 0' } },
    {
      tag: 'div',
      style: { display: 'flex', gap: '0.6em' },
      children: [walletColumn('储值', '¥7.79', INK), walletColumn('赠送', '¥1.00', '#2e9e4f')],
    },
    { tag: 'div', style: { fontSize: '0.72em', color: MUTED, marginTop: '0.15em' }, text: '总额 ¥8.79 · 基准 ¥20.00' },
  ],
};

/** Page 3: Usage statistics - three statistical grids with borders + footer prompts (the prompt page is recyclable). */
const fancyPageStats = {
  tag: 'div',
  children: [
    row([text('用量统计', { color: INK, fontSize: '0.9em', fontWeight: '650' }), text('近 30 天', { color: MUTED, fontSize: '0.7em' })], {
      justifyContent: 'space-between',
      alignItems: 'center',
    }),
    {
      tag: 'div',
      style: { display: 'flex', gap: '0.3em', marginTop: '0.15em' },
      children: [statCell('今日', '128', INK), statCell('本月', '3,204', INK), statCell('限额', '5,000', '#e8952f')],
    },
    { tag: 'div', style: { fontSize: '0.7em', color: MUTED, marginTop: '0.2em', textAlign: 'center' }, text: '点一下回到第一页' },
  ],
};

/** 3 pages of customization: The group with the most complex structure, used to suppress the "arbitrary layout" ability. percent drive state animation (65% of the balance has been used). */
export const mockCustomFancy = {
  id: 'mock-custom-fancy',
  async fetch({ provider }) {
    return {
      ok: true,
      provider,
      shape: 'custom',
      data: {
        views: [fancyPageModels, fancyPageWallet, fancyPageStats],
        percent: 65,
      },
    };
  },
};

/** The registration sequence is id sequence; one for each of the three built-in forms + two custom multi-pages. */
export const MOCK_BALANCE_PROVIDERS = [mockWindows, mockMoney, mockPoints, mockCustomKinds, mockCustomFancy];
