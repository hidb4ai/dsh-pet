/**
 * Browser side balance and whisper bubble: dumb component, which only maps shared row data or node tree to React node.
 * No request is initiated, and the visibility and stay duration are controlled by pet.ts. balance / whisper views of
 * react and shared that rely on runtime injection. It must always be true: the style has the same source as the
 * desktop version, and the copy and file are calculated by shared.
 * @module dsh-pet/src/client/bubble
 */
import {
  balancePageView,
  customClickable,
  customViews,
  type BalanceBubbleRow,
  type BalanceState,
  type CustomNode,
} from '../shared/balance/index.ts';
import {
  MEME_BUBBLE_CLASS,
  MEME_IMG_CLASS,
  injectMemeBubbleCss,
  memeImageUrl,
  whisperBubbleView,
} from '../shared/whisper.ts';
import type { Dispatch, ReactNode, SetStateAction } from 'react';
import type * as ReactNS from 'react';
import type { jsx } from 'react/jsx-runtime';
import { ROUTE_PATH } from '../shared/constants.ts';

/**
 * bubble inline style: white translucent round bubble with a small tail at the bottom, box size anchor font size `--f`
 * , position anchor pet size.
 * width:max-content cannot be omitted: The available width of the absolute positioning box of left:50 % is only half
 * of the containing block, and shrink-to-fit will be stuck first; first get the width according to the content, and
 * then centralize it with max-width. box-sizing pegs content-box to prevent the host global border-box from counting
 * padding into the width; use break-word for word segmentation, and numbers and units will not be separated.
 */
