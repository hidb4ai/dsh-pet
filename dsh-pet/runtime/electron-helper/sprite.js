/**
 * dsh-pet desktop Helper's pet body (PetSprite class): playback, drag and drop, cross-window collision, click-through,
 * right-click menu, chat pop-up window and bubble rendering. Event linkage (balance/whisper/broadcast/working status)
 * is not in this file, see events.js; pure logic and constants come from shared-core.js. The global dependencies of
 * constants.js must be loaded later. It is always true: all displacements fall to the window via sendBounds, and
 * cross-process exchanges always centralize at toScreen/toLocal.
 * @module dsh-pet/runtime/electron-helper/sprite
 */
'use strict';

// Left click + modifier key = shortcut key for "Call out DSH". Windows / Linux use Ctrl; on macOS, Ctrl + left button
// is the system right button (contextmenu is triggered first and click cannot be obtained), so Cmd is used instead.
// The shortcut key text is selected according to the platform, and the judgment is uniformly isOpenShortcut.
const OPEN_SHORTCUT_HINT = /Mac/i.test(navigator.platform || navigator.userAgent) ? 'Cmd+左键' : 'Ctrl+左键';
/** Did you hold down the modifier key of "Call out DSH" (Ctrl / Cmd) during this click? */
const isOpenShortcut = (e) => !!(e && (e.ctrlKey || e.metaKey));

// Click sound effect: the same set of parameters as the browser (single instance audio, volume 0.5, 100 ms throttling,
// failure silence). Reuse asset channel: In bridge mode, the main process retrieves the audio, and in normal mode,
// HTTP is still used.
const CLICK_SOUND_URL = BASE + '/sound/click-duck.wav';
const CLICK_SOUND_VOLUME = 0.5;
const CLICK_SOUND_THROTTLE_MS = 100;
let clickAudio = null;
let lastClickSoundAt = 0;
const playClickSound = () => {
  // The switch comes from the resolved configuration main.clickSoundEnabled (loadConfig of renderer.js is brought in); if it is missing, it will be muted.
  if (!config || config.clickSoundEnabled !== true) return;
  const now = Date.now();
  if (now - lastClickSoundAt < CLICK_SOUND_THROTTLE_MS) return;
  lastClickSoundAt = now;
  try {
    clickAudio = clickAudio || new Audio(CLICK_SOUND_URL);
    clickAudio.volume = CLICK_SOUND_VOLUME;
    clickAudio.currentTime = 0;
    const p = clickAudio.play();
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } catch {
    /* Audio not available: silently ignored */
  }
};

