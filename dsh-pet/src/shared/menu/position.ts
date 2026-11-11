/**
 * Panel landing point geometry: Determine which side of the parent panel the cascading submenu is placed, ensuring
 * that it does not overlap with any expanded panels. Pure function, does not touch DOM; caller is only responsible for
 * reading the rectangle and writing the style.
 * @module dsh-pet/src/shared/menu/position
 */

/** Panel rectangle (only the edges used for positioning are needed). */
export interface PanelBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Input parameter of {@link pickPanelPosition}. */
export interface PanelPositionInput {
  /** The size of the panel to be placed. */
  panel: { w: number; h: number };
  /** The menu item that triggers it. */
  item: { left: number; right: number; top: number };
  /** The layer panel it belongs to: sub-panel is mounted horizontally, and only the DOM parent node can give the correct layer. */
  parent: { left: number; right: number; top: number };
  /** Rectangles of other expanded panels: the new panel must not intersect any of them. */
  others: PanelBox[];
  /** Allowed display range (window ∩ working area, viewport coordinates). */
  clamp: { x: number; y: number; w: number; h: number };
}

/** The spacing between panels and borders and panels (px). */
const PANEL_GAP = 4;

/**
 * Determine the placement point of the sub-panel: the priority is not to overlap with any expanded panel, and the
 * second is to fit the edge.
 *
 * @param input - Panel size, trigger/parent panel rectangle, other panel rectangle, and clamp range.
 * @returns The position of the upper left corner of the panel in the viewport coordinates.
 */
export function pickPanelPosition(input: PanelPositionInput): { left: number; top: number } {
  const { panel, item, parent, others, clamp } = input;
  const minLeft = clamp.x + PANEL_GAP;
  const minTop = clamp.y + PANEL_GAP;
  const maxLeft = clamp.x + clamp.w - PANEL_GAP - panel.w;
  const maxTop = clamp.y + clamp.h - PANEL_GAP - panel.h;
  /** Clamp into clamp; stick to the upper left corner when the panel is wider/higher than clamp. */
  const clampX = (v: number): number => Math.max(minLeft, Math.min(v, Math.max(minLeft, maxLeft)));
  const clampY = (v: number): number => Math.max(minTop, Math.min(v, Math.max(minTop, maxTop)));
  const hitsOther = (left: number, top: number): boolean =>
    others.some((b) => left < b.right && left + panel.w > b.left && top < b.bottom && top + panel.h > b.top);
  const fitsClamp = (left: number, top: number): boolean =>
    left >= minLeft - 0.5 && left <= maxLeft + 0.5 && top >= minTop - 0.5 && top <= maxTop + 0.5;
  const topAtItem = clampY(item.top);
  const topAtParent = clampY(parent.top);
  // Based on the parent panel (not the trigger item): the trigger item grows in the parent panel, and if you press it to turn left, it will cover the parent panel.
  const cands = [
    { left: parent.right + PANEL_GAP, top: topAtItem },
    { left: parent.left - PANEL_GAP - panel.w, top: topAtItem },
    { left: parent.right + PANEL_GAP, top: topAtParent },
    { left: parent.left - PANEL_GAP - panel.w, top: topAtParent },
  ];
  const ideal = cands.find((cd) => fitsClamp(cd.left, cd.top) && !hitsOther(cd.left, cd.top));
  if (ideal) return ideal;
  // Suboptimal: After clamping into clamp, you still need to avoid other panels - it is better to fit the edges but not overlap, than to fully position but press the upper layer.
  const fitted = cands
    .map((cd) => ({ left: clampX(cd.left), top: clampY(cd.top) }))
    .find((cd) => !hitsOther(cd.left, cd.top));
  if (fitted) return fitted;
  // fallback: The window is too narrow, and any landing point will be pressed - clamp on the right side of the parent panel, and would rather welt the edges than overlap them.
  return { left: clampX(parent.right + PANEL_GAP), top: clampY(topAtItem) };
}
