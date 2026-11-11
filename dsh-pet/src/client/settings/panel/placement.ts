/**
 * Set the positioning calculation of the floating layer on the page: convert the measured rectangle of the trigger and
 * the size of the viewport into the fixed coordinates of the floating layer. If the lower part cannot fit and the
 * upper part has more room, flip it to the upper part, clamp the left and right sides within the viewport, and provide
 * an upper limit for the height - the floating layer itself does not enter the document flow. Pure function, do not
 * read `window` : The rectangle and viewport are passed in by the caller, which facilitates single testing and future
 * positioning outside the viewport. The model selector and the universal radio selection drop-down share this
 * arithmetic. The difference is only passed in through {@link PlacementOptions} and is not copied separately in the
 * caller.
 * @module dsh-pet/src/client/settings/panel/placement
 */

/** The spacing between the floating layer and the trigger and the edge of the viewport. */
const PANEL_GAP_PX = 12;
/** The floating layer is offset from the trigger to avoid sticking to the trigger frame. */
const PANEL_OFFSET_PX = 4;
/** Viewport margin: Leave 8 px on the left and right sides of the floating layer, and do not stick to the edge of the screen. */
const EDGE_MARGIN_PX = 8;
/** The fallback margin of the overlay width when the viewport is narrower. */
const VIEWPORT_INSET_PX = 16;
/** When the viewport is so narrow that it cannot fit in it, it is still rendered according to this width. */
const MIN_AVAILABLE_WIDTH_PX = 200;

/** The measured rectangle of the trigger has the same semantics as the fields of `DOMRect`. */
export interface AnchorRect {
  left: number;
  top: number;
  bottom: number;
  width: number;
}

/** Viewport size, usually directly taken as `window.innerWidth` / `innerHeight`. */
export interface Viewport {
  width: number;
  height: number;
}

/** fixed positioning and size of the floating layer; only one of `top` and `bottom` has a value. */
export interface PanelPosition {
  left: number;
  top?: number;
  bottom?: number;
  width: number;
  maxHeight: number;
}

/** The default value overridden by the floating layer content; the default is the value of the model selector. */
export interface PlacementOptions {
  /** Lower limit of floating layer width (px): The model list must contain the two paragraphs "Service Provider + Model", so the default is 240; single-line drop-down pass 0 to have the same width as the trigger. */
  minWidthPx?: number;
  /** The upper limit of floating layer width (px), default 420: any wider will span the entire settings page. */
  maxWidthPx?: number;
  /** The upper limit of floating layer height (px), default 360: the list will scroll after it is exceeded. */
  maxHeightPx?: number;
  /** Only when the available space below is less than it (px) will it be considered to flip to the top, the default is 240: otherwise, even if it is close to the bottom, it will be expanded downwards first. */
  flipThresholdPx?: number;
}

/**
 * Calculate where the floating layer should be attached.
 *
 * @param anchor - The measured rectangle of the flip-flop.
 * @param viewport - Viewport size.
 * @param options - Threshold override of width and flip, see {@link PlacementOptions} .
 * @returns floating layer positioning; `bottom` is given when there is more space above, otherwise `top` is given.
 */
export function computePanelPlacement(
  anchor: AnchorRect,
  viewport: Viewport,
  options: PlacementOptions = {},
): PanelPosition {
  const minWidth = options.minWidthPx ?? 240;
  const maxWidth = options.maxWidthPx ?? 420;
  const maxHeight = options.maxHeightPx ?? 360;
  const flipThreshold = options.flipThresholdPx ?? 240;
  const below = viewport.height - anchor.bottom - PANEL_GAP_PX;
  const above = anchor.top - PANEL_GAP_PX;
  const available = Math.max(MIN_AVAILABLE_WIDTH_PX, Math.min(maxWidth, viewport.width - VIEWPORT_INSET_PX));
  const width = Math.min(Math.max(anchor.width, minWidth), available);
  const left = Math.max(EDGE_MARGIN_PX, Math.min(anchor.left, viewport.width - width - EDGE_MARGIN_PX));
  // Turn it up when the lower part is too narrow to fit and the upper part is wider: the trigger near the bottom expands downward so that it does not cover the upper field.
  const openUp = below < flipThreshold && above > below;
  return openUp
    ? { left, bottom: viewport.height - anchor.top + PANEL_OFFSET_PX, width, maxHeight: Math.min(maxHeight, above) }
    : { left, top: anchor.bottom + PANEL_OFFSET_PX, width, maxHeight: Math.min(maxHeight, below) };
}