// Single pet: The behavior is consistent with the browser PetCard, and the pure logic comes from src/shared
class PetSprite {
  constructor(pet) {
    this.pet = pet; // The configuration section of this pet (finished instance after flattening, entry-level fields have been blown in)
    // Page-level zoom (main process to window setZoomFactor) uniformly enlarges the entire window: pet.size is the CSS
    // pixel reference, no longer manually multiplied by CONFIG.scale; cross-process exchange is performed by
    // toScreen/toLocal centralize of constants.js.
    this.size = pet.size;
    this.height = (this.size * 9) / 16;
    this.halfW = this.size / 2;
    this.halfH = this.height / 2;
    this.bottomPad = (this.size * (9 / 16) * (S.CANVAS_H - S.FEET_Y)) / S.CANVAS_H;
    // Window height = stage height + foot pad height (the margin left by stage being moved downward by translateY ( bottomPad ) to prevent the bottom from being clipped by the window)
    this.winH = this.height + this.bottomPad;
    // Interactive area = body hit area (pixels, window coordinates). The browser can only interact with . dsh-pet-hit,
    // and the desktop is strictly aligned: everything outside the hit area (including transparent pixels) will be
    // click-through to the underlying application. HIT_BOX is a 640×360 stage coordinate: x scales according to the
    // window width, y adds bottomPad in addition to the stage height (the stage is moved down).
    this.hitRect = {
      x: (S.HIT_BOX.x0 / 640) * this.size,
      y: this.bottomPad + (S.HIT_BOX.y0 / 360) * this.height,
      w: ((S.HIT_BOX.x1 - S.HIT_BOX.x0) / 640) * this.size,
      h: ((S.HIT_BOX.y1 - S.HIT_BOX.y0) / 360) * this.height,
    };
    window.__dshPetDebug.hitRect = this.hitRect;
    // Left and right transparent edge margin (the pet's body is centered in the video box): let the border press the body to the edge - the pet can go to the edge of the screen, but the body will never cross the border.
    this.sideAllow = (S.HIT_BOX.x0 / 640) * this.size;
    window.__dshPetDebug.sideAllow = this.sideAllow;
    // Expansion around the window: left and right bottom = WINDOW_MARGIN_RATIO × pet size; the top margin is
    // calculated according to the maximum height of the bubble and the to-do panel - both anchor the font size, and
    // the window margin anchors the pet. When the pet becomes smaller or the font size is fixed, half of the pet
    // cannot fit in the margin, and the top will be cut off by the upper edge of the window. The margin is transparent
    // and click-through has no side effect; however, it is no longer equal on all four sides, so the hit area must be
    // calculated by the main process according to the reported value.
    const m = this.size * WINDOW_MARGIN_RATIO;
    const fontConf = pet.font || config.font || S.DEFAULT_FONT;
    this.margin = {
      t: Math.max(m, S.bubbleTopMarginPx(fontConf, this.size), S.todoPanelTopMarginPx(fontConf, this.size)),
      r: m,
      b: m,
      l: m,
    };
    // The offset of the body within the window: equal to the above margin when not clamped, and becomes larger when
    // the window is clamped back to the work area by the system (see fitWindow). All derivation of "window origin =
    // body position − offset" must use it, and margin cannot be directly subtracted.
    this.winOffset = { x: this.margin.l, y: this.margin.t };
    window.__dshPetDebug.winOffset = { x: this.margin.l, y: this.margin.t };
    // The position of the upper left corner of the pet bounding box in the [Workspace] coordinate system (the position of this window = the position of the pet)
    this.pos = { x: 0, y: 0 };

    // Configure derived fields: flattened instances are given priority, followed by globals, and finally built-in
    // defaults. Drag and throw physics parameters
    this.physics = pet.physics || config.physics || S.DEFAULT_PHYSICS;
    // Font: The font size is calculated according to the size of this pet; the font family is injected from renderer.js into documentElement (see above for fontConf, the same one is used for the top margin)
    this.font = fontConf;
    // The throw is locked on the current screen: true = only bounces within the screen where it was when you let go (the gap in the screen acts as a wall), false = flies across the screen as usual
    this.confineToScreen = pet.confineToScreen === true || config.confineToScreen === true;
    // The asset root is assetRoot (file pet = configuration file prefix, multiple instances share the same asset directory) or pet id fallback
    this.assetRoot = pet.assetRoot || pet.id;
    this.assetBase = BASE + '/thumb/' + encodeURIComponent(this.assetRoot) + '/';

    this.initPlayback(pet);
    this.initMotion();
    this.initPanels();
    this.buildDom();
    this.bindEvents();
  }

  dispose() {
    this.ac.abort();
    this.inputRegionMutation.disconnect();
    this.inputRegionResize.disconnect();
    this.inputRegionElements.clear();
    if (this.bubbleTimer !== null) window.clearTimeout(this.bubbleTimer);
    if (this.whisperTimer !== null) window.clearTimeout(this.whisperTimer);
    if (this.workTimer !== null) window.clearTimeout(this.workTimer);
    if (this.chatMount) {
      this.chatMount.close();
      this.chatMount = null;
    }
    this.closeMenu();
    this.stopThrow();
    this.stopDragFollow();
    this.stopSquash();
    this.stopMove();
    this.el.remove();
  }

  get facing() {
    return this._facing;
  }

  set facing(next) {
    const value = next === 'right' ? 'right' : 'left';
    if (this._facing === value) return;
    this._facing = value;
    this.markPoseDirty();
  }

