/**
 * Window placement and reporting: Convert the "body screen position" into a window rectangle, convert the section
 * clipped by the window manager into the body offset, and then report it to the main process.
 *
 * Clamp all four sides: When sticking to the top, the window stops at y =0, the body moves down in the window, and the
 * margin above the window is just left for the bubble. PetSprite is defined by sprite.js. This file only adds methods
 * to the prototype and must be loaded afterwards.
 * @module dsh-pet/runtime/electron-helper/sprite-window-fit
 */
'use strict';

Object.assign(PetSprite.prototype, {
  /**
   * Over-the-border allowance: at least MIN_REACHABLE_PX of the hit area should be left inside the screen, and the
   * rest can be hung outside the screen. The same rule as the web version clampReachableBox: pets can hang out, but
   * they will always be available by right-clicking. Press the "other side of the hit area" up/down to leave: when
   * hanging above, the bottom edge is left, and when hanging below, the top edge is left.
   */
  reachInset() {
    const hit = this.hitRect;
    const keep = S.MIN_REACHABLE_PX;
    return {
      left: hit.x + hit.w - keep,
      right: this.size - hit.x - keep,
      top: hit.y + hit.h - keep,
      bottom: this.winH - hit.y - keep,
    };
  },

  /**
   * Calculate window placement and apply body offset in place; all displacements go here frame by frame via
   * sendBounds.
   *
   * @returns Window content area (screen coordinate system, CSS pixels) x/y/width/height and the offset of the body
   * within the window offsetX/offsetY.
   */
  fitWindow() {
    const width = this.size + this.margin.l + this.margin.r;
    const height = this.winH + this.margin.t + this.margin.b;
    // The workspace takes the screen where the center of the main body is: when the window spans across screens, press the screen where the main body is located, which is consistent with "the window is closed in the single-screen workspace"
    const area = CONFIG.isWindowClampedToWorkArea
      ? S.resolveRect(WORK_AREAS, this.pos.x + this.halfW, this.pos.y + this.halfH)
      : undefined;
    const fit = S.fitWindowInArea({
      bodyX: this.pos.x,
      bodyY: this.pos.y,
      width,
      height,
      bodyWidth: this.size,
      // The vertical height is the "total sprite height" (including the transparent pads on the soles of the feet), not the video height: the upper limit of the offset is calculated according to the sprite to match the window size.
      bodyHeight: this.winH,
      insetX: this.margin.l,
      insetY: this.margin.t,
      reach: this.reachInset(),
      area,
    });
    this.applyWinOffset(fit.offsetX, fit.offsetY);
    return { x: fit.x, y: fit.y, width, height, offsetX: fit.offsetX, offsetY: fit.offsetY };
  },

  /** The offset of the body within the window falls to DOM; it is called frame by frame, and the style will not be written if the value does not change. */
  applyWinOffset(x, y) {
    if (this.winOffset.x === x && this.winOffset.y === y) return;
    this.winOffset.x = x;
    this.winOffset.y = y;
    this.el.style.left = x + 'px';
    this.el.style.top = y + 'px';
    window.__dshPetDebug.winOffset = { x, y };
  },

  /**
   * Report the window position and pet status to the main process: this copy is read for both hit zone determination
   * and cross-window collision sites.
   *
   * @param fit - Return value of fitWindow.
   */
  reportWindow(fit) {
    if (!window.petBridge) return;
    // The complete state is carried along once: size/bottomPad allows the stationary pet to register into the
    // collision site from the first frame; vx/vy carries the current speed (real-time value in flight, stationary/drag
    // = 0) to avoid residual old speed after landing to interfere with the collision momentum.
    const fly = this.throwState;
    window.petBridge.setBounds(
      toScreen(fit.x + VIEW.x),
      toScreen(fit.y + VIEW.y),
      toScreen(fit.width),
      toScreen(fit.height),
      toScreen(this.pos.x), // The upper left corner of the bounding box (for collision sites: window coordinates ≠ bounding box coordinates)
      toScreen(this.pos.y),
      toScreen(this.size),
      toScreen(this.bottomPad),
      fly ? toScreen(fly.vx) : 0,
      fly ? toScreen(fly.vy) : 0,
      // The distance from the origin of the window to the origin of the body (DIP): The main process calculates the
      // hit zone based on this. It is no longer equal to the margin - the offset becomes larger after the window is
      // clamped. It can only be calculated based on the reported value, and cannot be inferred based on "window
      // width/4" (see spriteHitRect).
      toScreen(fit.offsetX),
      toScreen(fit.offsetY),
    );
  },
});