const bubbleCss = [
  // Local font: provided by host from assets/fonts; font-display:swap first falls back and then switches.
  `@font-face{font-family:"ShangshouSoftCandy";src:url("${ROUTE_PATH}/font/上首软糖体.ttf") format("truetype");font-display:swap;font-weight:400}`,
  '.dsh-pet-bubble{position:absolute;left:50%;transform:translateX(-50%);' +
    'bottom:calc(100% - var(--dsh-pet-size)*0.108);' +
    'width:max-content;min-width:calc(var(--f)*5.7143);max-width:min(calc(var(--f)*16),100%);' +
    // Pinned content-box: The host may have set border-box globally, allowing min/max-width to include the padding,
    // which behaves like "wrap the line even though there is space"; the desktop side is also pinned, and both ends
    // are consistent.
    'box-sizing:content-box;' +
    'padding:calc(var(--f)*0.4835) calc(var(--f)*0.6593);' +
    'border-radius:calc(var(--f)*0.7692);' +
    'background:rgba(255,255,255,.92);' +
    '--f0:var(--dsh-pet-font-bubble,calc(var(--dsh-pet-size)*0.0455));--f:var(--f0);' +
    'color:#2b2b2b;font-family:var(--dsh-pet-font-family,"ShangshouSoftCandy","Yuanti SC","YouYuan","幼圆","Comic Sans MS","PingFang SC","Microsoft YaHei",sans-serif);' +
    'font-size:var(--f);line-height:1.6;z-index:3;pointer-events:none;' +
    'box-shadow:0 calc(var(--f)*0.1978) calc(var(--f)*0.7692) rgba(0,0,0,.14),0 1px 3px rgba(0,0,0,.08);' +
    'backdrop-filter:blur(6px);opacity:0;transition:opacity .25s ease;' +
    'white-space:normal;overflow-wrap:break-word}',
  // Bottom tail: small triangle points to the pet below, size anchor font size.
  '.dsh-pet-bubble::after{content:"";position:absolute;left:50%;bottom:calc(var(--f)*-0.3736);' +
    'transform:translateX(-50%);border:calc(var(--f)*0.3736) solid transparent;' +
    'border-top-color:rgba(255,255,255,.92);border-bottom:none}',
  '.dsh-pet-bubble.is-on{opacity:1}',
  // whisper variant: the font size is reduced to 0.75 of the balance bubble, the lower limit of the width is narrower, and the upper limit is the same as the line wrapping rule.
  '.dsh-pet-bubble.dsh-pet-whisper{font-size:calc(var(--f)*0.7473);' +
    'min-width:calc(var(--f)*2.1978);max-width:min(calc(var(--f)*10.989),100%)}',
  // The picture style is in shared and MEME_BUBBLE_CSS. Only the title and row styles are retained here.
  '.dsh-pet-bubble .pet-bub-title{font-size:calc(var(--f)*0.7692);color:rgba(43,43,43,.6);margin-bottom:calc(var(--f)*0.1978)}',
  '.dsh-pet-bubble .pet-bub-row{display:flex;justify-content:space-between;gap:calc(var(--f)*0.6593);flex-wrap:wrap}',
  // The stall row is composed of multiple fragments: only line breaks are done between fragments, and words are not split within the fragments to avoid vertical arrangement.
  '.dsh-pet-bubble .pet-bub-row>span{white-space:nowrap}',
  '.dsh-pet-bubble .pet-bub-sub{font-size:calc(var(--f)*0.7692);color:rgba(43,43,43,.6)}',
  '.dsh-pet-bubble .pet-bub-val{font-variant-numeric:tabular-nums;font-weight:650;color:#1f1f1f}',
  '.dsh-pet-bubble .pet-bub-err{color:#d94f3d;font-size:calc(var(--f)*0.7692)}',
  '.dsh-pet-bubble .pet-bub-tag{margin-left:calc(var(--f)*0.2857);font-size:calc(var(--f)*0.4835);color:rgba(43,43,43,.55);border:1px solid rgba(43,43,43,.25);' +
    'border-radius:calc(var(--f)*0.2857);padding:0 calc(var(--f)*0.1978);vertical-align:1px}',
  // Peak/valley pricing range: peak red, valley green.
  '.dsh-pet-bubble .pet-bub-tier{font-weight:700}',
  '.dsh-pet-bubble .pet-bub-tier-peak{color:#e53935}',
  '.dsh-pet-bubble .pet-bub-tier-idle{color:#2e9e4f}',
  // Expanded state: one line per window, the length of the progress bar is equal to the used percentage. The bubble
  // does not block the host page by default, and only expandable balance bubbles are enabled.
  '.dsh-pet-bubble.is-clickable{pointer-events:auto;cursor:pointer}',
  // The four columns of "window name + bar + percentage + reset" cannot be arranged in the collapsed state, and the expanded state is individually widened and reduced to 60% font size.
  '.dsh-pet-bubble.is-expanded{--f:calc(var(--f0)*0.6);width:min(calc(var(--f)*21),100%);max-width:100%}',
  // Fade out: Make it transparent before changing the content. After changing, remove this class and then fade in.
  '.dsh-pet-bubble.is-on.is-fading{opacity:0}',
  '.dsh-pet-bubble .pet-bub-quota{display:flex;align-items:center;gap:calc(var(--f)*0.4);margin:calc(var(--f)*0.13) 0}',
  '.dsh-pet-bubble .pet-bub-quota-label{flex:none;min-width:calc(var(--f)*1.9);font-size:calc(var(--f)*0.7692);color:rgba(43,43,43,.6)}',
  '.dsh-pet-bubble .pet-bub-quota-bar{flex:1 1 auto;height:calc(var(--f)*0.5);border-radius:calc(var(--f)*0.25);background:rgba(43,43,43,.12);overflow:hidden}',
  '.dsh-pet-bubble .pet-bub-quota-fill{display:block;height:100%;border-radius:inherit;background:#2e9e4f}',
  '.dsh-pet-bubble .pet-bub-quota-fill.pet-bub-quota-warn{background:#e8952f}',
  '.dsh-pet-bubble .pet-bub-quota-fill.pet-bub-quota-crit{background:#e53935}',
  '.dsh-pet-bubble .pet-bub-quota-used{flex:none;min-width:calc(var(--f)*2.2);text-align:right;font-variant-numeric:tabular-nums;font-weight:650;color:#1f1f1f}',
  '.dsh-pet-bubble .pet-bub-quota-reset{flex:none;min-width:calc(var(--f)*2.6);text-align:right;font-size:calc(var(--f)*0.7692);color:rgba(43,43,43,.6)}',
  // Usage page (the third page): three rows and two columns occupy the expanded state width, and the total amount is
  // the only big character. The color scheme only emphasizes the entrance/exit points, and the rest uses secondary
  // gray - more than two colors on the same page will overwhelm the value itself.
  '.dsh-pet-bubble .pet-bub-usage{display:flex;flex-direction:column;gap:calc(var(--f)*0.22);margin:calc(var(--f)*0.1) 0}',
  '.dsh-pet-bubble .pet-bub-usage-line{display:flex;align-items:baseline;justify-content:space-between;gap:calc(var(--f)*0.8);line-height:1.45}',
  '.dsh-pet-bubble .pet-bub-usage-title{font-size:calc(var(--f)*0.7692);color:rgba(43,43,43,.62)}',
  '.dsh-pet-bubble .pet-bub-usage-total{font-size:calc(var(--f)*1.45);line-height:1.2;font-weight:700;font-variant-numeric:tabular-nums;letter-spacing:-.02em;color:#1f1f1f}',
  '.dsh-pet-bubble .pet-bub-usage-in{font-size:calc(var(--f)*0.7692);font-variant-numeric:tabular-nums;color:#3f6ea8}',
  '.dsh-pet-bubble .pet-bub-usage-out{font-size:calc(var(--f)*0.7692);font-variant-numeric:tabular-nums;color:#b4703c}',
  '.dsh-pet-bubble .pet-bub-usage-period{font-size:calc(var(--f)*0.7692);color:rgba(43,43,43,.62)}',
  '.dsh-pet-bubble .pet-bub-usage-spend{font-size:calc(var(--f)*0.7692);font-weight:650;font-variant-numeric:tabular-nums;color:#1f1f1f}',
  // In/out proportion bar: The two sections are wide according to the actual proportion, and the colors correspond to the numbers below; when the proportion is extremely small, only a thin line is left and is not enlarged.
  '.dsh-pet-bubble .pet-bub-usage-bar{display:flex;height:calc(var(--f)*0.3);border-radius:calc(var(--f)*0.15);overflow:hidden;background:rgba(43,43,43,.1);margin:calc(var(--f)*0.05) 0}',
  '.dsh-pet-bubble .pet-bub-usage-bar-in{display:block;height:100%;background:#3f6ea8}',
  '.dsh-pet-bubble .pet-bub-usage-bar-out{display:block;height:100%;background:#b4703c}',
].join('\n');