  /** Live changes → handed over to throttling device (continuous changes are merged into one flush) */
  markPoseDirty() {
    if (this.poseTimer !== null) return;
    this.poseTimer = window.setTimeout(() => {
      this.poseTimer = null;
      this.reportPose();
    }, POSE_THROTTLE_MS);
  }

  /**
   * Push the current live broadcast to the host (`POST /pose/report`). What is read is the current value, so
   * continuous changes within the throttling window only leave the last frame.
   *
   * The coordinates are the same as POST /position: the normalization of the pet center is 0~1, and the reference is
   * the enclosing rectangle of the union of all screens (VIEW); otherwise, the value read back cannot be fed back to /
   * position.
   */
  reportPose() {
    if (!this.pos) return; // Not yet placed (before position() is called for the first time): do not report, so as not to push 0,0
    const body = {
      x: (this.pos.x + this.halfW) / VIEW.w,
      y: (this.pos.y + this.halfH) / VIEW.h,
      facing: this._facing,
    };
    void S.postAction(POSE_REPORT_URL + '?pet=' + encodeURIComponent(this.pet.id), body).then((ok) => {
      if (!ok) console.warn('[dsh-pet] Pose report not delivered pet=' + this.pet.id);
    });
  }

  sendBounds(px, py) {
    this.pos = { x: Math.round(px), y: Math.round(py) };
    // Window placement and reporting: When the system clamps the window back to the work area, the clamped amount is converted into the offset of the body within the window (see fitWindow)
    const fit = this.fitWindow();
    // There is an upper limit for offset: when the desired position exceeds the reachable range, the body can only
    // stop at the actual reachable position. Here, pos is brought back to reality, otherwise the difference between
    // "wanting" and "rendering" will become further and further away - when dragging back, you have to complete this
    // empty space first before the pet will move. It looks like it cannot be dragged back.
    this.pos = { x: Math.round(fit.x + fit.offsetX), y: Math.round(fit.y + fit.offsetY) };
    window.__dshPetDebug.dragPos = { x: this.pos.x, y: this.pos.y };
    this.reportWindow(fit);
    // The position has changed: the prompt follows the cursor, and the cursor stores the viewport coordinates. Once
    // the window is moved, it must be repositioned, otherwise the prompt will drift away with the window. Only reset
    // when displaying (this function is adjusted frame by frame when roaming, and unnecessary DOM writing is not done
    // when the prompt is not displayed).
    if (this.tipOn) this.renderTip();
    // Live standard dirty (reported by throttling, see markPoseDirty): All displacements are centralize in this function, so one place here is enough
    this.markPoseDirty();
  }

  // Corner/margin → body position; restore according to the intra-session position (proportion) after dragging. The
  // boundary is only responsible for the window placement of sendBounds, and the same rule as the web page: leave at
  // least 24 px in the hit area on the screen, and the rest can be hung out.
  position() {
    const W = VIEW.w;
    const H = VIEW.h;
    let x;
    let y;
    if (this.customPos) {
      x = this.customPos.rx * W - this.halfW;
      y = this.customPos.ry * H - this.halfH;
    } else {
      // The corners are taken from the main screen instead of the external rectangle: In an irregular multi-screen
      // layout, the corners of the external rectangle may not belong to any display, and pets equipped with this
      // corner will become invisible when powered on.
      const anchor = S.anchorPixel({
        corner: this.pet.position.corner,
        // marginX/marginY is the absolute pixel in the configuration: page-level scaling has been unified to enlarge the entire window, and the configuration value is no longer multiplied by scale
        marginX: this.pet.position.marginX,
        // macOS The top margin is aligned with the body hit box, and the top margin of the animation canvas is deducted.
        marginY:
          this.pet.position.marginY -
          (this.pet.position.corner.startsWith('top-') ? this.size * CONFIG.topInsetRatio : 0),
        size: this.size,
        W,
        H,
        area: PRIMARY_AREA || undefined,
      });
      x = anchor.x;
      y = anchor.y;
    }
    this.sendBounds(x, y);
  }

