/**
 * A display form needs to provide display rules, which are assembled from handlers/index.ts into
 * `Record<BalanceShape, ShapeHandler>` .
 *
 * The purpose of splitting it into percent, rows, detail and views is to keep all the display knowledge of a form in
 * one file: to add a form, you only need to write a new handler, and there is no need to insert a branch in the main
 * process.
 *
 * @module dsh-pet/src/shared/balance/handlers/shape
 */

import type { BalanceBubbleRow, BalanceView, CustomNode } from '../types.ts';

/** All rules provided by a presentation form to the presentation layers at both ends. */
export interface ShapeHandler {
  /** Used percentage to drive pet state animation; undefined means that this form cannot provide percentage semantics */
  percent(v: BalanceView): number | undefined;
  /** Collapse bubble line */
  rows(v: BalanceView): BalanceBubbleRow[];
  /** Expand bubble line; default means no additional readings, caller fallback to rows */
  detail?(v: BalanceView): BalanceBubbleRow[];
  /** The third page: cumulative usage in the interval; returning undefined means that the service provider does not have this data, and bubble only has two pages. */
  usage?(v: BalanceView): BalanceBubbleRow[] | undefined;
  /** custom: Multi-page node tree, the first item is the initial page; the default means that this form does not go through the tree */
  views?(v: BalanceView): CustomNode[] | undefined;
}
