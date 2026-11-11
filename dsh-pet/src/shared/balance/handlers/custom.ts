/**
 * custom form: Take out the node tree handed over by the third party from the view.
 *
 * This document does not produce text, nor does it determine what it looks like—the layout, font size, color,
 * and progress bar are all declared by the other party in the tree. The verification is not here: the parsing layer
 * (parseCustomNode) has cut tag, style and capacity. The data here is considered credible and the renderer will no
 * longer filter it.
 *
 * @module dsh-pet/src/shared/balance/handlers/custom
 */

import type { BalanceBubbleRow } from '../types.ts';
import type { ShapeHandler } from './shape.ts';

/** Display rules for the custom form: only the percentage and node tree have values, and all row data are empty. */
export const customHandler: ShapeHandler = {
  /** The percentage is directly given by the third party (only he knows the denominator of his own quota); if not given, the state animation will not be played. */
  percent: (v) => v.custom?.percent,
  /** Row data is a built-in morphological display language, custom does not participate, and an empty array fallback is returned instead of disordered rows */
  rows: (): BalanceBubbleRow[] => [],
  detail: (): BalanceBubbleRow[] => [],
  views: (v) => v.custom?.views,
};
