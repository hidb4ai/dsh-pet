/**
 * Multi-monitor geometry: Model the "desktop" as the union of the workspace rectangles, rather than their bounding
 * rectangles. When placed irregularly, a large hole will be left that does not belong to any screen (actually measured
 * is nearly a quarter of the area of the right-inverted T double screen), and the bounded rectangle will put the pet
 * in a place where the user cannot see it. The coordinate system is determined by the caller. This document does not
 * assume that the origin is at 0; the browser side overlay has only one screen and degenerates into a single
 * rectangle.
 * @module dsh-pet/src/shared/displays
 */
import type { Rect } from './types.ts';

/** Right edge of rectangle (not included). */
export const rectRight = (r: Rect): number => r.x + r.width;
/** Lower edge of rectangle (not included). */
export const rectBottom = (r: Rect): number => r.y + r.height;

/** Encircling rectangle: It is still used for viewport origin and scale conversion, but the boundary determination is always based on union; an empty list returns 0×0. */
export const boundingRect = (rects: Rect[]): Rect => {
  if (rects.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const r of rects) {
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, rectRight(r));
    y1 = Math.max(y1, rectBottom(r));
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
};

/** Whether the point falls within the rectangle (excluding the right/lower edge): When the gap between two adjacent screens is 0, the point falls on the left/top area. */
export const pointInRect = (r: Rect, x: number, y: number): boolean =>
  x >= r.x && x < rectRight(r) && y >= r.y && y < rectBottom(r);

/** Which screen is the point covered by? If not, null. When overlapping, the first block in the list is taken (consistent with Chromium "first discovered first"). */
export const rectAtPoint = (rects: Rect[], x: number, y: number): Rect | null => {
  for (const r of rects) if (pointInRect(r, x, y)) return r;
  return null;
};

/** Same as rectAtPoint, returns the subscript (−1 = no coverage); when throwing, use the subscript to cover the current screen. */
export const indexAtPoint = (rects: Rect[], x: number, y: number): number => {
  for (let i = 0; i < rects.length; i++) if (pointInRect(rects[i], x, y)) return i;
  return -1;
};

/** The square of the shortest distance from the point to the rectangle (the point is 0 within the rectangle). */
export const distToRectSq = (r: Rect, x: number, y: number): number => {
  const dx = Math.max(r.x - x, 0, x - rectRight(r));
  const dy = Math.max(r.y - y, 0, y - rectBottom(r));
  return dx * dx + dy * dy;
};

/** Screen index closest to point; empty list returns −1. Used to return pets to places after they fall into hollows or the screen is unplugged. */
export const nearestIndex = (rects: Rect[], x: number, y: number): number => {
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < rects.length; i++) {
    const d = distToRectSq(rects[i], x, y);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
};

/** The screen where the point is located; if it is not on any screen, take the nearest block (null will be returned only when the list is empty). */
export const resolveRect = (rects: Rect[], x: number, y: number): Rect | null => {
  const hit = rectAtPoint(rects, x, y);
  if (hit) return hit;
  const i = nearestIndex(rects, x, y);
  return i < 0 ? null : rects[i];
};

/** Clamp the point into the specified rectangle (leaving 1 px on the right/lower edge to ensure that the result still satisfies pointInRect). */
export const clampPointInRect = (r: Rect, x: number, y: number): { x: number; y: number } => ({
  x: Math.min(Math.max(x, r.x), rectRight(r) - 1),
  y: Math.min(Math.max(y, r.y), rectBottom(r) - 1),
});

/** Clamp the point into the union: it has been returned as it is in the union, otherwise it will be clamped into the nearest screen. It is used to pull pets that have fallen into the cavity back into the visible area after the monitor is unplugged and plugged in. */
export const clampPointToRegion = (rects: Rect[], x: number, y: number): { x: number; y: number } => {
  if (rectAtPoint(rects, x, y)) return { x, y };
  const i = nearestIndex(rects, x, y);
  return i < 0 ? { x, y } : clampPointInRect(rects[i], x, y);
};

/**
 * Repositioning the pet center after the display topology changes: World coordinates are conserved, and only the point
 * that does not fall on any screen is clipped to the nearest screen. The parameters and return value are the relative
 * coordinates of the new viewport; the viewport origin translates with the topology, and directly clamping the old
 * coordinates will cause the pet to drift every time it is opened and closed.
 */
export const rebaseCenter = (
  center: { x: number; y: number },
  fromView: { x: number; y: number },
  toView: { x: number; y: number },
  areas: Rect[],
): { x: number; y: number } =>
  clampPointToRegion(areas, center.x + fromView.x - toView.x, center.y + fromView.y - toView.y);

/** Union area (when the screens do not overlap, it is equal to the sum of the areas; overlapping will result in repeated counting, for diagnosis only). */
export const regionArea = (rects: Rect[]): number => rects.reduce((s, r) => s + r.width * r.height, 0);

/** The area ratio of the external rectangle that does not belong to any screen is 0~1 (for diagnosis; accurate when the rectangles do not overlap). */
export const regionHoleRatio = (rects: Rect[]): number => {
  const hull = boundingRect(rects);
  const hullArea = hull.width * hull.height;
  if (hullArea <= 0) return 0;
  return Math.max(0, 1 - regionArea(rects) / hullArea);
};

/** Translate a group of rectangles as a whole (screen coordinates → viewport relative coordinates: minus the viewport origin). */
export const translateRects = (rects: Rect[], dx: number, dy: number): Rect[] =>
  rects.map((r) => ({ x: r.x + dx, y: r.y + dy, width: r.width, height: r.height }));
