/**
 * Moving geometry, corner positioning and window positioning: pure calculation, no DOM / ref, can be measured
 * independently. Movement planning is normalized to the viewport ratio, and px conversion is completed by caller;
 * corner positioning returns the pixel coordinates of the upper left corner of the pet root node. Not responsible for
 * the rAF driver and style writing, those in the thin shell at each end. Relying on the selection function of the
 * shared layer and the display geometry ensures that both ends calculate the same route.
 * @module dsh-pet/src/shared/motion
 */
import { randomBetween } from './pickers.ts';
import { rectAtPoint, rectBottom, rectRight } from './displays.ts';
import type { Corner, Rect } from './types.ts';

/** Geometric parameters (proportional coordinates) of a movement. */
export interface MovePlan {
  startRatio: number;
  startYRatio: number;
  targetRatio: number;
  totalRatio: number;
}

/**
 * Calculate the proportional coordinates of the starting point/end point of a movement; when the target exceeds the
 * boundary (including margins), null is returned.
 * sideAllow = Left and right transparent edge margin: The border is based on the body edge instead of the entire video
 * box edge. The pet can go to the edge of the screen without the body crossing the boundary. When areas is passed in
 * (desktop with multiple monitors), the workspace union is changed: there are screens on both sides of the gap and you
 * can walk through the gap, but the hole in the circumscribed rectangle cannot be walked in; when it is not passed, it
 * is judged as W/H single rectangle, and the browser side behavior remains unchanged.
 */
export const planMove = (o: {
  cx: number;
  cy: number;
  W: number;
  H: number;
  dir: 1 | -1;
  minDist: number;
  maxDist: number;
  margin: number;
  halfW: number;
  /** Optional: How many pixels should be left on the left/right side of the body relative to the video box (default 0 = according to the video box welt) */
  sideAllow?: number;
  /** Optional: Display workspace list (same coordinate system as cx/cy). If given, press Union to determine the reachability of the landing point. */
  areas?: Rect[];
}): MovePlan | null => {
  const side = o.sideAllow ?? 0;
  const distance = randomBetween(o.minDist, o.maxDist);
  const target = o.cx + o.dir * distance;
  if (o.areas && o.areas.length > 0) {
    // The left and right edges of the body must fall on a certain screen after expanding margin (can belong to different screens = walking on seams is allowed)
    const bodyHalf = o.halfW - side;
    if (!rectAtPoint(o.areas, target - bodyHalf - o.margin, o.cy)) return null;
    if (!rectAtPoint(o.areas, target + bodyHalf + o.margin, o.cy)) return null;
  } else {
    // margin semantics = "Safe distance from the body to the edge of the screen": the center of the box can reach margin + halfW - side (left edge of the body = margin)
    const leftBound = o.margin + o.halfW - side;
    const rightBound = o.W - o.margin - o.halfW + side;
    if (target < leftBound || target > rightBound) return null;
  }
  return {
    startRatio: o.cx / o.W,
    startYRatio: o.cy / o.H,
    targetRatio: target / o.W,
    totalRatio: Math.abs(target - o.cx) / o.W,
  };
};

/**
 * Corner + margin → pixel coordinate of the upper left corner of the pet root node, which is consistent with the CSS
 * corner semantics of the browser side overlay. When area is passed in, the corner is taken from the screen instead of
 * the viewport's external rectangle: in an irregular layout, the corner of the external rectangle may not belong to
 * any screen. Pets equipped with this corner will be invisible when powered on, so the desktop must be transferred to
 * the main screen workspace. If you press W/H when not transmitting, the behavior of overlay will remain unchanged.
 */
export const anchorPixel = (o: {
  corner: Corner;
  marginX: number;
  marginY: number;
  size: number;
  W: number;
  H: number;
  /** Optional: the work area rectangle to which the corner belongs (same coordinate system as caller); the default is {0,0, W, H} */
  area?: Rect;
}): { x: number; y: number } => {
  const height = (o.size * 9) / 16;
  const a = o.area ?? { x: 0, y: 0, width: o.W, height: o.H };
  const left = a.x + o.marginX;
  const top = a.y + o.marginY;
  const right = a.x + a.width - o.size - o.marginX;
  const bottom = a.y + a.height - height - o.marginY;
  switch (o.corner) {
    case 'top-left':
      return { x: left, y: top };
    case 'top-right':
      return { x: right, y: top };
    case 'bottom-left':
      return { x: left, y: bottom };
    case 'bottom-right':
      return { x: right, y: bottom };
  }
};

