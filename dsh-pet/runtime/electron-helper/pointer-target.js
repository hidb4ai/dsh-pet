/**
 * Click-through fallback channel pure judgment (not require electron, can be loaded directly by node:test). The window
 * defaults to click-through for the whole window. The regular link only has an entry point for the forward mouse hook
 * of Electron, and this hook will silently fail on Windows - after the failure, hovering, dragging, clicking and
 * right-clicking will have no response. This module only counts "should it be interactive". The main process is
 * responsible for taking the cursor and flipping the window; the coordinates are always DIP (the window rectangle and
 * the cursor have the same unit).
 * @module dsh-pet/runtime/electron-helper/pointer-target
 */

'use strict';

/** Pet body hit area (canvas coordinates, consistent with HIT_BOX of src/shared/constants.ts; guard test verify both are synchronized) */
const HIT_BOX = { x0: 200, y0: 50, x1: 440, y1: 335 };
/** Animation canvas size: the height is CANVAS_H of shared, and the width is the same as sprite.js / shared using the literal value 640 (shared is not exported) */
const CANVAS_H = 360;
const STAGE_W = 640;
const FEET_Y = 330;

/**
 * Window rectangle → Screen rectangle of pet body hit area (DIP).
 *
 * Window = pet bounding box + surrounding margin, and the margin is no longer equal to the four sides (the top margin
 * is increased according to the maximum height of the bubble), so you cannot push back by "window width/4", otherwise
 * the entire hit area will be offset. The left/top offset is reported by the renderer along with setBounds, and the
 * right side is calculated by the main process according to "Window Width - Body Width - Left Offset" - after the
 * window is clamped back to the workspace by the system, the body will be offset to the right in the window, and the
 * left and right are no longer the same number.
 *
 * @param bounds - window rectangle (DIP).
 * @param margins - The left/top offset reported by the renderer ( DIP ), the right side can be given in margins.r.
 */
function spriteHitRect(bounds, margins) {
  const legacy = Math.round(bounds.width / 4);
  const ml = Number.isFinite(margins?.l) ? margins.l : legacy;
  const mt = Number.isFinite(margins?.t) ? margins.t : legacy;
  const mr = Number.isFinite(margins?.r) ? margins.r : ml;
  const stageW = Math.max(0, bounds.width - ml - mr);
  const stageH = (stageW * CANVAS_H) / STAGE_W;
  const bottomPad = (stageH * (CANVAS_H - FEET_Y)) / CANVAS_H;
  return {
    left: bounds.x + ml + (HIT_BOX.x0 / STAGE_W) * stageW,
    top: bounds.y + mt + bottomPad + (HIT_BOX.y0 / CANVAS_H) * stageH,
    right: bounds.x + ml + (HIT_BOX.x1 / STAGE_W) * stageW,
    bottom: bounds.y + mt + bottomPad + (HIT_BOX.y1 / CANVAS_H) * stageH,
  };
}

/** Determine polling interval (ms) */
const POINTER_POLL_MS = 60;

/** Maximum time in milliseconds to retain input while the pointer is in a non-busy window margin; restore click-through after this timeout. */
const OFF_BODY_RELEASE_MS = 400;

/**
 * The cursor is relative to the partition of the window: ' outside ' | ' body ' | ' margin '.
 *
 * In addition to judgment, the main process also needs to stay in the accumulated margin area according to the
 * partition; the partition rules are only maintained here to avoid the drift of the two channels.
 *
 * @param bounds - window rectangle (DIP).
 * @param point - the real cursor position ( DIP ).
 * @param margins - Left/top offset reported by renderer ( DIP ), see spriteHitRect.
 * @returns partition.
 */
function pointerZone(bounds, point, margins) {
  const inWindow =
    point.x >= bounds.x &&
    point.x < bounds.x + bounds.width &&
    point.y >= bounds.y &&
    point.y < bounds.y + bounds.height;
  if (!inWindow) return 'outside';
  const r = spriteHitRect(bounds, margins);
  const inSprite = point.x >= r.left && point.x <= r.right && point.y >= r.top && point.y <= r.bottom;
  return inSprite ? 'body' : 'margin';
}

/**
 * Should the window remain click-through (the first parameter of setIgnoreMouseEvents). The position is not involved
 * at all during busy: the pet lags behind the cursor when dragging, and the position determination will interrupt the
 * pointermove/pointerup being used.
 *
 * @param ignoring - Whether it is currently click-through (taken from the main process image to avoid losing
 * synchronization with the renderer channel).
 * @param busy - whether the renderer is using mouse input for this window.
 * @param offBodyMs - The continuous stay time in the margin area (not busy).
 * @param input - The control rectangle and drag mark reported by the renderer.
 * @param margins - left/top offset reported by renderer ( DIP ).
 * @returns New click-through state.
 */
function decideWindowIgnore(bounds, point, ignoring, busy, offBodyMs = 0, input, margins) {
  if (busy) {
    if (!input || input.dragging) return false; // Compatible with old renderers; dragging leases are never interrupted by position determination
    const inControl = input.rects.some(
      (r) =>
        point.x >= bounds.x + r.x &&
        point.x < bounds.x + r.x + r.width &&
        point.y >= bounds.y + r.y &&
        point.y < bounds.y + r.y + r.height,
    );
    return !inControl && pointerZone(bounds, point, margins) !== 'body';
  }
  const zone = pointerZone(bounds, point, margins);
  if (zone === 'outside') return true; // Outside the window: restore click-through
  if (zone === 'body') return false; // On pets: Interactive
  if (offBodyMs >= OFF_BODY_RELEASE_MS) return true; // Remaining timeout in margin area: restore click-through
  return ignoring; // Margin area: keep (menu/pop-up window is covered by busy)
}

module.exports = {
  HIT_BOX,
  CANVAS_H,
  STAGE_W,
  FEET_Y,
  POINTER_POLL_MS,
  OFF_BODY_RELEASE_MS,
  spriteHitRect,
  pointerZone,
  decideWindowIgnore,
};
