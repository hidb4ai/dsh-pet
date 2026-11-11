/**
 * Main export of bubble row data: Convert balance status to bubble row, browser and desktop share the same content and
 * copy.
 *
 * Pure function, do not touch DOM and React; the copy related to the form is not here. This module is only responsible
 * for the description line of the unavailable state, and the rest is published according to the form. This must always
 * be true: never falsify a number when it is not available.
 *
 * @module dsh-pet/src/shared/balance/view
 */

import { HANDLERS } from './handlers/index.ts';
import type { BalanceBubbleRow, BalanceState, BalanceUnavailable, CustomNode } from './types.ts';

/**
 * Bubble line for unavailable status: Give the reason explicitly and never fake numbers.
 *
 * Empty secondary rows will be eliminated - empty div will occupy one row height in the bubble.
 */
function unavailableRows(state: BalanceUnavailable): BalanceBubbleRow[] {
  const rows: BalanceBubbleRow[] =
    state.reason === 'unsupported'
      ? [
          { role: 'error', text: '当前服务商暂不支持余额查询' },
          { role: 'sub', text: '当前服务商：' + state.provider },
        ]
      : state.reason === 'credential-missing'
        ? [
            // message of host already has the prefix "missing certificate X". It is displayed here as it is without adding the prefix.
            { role: 'error', text: '缺少余额查询凭证' },
            { role: 'sub', text: state.message ?? '' },
          ]
        : [
            { role: 'error', text: '余额查询失败' },
            { role: 'sub', text: state.message ?? '' },
          ];
  return rows.filter((r) => r.role !== 'quota' && r.text !== '');
}

/**
 * Render balance status into bubble row data.
 *
 * The form copy is provided by each handler; the custom form returns an empty array - it takes the parallel path of
 * the node tree (see customViews below), and the empty array only falls back into an empty bubble when row data is
 * misused. Explicitly show why when unavailable and never fake numbers.
 */
export function balanceBubbleView(state: BalanceState): BalanceBubbleRow[] {
  if (!state.ok) return unavailableRows(state);
  return HANDLERS[state.shape].rows(state);
}

/**
 * The expanded bubble row is displayed after clicking on the balance bubble.
 *
 * Only windows has three windows that can be expanded, with one line for each existing window; money and points have
 * no window concept and fallback to the collapsed view to avoid empty interactions where nothing changes after
 * clicking.
 */
export function balanceDetailView(state: BalanceState): BalanceBubbleRow[] {
  if (!state.ok) return unavailableRows(state);
  const handler = HANDLERS[state.shape];
  return handler.detail ? handler.detail(state) : handler.rows(state);
}

/**
 * The number of pages that can be turned for the balance bubble: Unavailable, only one page of description; windows is
 * at least two pages (collapsed state + window details), and one more page will be provided by the service provider
 * for the range usage; custom is based on the number of pages in the node tree, and there is no new content when
 * clicking on other forms.
 *
 * The page number and {@link balancePageView} must have the same origin: once on both sides, a blank page will appear.
 */
export function balancePageCount(state: BalanceState): number {
  if (!state.ok) return 1;
  if (state.shape === 'custom') return Math.max(1, customViews(state)?.length ?? 1);
  if (state.shape !== 'windows') return 1;
  return state.usage ? 3 : 2;
}

/**
 * Specify the bubble row data of the specified page: 0 under windows is the collapsed state, 1 is the window details,
 * and 2 is the interval usage.
 *
 * Out-of-bounds page fallback to the last page with content, instead of returning an empty array - a blank bubble is
 * more broken than stopping at the previous page.
 */
export function balancePageView(state: BalanceState, page: number): BalanceBubbleRow[] {
  if (!state.ok) return unavailableRows(state);
  const handler = HANDLERS[state.shape];
  if (state.shape !== 'windows' || page <= 0) return handler.rows(state);
  if (page === 1 || !state.usage) return balanceDetailView(state);
  return handler.usage?.(state) ?? balanceDetailView(state);
}

// The custom bubble (custom form) takes the parallel channel of the node tree: the row data is determined by the
// plugin, and only the copy is filled in; the node tree leaves the layout itself to a third party. The two channels
// are mutually exclusive according to shape. The rendering entry points at both ends can be judged once each, and the
// rest of the display logic is shared.

/**
 * Multi-page node tree: Only the custom form has a value, the other forms return undefined, and the caller fallsback
 * the row data accordingly. The first item is the initial page; if there is more than one item, bubble can be clicked.
 * Click to cut to the next page, and the last page will return to the first page.
 */
export function customViews(state: BalanceState): CustomNode[] | undefined {
  if (!state.ok || state.shape !== 'custom') return undefined;
  const views = HANDLERS[state.shape].views?.(state);
  return views && views.length > 0 ? views : undefined;
}

/**
 * Whether the custom bubble can be clicked to cut the page, the two ends will determine whether the bubble can be
 * clicked accordingly.
 *
 * When there is only one page, there is no other content when you click it. If it remains unclickable, the bubble will
 * continue to not block the page.
 */
export function customClickable(state: BalanceState): boolean {
  return (customViews(state)?.length ?? 0) > 1;
}
