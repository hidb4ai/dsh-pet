/**
 * Pet floating prompt: replaces the native title (its style, font, and delay are all determined by the browser or
 * system and cannot be changed), and is displayed according to the cursor position. This module gives class, style and
 * positioning pure functions; the node structure and measured width and height are left in their respective shells at
 * both ends. The coordinates are always the own viewport coordinates of each end (fixed positioning), and there will
 * be no drifting prompts when the pet moves or the window moves. The size is the CSS variable with the width of the
 * pet (the variable names at both ends are different). It is compatible with fallback, and the caller does not need to
 * pass the size. Do not use the DSH theme variable: it only exists on the DSH page, not on the desktop Electron page,
 * and will degrade to a transparent background.
 * @module dsh-pet/src/shared/tooltip
 */
/** Prompt box class (shared by both ends). */
export const TOOLTIP_CLASS = 'pet-tooltip';

/** The gap between the cursor and the prompt box (as a proportion of the pet width): 462 px under the pet, about 10 px, which is close to the offset look and feel of the native prompt. */
export const TOOLTIP_GAP_RATIO = 0.022;

/** A point (viewport coordinates). */
export type TipPoint = { x: number; y: number };
/** Rectangle (same coordinate system as TipPoint). */
export type TipRect = { x: number; y: number; w: number; h: number };

/**
 * Cursor position + actual measured size of the prompt box + allowable range → coordinates of the upper left corner of
 * the prompt box. The placement method is consistent with the original prompt: put the cursor lower right first, if
 * the right side cannot fit, flip to the left, if the lower side cannot fit, flip to the top, if it is still out of
 * bounds after flipping, it will be clamped back into the range. The size must be measured (offsetWidth/offsetHeight):
 * the flanging criterion depends on the actual width and height. If it is too large, it will fold close to the edge,
 * and if it is too small, it will cross the boundary and be cut.
 * @param cursor - cursor position.
 * @param tip - The actual measured size of the prompt box (px).
 * @param bounds - The allowed display range: the desktop side is the working area of the window ∩ screen where the
 * cursor is located, and the browser side is the entire viewport.
 * @param gap - The gap between the cursor and the prompt box (px).
 */
export function tooltipPlacement(
  cursor: TipPoint,
  tip: { w: number; h: number },
  bounds: TipRect,
  gap: number,
): TipPoint {
  const clamp = (v: number, lo: number, hi: number): number => (hi < lo ? lo : Math.min(Math.max(v, lo), hi));
  const rightMax = bounds.x + bounds.w;
  const bottomMax = bounds.y + bounds.h;
  let x = cursor.x + gap;
  if (x + tip.w > rightMax) x = cursor.x - gap - tip.w;
  x = clamp(x, bounds.x, rightMax - tip.w);
  let y = cursor.y + gap;
  if (y + tip.h > bottomMax) y = cursor.y - gap - tip.h;
  y = clamp(y, bounds.y, bottomMax - tip.h);
  return { x, y };
}

/** Prompt box style - the same copy is injected into both ends (the browser incorporates the plugin CSS, and the desktop is created with the renderer.js label style). */
export const TOOLTIP_CSS = [
  '.pet-tooltip{',
  // fixed + coordinates are written by pressing the cursor JS: left/top is just the fallback before positioning and will not be actually displayed.
  'position:fixed;left:0;top:0;',
  'max-width:calc(var(--dsh-pet-size,var(--pet-size,462px))*0.8);',
  'padding:calc(var(--dsh-pet-size,var(--pet-size,462px))*0.010) calc(var(--dsh-pet-size,var(--pet-size,462px))*0.021);',
  'border-radius:calc(var(--dsh-pet-size,var(--pet-size,462px))*0.016);',
  // Black text on white background: Align the look and feel of the native prompts. Dark capsules are too eye-catching when placed on light-colored pets.
  'background:rgba(255,255,255,.96);color:#1f1f1f;',
  // Thin border: When the white background is pressed on a light-colored pet or light-colored page, it will become blurry. Use it to draw the outline.
  'border:1px solid rgba(0,0,0,.12);',
  // The font is the same as bubble; the font family uses global configuration variables (injected in documentElement) and cannot be inherited from the pet root container
  'font-family:var(--dsh-pet-font-family,"ShangshouSoftCandy","Yuanti SC","YouYuan","幼圆","Comic Sans MS","PingFang SC","Microsoft YaHei",sans-serif);',
  // Font size alignment Windows native prompt (9 pt ≈ 12 px): 462 px pet under 0.026 → about 12 px.
  // --dsh-pet-font-tip is injected according to the size of the pet at both ends (shared/fonts.ts of resolveFontPx).
  // If not injected, the original expression is returned.
  'font-size:var(--dsh-pet-font-tip,calc(var(--dsh-pet-size,var(--pet-size,462px))*0.026));line-height:1.4;',
  // nowrap + truncation: the width is locked into one line so that it can be placed with the cursor (line wrapping will cause the width to jump with the position)
  'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;',
  // No backdrop-filter: White background is not necessary, and there is no frosted glass in the native prompt.
  'box-shadow:0 calc(var(--dsh-pet-size,var(--pet-size,462px))*0.004) calc(var(--dsh-pet-size,var(--pet-size,462px))*0.013) rgba(0,0,0,.18);',
  // The level is lower than bubble: the two do not occupy the same place (the prompt is with the cursor, and the bubble is above the head), retaining the level sequence is just fallback
  'opacity:0;transition:opacity .12s ease;pointer-events:none;z-index:2}',
  '.pet-tooltip.is-on{opacity:1}',
].join('');
