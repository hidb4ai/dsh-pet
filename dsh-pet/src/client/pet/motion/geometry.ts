/**
 * The geometry of the pet box: From the width, the half-width, half-height, foot pads and left and right margins are
 * derived, and the normalized center ↔ upper left corner of the bounding box is converted. The position command uses
 * the normalized ratio, and the drag and throw use the upper left corner pixel. The two directions must be opposite to
 * each other, otherwise the position will jump when you let go. Pure calculation: the viewport, box size and canvas
 * datum are all passed in by caller, and `window` is not read. The conversion itself does not clamp; the visible lower
 * limit of out-of-bounds placement is guaranteed by {@link clampReachableBox} when submitting the position.
 * @module dsh-pet/src/client/pet/motion/geometry
 */
import { CANVAS_H, FEET_Y, HIT_BOX, MIN_REACHABLE_PX } from '../../../shared/constants.ts';
import { bodyPixelBox } from '../../../shared/physics.ts';
import type { CSSProperties } from 'react';

/** Viewport size. */
export interface Viewport {
  width: number;
  height: number;
}

/** Half-width and half-height of the pet box (the height is derived from the width in 16:9). */
export interface HalfSize {
  w: number;
  h: number;
}

/** Normalized center (0..1, relative to the viewport). */
export interface Center {
  rx: number;
  ry: number;
}

/** Pixel coordinates of the upper left corner of the bounding box. */
export interface BoxPoint {
  x: number;
  y: number;
}

/** Derived measurements of the pet box ( px ), all derived from the width on a fixed canvas basis. */
export interface PetMetrics {
  /** Box half width. */
  halfW: number;
  /** Box half height, pushed out by width at 16:9. */
  halfH: number;
  /** The stage foot is raised: the hit box and the collision body box are moved up according to it. */
  bottomPad: number;
  /** Left and right transparent edge margin: When roaming and pinching, press the body close to the edge, and the pet can go to the edge of the screen without crossing the boundary. */
  sideAllow: number;
}

/**
 * Calculate the box measurement based on the width of the pet.
 *
 * @param size - pet width px.
 * @returns Four derived quantities, scaling linearly with width.
 */
export function derivePetMetrics(size: number): PetMetrics {
  return {
    halfW: size / 2,
    halfH: (size * 9) / 16 / 2,
    bottomPad: (size * (9 / 16) * (CANVAS_H - FEET_Y)) / CANVAS_H,
    sideAllow: (HIT_BOX.x0 / 640) * size,
  };
}

/**
 * Normalized center → the upper left corner pixel of the bounding box.
 *
 * @param center - The ratio of the center of the pet relative to the viewport.
 * @param viewport - Viewport size.
 * @param half - Half width and half height of the box.
 * @returns Root node `left` / `top` The pixel value to be written.
 */
export function centerToBox(center: Center, viewport: Viewport, half: HalfSize): BoxPoint {
  return { x: center.rx * viewport.width - half.w, y: center.ry * viewport.height - half.h };
}

/**
 * The upper left corner pixel of the bounding box → normalized center; the inverse operation of {@link centerToBox} .
 *
 * @param box - The root node's current `left` /`top` (px).
 * @param viewport - Viewport size.
 * @param half - Half width and half height of the box.
 * @returns can be submitted to the normalization center for `customPos` .
 */
export function boxToRatio(box: BoxPoint, viewport: Viewport, half: HalfSize): Center {
  return { rx: (box.x + half.w) / viewport.width, ry: (box.y + half.h) / viewport.height };
}

/**
 * The box placed out of bounds receives "the hit area is still visible at least {@link MIN_REACHABLE_PX} ".
 *
 * Pressing only one side of the single axis does not require complete visibility: the pet will still hang on the edge,
 * but it will not disappear entirely.
 *
 * @param box - The upper left corner of the box to be submitted ( px ).
 * @param viewport - Viewport size.
 * @param body - Two inputs to the hit zone: pet width and stage pad.
 * @returns The upper left corner of the box after clamping; the original value is returned when it is already within
 * the range.
 */
export function clampReachableBox(
  box: BoxPoint,
  viewport: Viewport,
  body: { size: number; bottomPad: number },
): BoxPoint {
  // The offset of the hit area relative to the box origin is directly asked by bodyPixelBox: This document does not repeat the scale conversion of HIT_BOX.
  const inset = bodyPixelBox({ x: 0, y: 0, size: body.size, bottomPad: body.bottomPad });
  const minX = MIN_REACHABLE_PX - inset.right;
  const maxX = viewport.width - inset.left - MIN_REACHABLE_PX;
  const minY = MIN_REACHABLE_PX - inset.bottom;
  const maxY = viewport.height - inset.top - MIN_REACHABLE_PX;
  const height = (body.size * 9) / 16;
  return {
    x: clampAxis(box.x, minX, maxX, (viewport.width - body.size) / 2),
    y: clampAxis(box.y, minY, maxY, (viewport.height - height) / 2),
  };
}

/**
 * Single-axis clamping: The viewport and hit area combined cannot accommodate twice the lower limit time interval
 * reversal, so it is changed to center to avoid clamping to the wrong side.
 *
 * @param value - coordinates to be clamped (px).
 * @param lo - lower allowed limit (px).
 * @param hi - Allowed upper limit (px).
 * @param centered - The center coordinate when the interval is reversed ( px ).
 * @returns coordinates after clamping (px).
 */
function clampAxis(value: number, lo: number, hi: number, centered: number): number {
  return lo > hi ? centered : Math.min(Math.max(value, lo), hi);
}

/**
 * Stage inline style: foot pad height is always in effect and will not be canceled during dragging.
 *
 * The dragging and grabbing offset is based on the bounding box of the root node (excluding this displacement). Once
 * canceled, the video will jump bottomPad relative to the cursor as a whole, let go and then fall back; the
 * displacement is constant, and the grabbing point will always fall under the cursor.
 */
export function petStageStyle(bottomPad: number): CSSProperties {
  return { transform: 'translateY(' + bottomPad + 'px)' };
}

/**
 * Compute inline positioning styles for the root node.
 *
 * Convert customPos from a normalized center to pixels. Without it, return an empty object and let corner/margin CSS
 * variables position the pet.
 * Do not clamp here: edge overlap is allowed. {@link clampReachableBox} enforces minimum visibility when committing a
 * position.
 *
 * @param customPos - Normalized center after dragging; null keeps corner positioning.
 * @param viewport - Viewport dimensions.
 * @param half - Half the box width and height.
 * @returns Fields to merge into the root style, or an empty object without a custom position.
 */
export function petRootStyle(customPos: Center | null, viewport: Viewport, half: HalfSize): CSSProperties {
  if (!customPos) return {};
  return {
    left: customPos.rx * viewport.width - half.w + 'px',
    top: customPos.ry * viewport.height - half.h + 'px',
    // For corner positioning, press data-corner to write left/right and top/bottom; the other side does not return to zero, and the two sets of positioning will take effect at the same time, and the position will jump back to the corner.
    right: 'auto',
    bottom: 'auto',
  };
}

/** Hit area style: Convert the hit box on the 640×360 canvas into a percentage relative to the pet box. */
export const PET_HIT_STYLE: CSSProperties = {
  left: (HIT_BOX.x0 / 640) * 100 + '%',
  top: (HIT_BOX.y0 / 360) * 100 + '%',
  width: ((HIT_BOX.x1 - HIT_BOX.x0) / 640) * 100 + '%',
  height: ((HIT_BOX.y1 - HIT_BOX.y0) / 360) * 100 + '%',
};
