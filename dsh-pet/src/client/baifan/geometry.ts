/**
 * "Freeloader" geometric conversion: replace the live center point with the soles of the feet, mouth and ground line
 * (all viewport pixels).
 *
 * Pure function + a distance cache; no interfaces are touched, no DOM is written, and the position given by the caller
 * is calculated.
 * @module dsh-pet/src/client/baifan/geometry
 */
import { CFG } from './constants.ts';

/** Measuring distance cache: The last elf box measured in DOM. */
export interface SpriteBox {
  /** Sprite rendering width (pixels). */
  w: number;
  /** Sprite rendering high (pixels). */
  h: number;
}

/** The geometry of this frame (all viewport pixels) calculated from the real scene. */
export interface Geometry {
  /** Center point viewport x. */
  cx: number;
  /** Center point viewport y. */
  cy: number;
  /** Width of elf box. */
  w: number;
  /** The actual drawn content is tall (cropped from the box at 16:9). */
  h: number;
  /** Top edge of content area. */
  top: number;
  /** Sole of foot y. */
  feet: number;
  /** Mouth y. */
  mouthY: number;
  /** Scaling relative to base width. */
  scale: number;
}

/** Live: Normalized center point and orientation. */
export interface Pose {
  /** Normalized center x (0–1). */
  x: number;
  /** Normalized center y (0–1). */
  y: number;
  /** Orientation. */
  facing: 'left' | 'right';
}

/** The normalized coordinates are clamped to 0–1 (the calculated value will be out of bounds when the window is extremely small). */
export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Measure the elf box.
 *
 * First look for the `<video>` that is pressing on the center point of the live scene (the renderer draws the pet as
 * video), and its rect is the real position of the character - so you don't have to guess whether size is wide or
 * high. If it cannot be found, return to the last measured value. If it still fails, press 16:9 fallback.
 *
 * @param cx - center point viewport x.
 * @param cy - center point viewport y.
 * @param last - The last measured box (may not have been measured yet).
 * @returns The box measured this time.
 */
export function spriteBox(cx: number, cy: number, last: SpriteBox): SpriteBox {
  let best: DOMRect | null = null;
  let bestDistance = Infinity;
  for (const video of document.querySelectorAll('video')) {
    const rect = video.getBoundingClientRect();
    if (rect.width < 60 || rect.height < 30) continue;
    const distance = Math.hypot(rect.left + rect.width / 2 - cx, rect.top + rect.height / 2 - cy);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = rect;
    }
  }
  if (best !== null && bestDistance < 90) return { w: best.width, h: best.height };
  if (last.w > 0) return last;
  return { w: CFG.refWidth, h: (CFG.refWidth * 9) / 16 };
}

/**
 * Calculate the geometric quantity of this frame from the real situation.
 *
 * The asset is 16:9, but the renderer container is not necessarily 16:9 (it may be square, or it may have inner
 * margins). At that time, the character in the container will be **with black borders**. So first cut out the actual
 * drawn piece at 16:9, and then count the soles of the feet and the mouth - otherwise the soles of the feet will be
 * counted low and half of the character will be cut off by the lower edge.
 *
 * @param pose - Live.
 * @param box - Elf Box.
 * @returns The geometric quantity of this frame.
 */
export function geometry(pose: Pose, box: SpriteBox): Geometry {
  const cx = pose.x * window.innerWidth;
  const cy = pose.y * window.innerHeight;
  const contentH = Math.min(box.h, (box.w * 9) / 16);
  const padTop = (box.h - contentH) / 2;
  const top = cy - box.h / 2 + padTop;
  return {
    cx,
    cy,
    w: box.w,
    h: contentH,
    top,
    feet: top + contentH * CFG.footRatio,
    mouthY: top + contentH * CFG.mouthRatio,
    scale: box.w / CFG.refWidth,
  };
}

/** Ground line (viewport pixels, where the bottom edge of the rice falls). */
export const groundLine = (): number => window.innerHeight - CFG.groundOffset;

/**
 * When the sole of the foot falls on the ground line, where should the center point be at the normalized y.
 *
 * @param geom - Current geometric quantity.
 * @returns normalized y.
 */
export function bottomNormY(geom: Geometry): number {
  return clamp01((groundLine() - (geom.feet - geom.cy)) / window.innerHeight);
}