/** Inject bubble style only once per page. */
function injectBubbleCss(): void {
  if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css="dsh-pet/bubble"]') === null) {
    const tag = document.createElement('style');
    tag.dataset.plugin = 'dsh-pet';
    tag.dataset.pluginCss = 'dsh-pet/bubble';
    tag.textContent = bubbleCss;
    document.head.appendChild(tag);
  }
}

/** Map the balance row data to the React node. */
function rowsToNodes(h: typeof jsx, rows: BalanceBubbleRow[]): ReactNode {
  // When state segments are included, the same line is rendered inline and peak/valley colored.
  if (rows.some((r) => r.role === 'tier')) {
    return h('div', {
      className: 'pet-bub-row',
      children: rows.map((r, i) => {
        // The progress bar line does not appear together with the state segment.
        if (r.role === 'quota') return null;
        if (r.role === 'tier') {
          return h('span', {
            key: i,
            className: 'pet-bub-tier pet-bub-tier-' + r.tier,
            children: r.text,
          });
        }
        return h('span', { key: i, children: r.text });
      }),
    });
  }
  // The rest are one block per row: label, sub, error, quota.
  return rows.map((r, i) => {
    // In the expanded state, there is one window per line; four segments flex are in the same row, and the progress bar occupies the remaining width.
    if (r.role === 'quota') {
      return h('div', {
        key: i,
        className: 'pet-bub-quota',
        children: [
          h('span', { key: 'label', className: 'pet-bub-quota-label', children: r.label }),
          h('span', {
            key: 'bar',
            className: 'pet-bub-quota-bar',
            children: h('i', {
              className: 'pet-bub-quota-fill pet-bub-quota-' + r.tone,
              style: { width: Math.max(0, Math.min(100, r.percent)) + '%' },
            }),
          }),
          h('span', { key: 'used', className: 'pet-bub-quota-used', children: r.usedText }),
          h('span', { key: 'reset', className: 'pet-bub-quota-reset', children: r.resetText }),
        ],
      });
    }
    // Usage page: three rows and two columns, the total amount is the only large character on the whole card; there is an accent color for each entry/exit, and the rest remain secondary gray.
    if (r.role === 'usage') {
      return h('div', {
        key: i,
        className: 'pet-bub-usage',
        children: [
          h('div', {
            key: 'head',
            className: 'pet-bub-usage-line',
            children: [
              h('span', { key: 'title', className: 'pet-bub-usage-title', children: r.title }),
              h('span', { key: 'total', className: 'pet-bub-usage-total', children: r.total }),
            ],
          }),
          // In/out ratio bar: The width is the actual proportion. The input usually accounts for an overwhelming majority. It is normal for the bar to be a single color.
          r.inputPercent === undefined
            ? null
            : h('div', {
                key: 'bar',
                className: 'pet-bub-usage-bar',
                children: [
                  h('i', { key: 'in', className: 'pet-bub-usage-bar-in', style: { width: r.inputPercent + '%' } }),
                  h('i', {
                    key: 'out',
                    className: 'pet-bub-usage-bar-out',
                    style: { width: 100 - r.inputPercent + '%' },
                  }),
                ],
              }),
          h('div', {
            key: 'io',
            className: 'pet-bub-usage-line',
            children: [
              h('span', { key: 'in', className: 'pet-bub-usage-in', children: r.input }),
              h('span', { key: 'out', className: 'pet-bub-usage-out', children: r.output }),
            ],
          }),
          h('div', {
            key: 'foot',
            className: 'pet-bub-usage-line',
            children: [
              h('span', { key: 'period', className: 'pet-bub-usage-period', children: r.period }),
              h('span', { key: 'spend', className: 'pet-bub-usage-spend', children: r.spend }),
            ],
          }),
        ],
      });
    }
    if (r.role === 'error') return h('div', { key: i, className: 'pet-bub-err', children: r.text });
    if (r.role === 'sub') return h('div', { key: i, className: 'pet-bub-row pet-bub-sub', children: r.text });
    return h('div', { key: i, className: 'pet-bub-row', children: r.text });
  });
}