/** Window placement result: upper left corner of the window + offset of the body relative to the origin of the window. */
export interface WindowFit {
  /** The upper left corner of the window: the position of the desired value after being clamped into the work area (same coordinate system as area). */
  x: number;
  y: number;
  /** The offset of the origin of the body relative to the origin of the window: equal to the margin when not clamped, changes when clamped, and negative when out of bounds. */
  offsetX: number;
  offsetY: number;
}

/** Overrun allowance: The number of pixels that the body box can exceed the working area, calculated from the hit area and the visible lower limit. */
export interface ReachInset {
  /** Allowable amount of left out-of-bounds (px). */
  left: number;
  /** Allowable amount of out-of-bounds to the right (px). */
  right: number;
  /** Allowable amount of upward out-of-bounds (px). */
  top: number;
  /** Allowable amount of downward out-of-bounds (px). */
  bottom: number;
}

/** Single-axis clamping: When the window is larger than the work area (max < min), it sticks to the starting point, consistent with the behavior of the window manager. */
const clampAxis = (want: number, min: number, max: number): number => Math.min(Math.max(want, min), Math.max(min, max));

/**
 * Body position → Window placement: The window size is fixed, and the offset of the body within the window changes
 * accordingly.
 *
 * @remarks
 * The allowable window position of the platform for clamping the window does not include outside the work area, and
 * the part that cannot be explored is converted into the offset of the body within the window, so the foothold of the
 * body is not affected by clamping; `area` default means that the platform does not clamp the window, and the offset
 * is always equal to the margin. The section that crosses the boundary is cut off by the window, which is the same
 * rule as the visible lower limit on the web page: pets can be hung out, but a corner of the hit area is always left
 * to be clicked.
 * @param o - Geometry input: body position, window and body size, expected margin, out-of-bounds allowance, and screen
 * work area.
 * @returns The window position is offset from the main body; the caller presses { x , y , width , height } to move the
 * window, and the caller presses the offset to move the main body.
 */
export const fitWindowInArea = (o: {
  /** The desired position of the upper left corner of the body (same coordinate system as area). */
  bodyX: number;
  bodyY: number;
  /** Window size (including margin; clamping does not change the size). */
  width: number;
  height: number;
  /** The width of the main body box determines where the main body can be placed. */
  bodyWidth: number;
  /** Main body box height (including transparent pads on the soles of the feet, which is the same as the height of the window). */
  bodyHeight: number;
  /** Expected margin = window origin to body origin. */
  insetX: number;
  insetY: number;
  /** Out-of-bounds allowance; default 0, the body remains completely within the work area. */
  reach?: ReachInset;
  /** The working area of the screen where the window is located; the default means that the platform does not clamp the window and the window sticks out of the screen as it is. */
  area?: Rect;
}): WindowFit => {
  const wantX = o.bodyX - o.insetX;
  const wantY = o.bodyY - o.insetY;
  if (!o.area) return { x: wantX, y: wantY, offsetX: o.insetX, offsetY: o.insetY };
  const area = o.area;
  const reach = o.reach ?? { left: 0, right: 0, top: 0, bottom: 0 };
  // Where can the main body be placed: The work area will be expanded to reach. The section that crosses the boundary is cut off by the window, leaving a corner of the hit area that can be clicked.
  const bodyX = clampAxis(o.bodyX, area.x - reach.left, rectRight(area) - o.bodyWidth + reach.right);
  const bodyY = clampAxis(o.bodyY, area.y - reach.top, rectBottom(area) - o.bodyHeight + reach.bottom);
  // The window only follows the main body, but is clamped in the work area by the system; the difference is the offset of the main body within the window.
  const x = clampAxis(bodyX - o.insetX, area.x, rectRight(area) - o.width);
  const y = clampAxis(bodyY - o.insetY, area.y, rectBottom(area) - o.height);
  return { x, y, offsetX: bodyX - x, offsetY: bodyY - y };
};