  /** Throwing space (AABB screen by screen). When AREAS/PANELS changes, it is reset by relayout() - recalculating every frame on the fly is too wasteful */
  throwSpaceOf() {
    if (!this.space || this.space.areas !== AREAS || this.space.panels !== PANELS) {
      this.space = S.throwSpace({ areas: AREAS, panels: PANELS, size: this.size, sideAllow: this.sideAllow });
      for (const b of this.space.bounds) b.minY -= this.size * CONFIG.topInsetRatio;
    }
    return this.space;
  }

  /**
   * Rehang in place after display geometry changes: Throwing space is invalid and the pet is pulled back to the
   * visible area from a position that may become a hole. It does not move while dragging (the user is holding it), nor
   * does it move while flying (the next frame of physics will clamp it according to the new boundary).
   *
   * The position of the corner mode is declarative: every time you press the new home screen workspace, configure the
   * corners and margins and recalculate it, the clamping result will never be written as the position - remote desktop
   * access will first give a temporary large screen and then narrow it down. After writing, "following the corner"
   * will become "locked on the right edge". Customized positions are recalculated according to the viewport proportion
   * to preserve world coordinates.
   */
  relayout(prevView) {
    this.space = null;
    if (this.dragState.active || this.throwRef !== null) return;
    this.stopMove();
    if (!this.pos) {
      // The position has not been set yet (before position() is called for the first time): there is no old position to conserve, so position directly according to the new geometry
      this.position();
      return;
    }
    if (this.customPos) {
      const from = prevView || VIEW;
      const centerOld = { x: this.pos.x + this.halfW, y: this.pos.y + this.halfH };
      const center = S.rebaseCenter(centerOld, from, VIEW, AREAS);
      this.customPos = { rx: center.x / VIEW.w, ry: center.y / VIEW.h };
    }
    this.position();
  }

  currentCenterX() {
    if (this.customPos) return this.customPos.rx * VIEW.w;
    return this.pos.x + this.halfW;
  }
  currentCenterY() {
    if (this.customPos) return this.customPos.ry * VIEW.h;
    return this.pos.y + this.halfH;
  }

  /**
   * Playback receipt reporting: Tell the host the true status of this playback request.
   *
   * Only third-party playback requests (with playbackId) are reported, and self-played animations are not reported -
   * the host only knows "accepted", the animation is played here, and only here knows whether it has finished playing.
   * postAction never throws an exception. Add a layer of then here just to keep troubleshooting logs.
   */
  reportPlayback(playbackId, status, reason) {
    if (!playbackId) return;
    const body = reason ? { status, reason } : { status };
    void S.postAction(BASE + '/playback/' + encodeURIComponent(playbackId) + '/report', body).then((ok) => {
      if (!ok)
        console.warn(
          '[dsh-pet] Playback report not delivered pet=' + this.pet.id + ' id=' + playbackId + ' status=' + status,
        );
    });
  }

  // Visible clamping rectangle: Taking the screen where the pet is as the boundary, the local coordinates of the window are returned; if the visible area is too small, null is returned
  visibleClampRect() {
    // Both sides of the comparison use screen coordinates, and the returned clamping rectangle is the local
    // coordinates of the window. Use the screen where the pet is located instead of the surrounding rectangle: the
    // latter contains a hole, and pressing it to clip the menu will extend into an area that does not belong to any
    // display.
    const area = S.resolveRect(WORK_AREAS, this.pos.x + this.halfW, this.pos.y + this.halfH);
    if (!area) return null;
    const winX = this.pos.x + VIEW.x - this.winOffset.x;
    const winY = this.pos.y + VIEW.y - this.winOffset.y;
    const winW = this.size + this.margin.l + this.margin.r;
    const winH = this.winH + this.margin.t + this.margin.b;
    const ax = area.x + VIEW.x;
    const ay = area.y + VIEW.y;
    const vx0 = Math.max(ax, winX);
    const vy0 = Math.max(ay, winY);
    const vx1 = Math.min(ax + area.width, winX + winW);
    const vy1 = Math.min(ay + area.height, winY + winH);
    const w = vx1 - vx0;
    const h = vy1 - vy0;
    if (w < 40 || h < 40) return null;
    return { x: vx0 - winX, y: vy0 - winY, w, h };
  }
}