/**
 * Map the custom node tree to the React node, parallel to rowsToNodes. The row data is formatted by the plugin. Here,
 * the tag and inline styles determined by the third party are mapped to the text as they are. The parsing layer has
 * been whitelisted, so it does not perform secondary verification; innerHTML is not used and there is no injection
 * surface. Text first, then child nodes, consistent with the textContent + appendChild order of DOM.
 */
function treeToNodes(h: typeof jsx, node: CustomNode, key: string | number): ReactNode {
  const props: Record<string, unknown> = { key };
  if (node.style) props.style = node.style;
  if (node.tag === 'img') {
    // The image address only comes from the http/https whitelist of the parsing layer; alt is left blank and is borne by the surrounding text.
    props.src = node.src ?? '';
    props.alt = '';
    return h('img', props);
  }
  const children: ReactNode[] = [];
  if (node.text) children.push(node.text);
  for (let i = 0; i < (node.children?.length ?? 0); i++) {
    children.push(treeToNodes(h, node.children![i]!, i));
  }
  props.children = children;
  return h(node.tag, props);
}

/** The fade-out wait before changing content (ms) is the same as the opacity transition of 250 ms. */
const BALANCE_FADE_MS = 250;

/**
 * Make balance bubble component (factory), inject style once. The content comes from balancePageView (fetching row
 * data by page) of shared; built-in morphological walking data, custom walking through the third-party node tree. Page
 * switching is fading out → changing content → fading in, showing and hiding, and the timing of 10 s is managed by
 * pet.ts.
 */
export function makeBalanceBubble(rt: {
  h: typeof jsx;
  useState: <T>(init: T) => [T, Dispatch<SetStateAction<T>>];
  // Use React namespace type instead of typeof: type-only import of hook cannot enter declaration export (TS4078).
  useEffect: (effect: ReactNS.EffectCallback, deps?: ReactNS.DependencyList) => void;
}): (props: {
  state: BalanceState;
  on: boolean;
  /** Target page: 0 is the initial page; in the built-in windows form, 0 is collapsed, 1 is window details, and 2 is interval usage. */
  index: number;
  /** Click bubble: the upper layer switches to the next page and resets the 10 s timer. */
  onCycle: () => void;
}) => ReactNode {
  const { h, useState, useEffect } = rt;
  injectBubbleCss();

  return function BalanceBubble({
    state,
    on,
    index,
    onCycle,
  }: {
    state: BalanceState;
    on: boolean;
    index: number;
    onCycle: () => void;
  }) {
    // shown is the actual display page, index is the target page; the separation is to leave 250 ms for fade-out content.
    const [shown, setShown] = useState(0);
    const [fading, setFading] = useState(false);
    useEffect(() => {
      if (index === shown) return;
      setFading(true);
      const timer = window.setTimeout(() => {
        setShown(index);
        setFading(false);
      }, BALANCE_FADE_MS);
      return () => window.clearTimeout(timer);
    }, [index, shown]);

    // Choose one between row data and third-party node tree; when the custom page index crosses the boundary, it is clamped to the last page to avoid displaying broken pages.
    const isCustom = state.ok && state.shape === 'custom';
    const views = isCustom ? customViews(state) : undefined;
    const tree = views ? views[Math.min(shown, views.length - 1)] : undefined;
    const rows = isCustom ? [] : balancePageView(state, shown);
    // Can be clicked: windows can be expanded; custom can only be clicked if it has more than 1 page; there is no new content when clicking on other forms.
    const clickable = state.ok && (state.shape === 'windows' || (isCustom && customClickable(state)));
    // The unavailable state is a multi-line description, using the narrow font variant of whisper.
    const wrap = state.ok ? '' : ' dsh-pet-whisper';
    // The expanded font size only belongs to the two pages of window details and usage of the built-in windows; custom pages are equivalent pages, and the compact font size should not be changed when turning pages.
    return h('div', {
      className:
        'dsh-pet-bubble' +
        wrap +
        (on ? ' is-on' : '') +
        (clickable ? ' is-clickable' : '') +
        (!isCustom && shown > 0 ? ' is-expanded' : '') +
        (fading ? ' is-fading' : ''),
      // Swallow it on the spot to avoid triggering the click and drag of the pet body.
      onClick: clickable
        ? (e: ReactNS.MouseEvent<HTMLDivElement>) => {
            e.stopPropagation();
            onCycle();
          }
        : undefined,
      children: tree ? treeToNodes(h, tree, 'tree') : rowsToNodes(h, rows),
    });
  };
}

/**
 * Create a whisper bubble component (factory) that shares styles and row rendering with the balance bubble. image is
 * the name in the pool (path based on asset root), and url is the complete address of the third party. The two are
 * mutually exclusive and guaranteed by the host decision layer. When there is a picture, it is rendered above the
 * text, and the picture style is taken from MEME_BUBBLE_CSS of shared.
 */
export function makeWhisperBubble(rt: { h: typeof jsx }): (props: {
  text: string;
  image?: string;
  url?: string;
  assetRoot?: string;
  on: boolean;
  voiceState?: 'idle' | 'loading' | 'ready' | 'failed';
  /** The callback is clickable; the working state bubble uses it to jump to the session, and it is not clickable by default. */
  onClick?: (e: ReactNS.MouseEvent<HTMLDivElement>) => void;
}) => ReactNode {
  const { h } = rt;
  injectBubbleCss();
  injectMemeBubbleCss();

  return function WhisperBubble({
    text,
    image,
    url,
    assetRoot,
    on,
    voiceState = 'idle',
    onClick,
  }: {
    text: string;
    image?: string;
    url?: string;
    assetRoot?: string;
    on: boolean;
    voiceState?: 'idle' | 'loading' | 'ready' | 'failed';
    onClick?: (e: ReactNS.MouseEvent<HTMLDivElement>) => void;
  }) {
    const rows = whisperBubbleView({ ok: true, text, ts: 0 });
    const key = String(image ?? '').trim();
    const href = String(url ?? '').trim();
    // Choose one of the two pictures: url is used directly, image is used to spell the path according to the asset root; the judgment position is on the field name, and does not rely on startsWith sniffing.
    const src = href || (key ? memeImageUrl(key, ROUTE_PATH, assetRoot) : '');
    const body = src
      ? [
          h('img', {
            key: 'img',
            className: MEME_IMG_CLASS,
            // The name form spells the route prefix of this page; the url form is the complete address and has nothing to do with origin of this page.
            src,
            alt: key || href,
          }),
          rowsToNodes(h, rows),
        ]
      : rowsToNodes(h, rows);
    return h('div', {
      className:
        'dsh-pet-bubble dsh-pet-whisper' +
        (src ? ' ' + MEME_BUBBLE_CLASS : '') +
        (on ? ' is-on' : '') +
        (onClick ? ' is-clickable' : ''),
      // Clicking on the bubble cannot leak to the pet body below: there is the hit area for dragging and "touching".
      onClick: onClick
        ? (e: ReactNS.MouseEvent<HTMLDivElement>) => {
            e.stopPropagation();
            onClick(e);
          }
        : undefined,
      children: voiceState === 'idle' ? body : [body, voiceBadgeNode(h, voiceState)],
    });
  };
}

/**
 * Voice status corner mark: only appears on manually triggered broadcasts. The lower right corner is absolutely
 * positioned and does not participate in text layout. `failed` uses a silent speaker - "it should have a sound but it
 * didn't". It is not a system warning, so there is no warning symbol.
 */
function voiceBadgeNode(h: typeof jsx, state: 'loading' | 'ready' | 'failed'): ReactNode {
  return h('span', {
    key: 'voice',
    className:
      'dsh-pet-voice-badge' + (state === 'loading' ? ' is-loading' : '') + (state === 'failed' ? ' is-failed' : ''),
    'aria-hidden': 'true',
    children: state === 'loading' ? null : state === 'failed' ? '🔇' : '🔊',
  });
}
