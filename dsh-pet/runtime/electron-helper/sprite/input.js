/**
 * Pointer and hit: press/move/lift, click, interactive area synchronization and input lease reporting.
 *
 * PetSprite is defined by sprite.js. This file only adds methods to the prototype and must be loaded afterwards. The
 * side effect is the DOM event and IPC (setInteractive / syncInputBusy), which do not touch the playback and motion
 * state machines.
 * @module dsh-pet/runtime/electron-helper/sprite-input
 */
'use strict';

Object.assign(PetSprite.prototype, {
  onPointerDown(e) {
    // Start dragging only with the left button; right-button dragging conflicts with the context menu.
    if (e.button !== 0) return;
    // Occupation lock: The user clicks or drags this pet = the user takes over and the third-party occupation is
    // immediately removed. This is the only lock report of "renderer → host" - the host cannot see the mouse, but the
    // lock is in its hands (force form of / lock/release). Defrost locally first and then report: Waiting for the
    // leaves to go back and forth will make the pet "click for a long time before moving", and the fact that frozen is
    // true at this moment means that this release must be successful.
    if (this.frozen) {
      if (this.lockTimer !== null) {
        window.clearTimeout(this.lockTimer);
        this.lockTimer = null;
      }
      this.applyFreeze(false);
      S.postAction(BASE + '/lock/release?pet=' + encodeURIComponent(this.pet.id), { force: true }).then((ok) => {
        if (!ok) console.warn('[dsh-pet] User takeover report not delivered pet=' + this.pet.id);
      });
    }
    // Fetch speed log: Read before stopThrow, otherwise the flight speed will be lost; record 0 when stationary
    const grabState = this.throwState;
    console.log(
      '[dsh-pet] ' +
        new Date().toTimeString().slice(0, 8) +
        ' pet=' +
        this.pet.id +
        ' grab vx=' +
        (grabState ? Math.round(grabState.vx) : 0) +
        ' vy=' +
        (grabState ? Math.round(grabState.vy) : 0) +
        ' |v|=' +
        (grabState ? Math.round(Math.hypot(grabState.vx, grabState.vy)) : 0),
    );
    // Click points: Triggered as soon as pressed (without waiting for release). Read the previous flight speed of
    // stopThrow, and a pop-up window will explode when it reaches the standard; pressScoreFired marks that this press
    // has been triggered, and the released click will no longer play the normal click animation.
    this.pressScoreFired = false;
    // Modifier key + click is the shortcut key for "Call out DSH": points will not be played to avoid shortcut keys to easily increase points.
    if (grabState && !isOpenShortcut(e)) {
      const grabSpeed = Math.hypot(grabState.vx, grabState.vy);
      if (grabSpeed >= S.SCORE_MIN_SPEED) {
        this.pressScoreFired = true;
        console.log(
          '[dsh-pet] ' +
            new Date().toTimeString().slice(0, 8) +
            ' pet=' +
            this.pet.id +
            ' click-score speed=' +
            Math.round(grabSpeed) +
            ' size=' +
            this.size +
            ' -> +' +
            S.clickScore(grabSpeed, this.size),
        );
        S.spawnScoreBurst(e.clientX, e.clientY);
        S.mountScorePopup({
          x: e.clientX,
          y: e.clientY,
          score: S.clickScore(grabSpeed, this.size),
          speed: grabSpeed,
          size: this.pet.size,
        });
      }
    }
    this.stopThrow(); // Air grab: start a new drag from the current landing point (this.pos real-time)
    this.stopDragFollow();
    this.stopMove();
    this.dragTrail = [];
    // Slingshot: Record the time when pressed, compare when pressed - interval = the distance between two presses, it
    // has nothing to do with how long the drag has been, and there is no "waiting for pull" state or timeout cleanup.
    const pressNow = performance.now();
    const sling = pressNow - this.lastPressAt < S.SLINGSHOT_DOUBLE_MS;
    this.lastPressAt = sling ? 0 : pressNow; // Clear it as soon as it hits, so you don’t have to click three times to bounce it twice.
    this.hit.classList.add('dragging');
    // Close the floating prompt: the pointer is always within the body during dragging. If you do not actively close the prompt, it will float with the pet (reset by onPointerUp after letting go)
    this.setTip(false);
    this.stopMove();
    try {
      this.hit.setPointerCapture(e.pointerId);
    } catch {
      /* Ignore capture failure */
    }
    // Record the pointer screen coordinates and pet window position when pressed: all increments are calculated using
    // screenX/Y - the screen coordinates have nothing to do with the window position and are not affected by the
    // frame-by-frame movement of the window (window.screenX will lag/cached); physical pixels ÷ scale enter the CSS
    // system.
    this.dragState = {
      active: true,
      dragging: false,
      sx: toLocal(e.screenX),
      sy: toLocal(e.screenY),
      petX: this.pos.x,
      petY: this.pos.y,
    };
    // Drag signal: The main process fallback channel is determined by the cursor and the window rectangle, and the
    // window is one circle larger than the body; the pet lags behind the cursor during dragging, and the cursor may go
    // out of the window → click-through → cannot receive pointermove/pointerup. Report "I am using input" here.
    this.syncInputBusy();
    // Slingshot: Add whether the bow is drawn this time and the center of the pet when it is pressed into the same
    // drag state. It is placed after the report in order not to dilute the source code guard (it requires that busy
    // must be reported immediately after the status is established).
    this.dragState.sling = sling;
    this.dragState.anchorX = this.pos.x + this.halfW;
    this.dragState.anchorY = this.pos.y + this.halfH;
  },

  onPointerMove(e) {
    const d = this.dragState;
    if (!d.active) return;
    // Screen coordinate increment is used for threshold determination (clientX will change with the movement of the window, and the screen coordinates are stable); ÷ scale enters the CSS system
    const dx = toLocal(e.screenX) - d.sx;
    const dy = toLocal(e.screenY) - d.sy;
    if (!d.dragging) {
      if (Math.hypot(dx, dy) < S.DRAG_THRESHOLD) return;
      d.dragging = true;
      // Sleeping: The position follows the hand as usual, but the drag animation is not changed - the entire sleeping position cycle returns to the sleep state machine, and it cannot be returned after being pushed out.
      if (this.animations.drag.length && !this.sleeping) {
        this.playOnce(S.pick(this.animations.drag));
      }
      this.syncInputBusy(); // Drag and drop is established: main process fallback channel shuts up (see inputBusy)
    }
    // Record pointer trajectory (screenX/Y sampling, consistent speed; used for initial velocity estimation; ÷ scale into CSS system)
    const now = performance.now();
    this.dragTrail.push({ t: now, x: toLocal(e.screenX), y: toLocal(e.screenY) });
    this.dragTrail = S.trimTrail(this.dragTrail, now);
    // Spring target = pet position when pressed + pointer screen increment (coordinates will not be affected no matter how the window moves), chased frame by frame by rAF
    this.dragTarget = { x: d.petX + dx, y: d.petY + dy };
    this.startDragFollow();
  },

  onPointerUp(e) {
    const d = this.dragState;
    const wasDragging = d.dragging;
    d.active = false;
    d.dragging = false;
    this.hit.classList.remove('dragging');
    this.stopDragFollow(); // The spring follows and stops immediately (the position is fixed at this.pos in real time)
    this.syncInputBusy(); // End of dragging: Return to normal judgment (idempotent, adjust once more than once without sending IPC when not
    // dragging) Prompt reset: retract during click/drag, and restore when the pointer is still in the hit area. Use
    // hitRect instead of getBoundingClientRect - the hit zone is the authoritative geometry in window coordinates and has
    // the same origin as onMouseMove. It must be left after syncInputBusy(): The source code guard only scans the 400
    // characters at the beginning of this function to find the report call. Inserting it in front will squeeze the report
    // out of the window.
    if (e && Number.isFinite(e.clientX)) {
      const r = this.hitRect;
      const px = e.clientX - this.winOffset.x;
      const py = e.clientY - this.winOffset.y;
      // Press the release position to update the cursor before positioning/displaying it, otherwise the position before dragging will be reproduced (same processing as browser placeTip)
      this.tipCursor = {
        x: this.pos.x - this.winOffset.x + e.clientX,
        y: this.pos.y - this.winOffset.y + e.clientY,
      };
      this.setTip(px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h);
    }
    if (wasDragging) {
      this.justDragged = true;
      setTimeout(() => {
        this.justDragged = false;
      }, 100);
      if (e && Number.isFinite(e.screenX)) {
        // Original input traces (for actual machine troubleshooting: verify whether the pointer screen coordinates are consistent with the window displacement, such as DPI scaling problem)
        window.__dshPetDebug.lastDragRaw = {
          petX: d.petX,
          petY: d.petY,
          sxDown: d.sx,
          syDown: d.sy,
          xUp: e.screenX,
          yUp: e.screenY,
        };
      }
      // Drag and release: the non-final working state resumes the state cycle, otherwise it returns to idle. playOnce
      // must be used: switchTo ( idle , false ) will play loop, ended will never trigger, and the random chain will
      // never return. Sleeping: No animations or sleeping postures have been changed during dragging. Do not connect
      // idle here, otherwise the sleeping posture will be removed.
      if (!this.sleeping && !this.resumeWorkStatusAnim()) {
        if (this.animations.idle.length) this.playOnce(S.pick(this.animations.idle, this.anim));
      }
      // Release position = the upper left corner of the actual bounding box after the spring follows (not the pointer target: the landing point should follow the actual position of the pet when lagging)
      const px = this.pos.x;
      const py = this.pos.y;
      if (d.sling) {
        // Slingshot: Strength = pulling distance (regardless of hand speed), direction = the opposite direction of
        // pulling; the pulling vector is calculated using the actual center of the pet (the spring has hysteresis, and
        // the user sees how far the pet is pulled). Then the same startThrow is thrown away.
        const pullX = px + this.halfW - d.anchorX;
        const pullY = py + this.halfH - d.anchorY;
        const dist = Math.hypot(pullX, pullY);
        const rawPower = S.slingshotPower(dist, this.size);
        const v = S.slingshotVelocity(S.pullAngle(pullX, pullY), rawPower, this.physics.throwPower);
        this.dragTrail = [];
        console.log(
          '[dsh-pet] ' +
            new Date().toTimeString().slice(0, 8) +
            ' pet=' +
            this.pet.id +
            ' sling dist=' +
            Math.round(dist) +
            ' power=' +
            rawPower.toFixed(2) +
            ' vx=' +
            Math.round(v.vx) +
            ' vy=' +
            Math.round(v.vy),
        );
        this.startThrow(px, py, v.vx, v.vy);
      } else {
        // Estimation of muzzle velocity: throw it if it is fast enough, otherwise put it down on the spot
        const vel = S.estimateReleaseVelocity(this.dragTrail, performance.now(), this.physics);
        this.dragTrail = [];
        if (vel) {
          console.log(
            '[dsh-pet] ' +
              new Date().toTimeString().slice(0, 8) +
              ' pet=' +
              this.pet.id +
              ' release vx=' +
              Math.round(vel.vx) +
              ' vy=' +
              Math.round(vel.vy) +
              ' |v|=' +
              Math.round(Math.hypot(vel.vx, vel.vy)),
          );
          this.startThrow(px, py, vel.vx, vel.vy);
        } else {
          // customPos semantics = the proportion of the pet center (position() uses rx * W - halfW to restore the upper left corner), let go and capture without borders
          this.customPos = { rx: (px + this.halfW) / VIEW.w, ry: (py + this.halfH) / VIEW.h };
          this.position();
          // Final window position after release: smoke assertion "release without displacement" is used
          window.__dshPetDebug.lastDragRelease = { x: this.pos.x, y: this.pos.y };
        }
      }
    }
  },

  /**
   * Does this window have to remain interactive (= I am using mouse input in this window).
   *
   * The source is dragging / right-click menu is open / dialogue or to-do pop-up window is open (plus clickable
   * balance bubble): they are all driven by window-level mouse events, and the input chain is broken as soon as the
   * window changes back to click-through (no one reports pointerup when dragging freezes or letting go). This is the
   * proprietary knowledge of the renderer and cannot be inferred by the main process; at the same time, the control
   * rectangle is reported, and click-through continues outside the menu/chat box.
   */
  inputBusy() {
    // Clickable bubbles (balance page flipping, work bubble jumping session) are also from the same source: they grow
    // in the window and are triggered by window-level click, but they hang in the margin area of normal click-through.
    // It is necessary to borrow busy + control rectangle to encircle them.
    return (
      this.dragState.active ||
      this.menuOpen ||
      this.chatOpen ||
      this.todoOpen ||
      this.balanceClickable() ||
      this.workClickable()
    );
  },

  /** There are currently several pages in the balance bubble: the rules belong to the shared layer (same origin as the content of each page), and only the fallback of "no result yet" is added here. */
  balancePageCount() {
    const s = this.balanceState;
    return s ? S.balancePageCount(s) : 1;
  },

  /** The balance bubble supports paging only while visible and containing more than one page. */
  balanceClickable() {
    if (!this.bubbleOn || this.balanceWrap) return false;
    return this.balancePageCount() > 1;
  },

  /** Is the work bubble clickable at the moment: it is occupying the bubble slot and has a jumpable session. */
  workClickable() {
    return this.bubbleSlot === 'work' && !!this.workSessionId;
  },

  /**
   * Report once "Should we keep it interactive?" All state change points go here (idempotent, IPC will not be sent if
   * the value does not change). Division of labor with setInteractive: The latter expresses whether the cursor is on
   * the body, while this method expresses whether I am using input (higher priority).
   */
  syncInputBusy() {
    this.syncInputRegions();
    const busy = this.inputBusy();
    if (busy === this._inputBusy) return;
    this._inputBusy = busy;
    window.__dshPetDebug.inputBusy = busy;
    if (window.petBridge) window.petBridge.setInputBusy(busy);
  },

  syncInputRegions() {
    if (!window.petBridge || !window.petBridge.setInputRegions) return;
    const rects = [];
    // Control rectangle = main process allows the area to receive clicks, and click-through continues outside the rectangle. The clickable balance bubble hangs in the balance area and cannot be clicked without registration.
    const controls = [
      ...document.querySelectorAll('.dsh-pet-menu-column, .dsh-pet-chat, .dsh-pet-todo, .pet-bubble.is-clickable'),
    ];
    for (const el of this.inputRegionElements) {
      if (!controls.includes(el)) {
        this.inputRegionResize.unobserve(el);
        this.inputRegionElements.delete(el);
      }
    }
    for (const el of controls) {
      if (!this.inputRegionElements.has(el)) {
        this.inputRegionElements.add(el);
        this.inputRegionResize.observe(el);
      }
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        rects.push({ x: toScreen(r.x), y: toScreen(r.y), width: toScreen(r.width), height: toScreen(r.height) });
      }
    }
    const input = { dragging: this.dragState.active, rects };
    const key = JSON.stringify(input);
    if (key === this._inputRegions) return;
    this._inputRegions = key;
    window.petBridge.setInputRegions(input);
  },

  setInteractive(flag) {
    const next = !!flag;
    if (next === this._interactive) return; // Only send IPC when the status changes to avoid refreshing the screen frame by frame.
    this._interactive = next;
    window.__dshPetDebug.interactive = next;
    if (window.petBridge) window.petBridge.setInteractive(next);
  },

  /**
   * The floating prompt is shown and hidden.
   *
   * It is driven by onMouseMove's "whether the cursor is in the body hit zone" instead of pointerenter/leave:
   * click-through of the entire window outside the body. When the cursor leaves the body, pointerleave may not be
   * dispatched, and the prompt will stay on the screen; there is only one convention for geometric determination and
   * click-through flipping to have the same origin.
   */
  onMouseMove(e) {
    // All keys have been released in the dragging state: it means that pointerup/pointercancel/lostpointercapture is
    // all lost, press and release the cleanup command on the spot, otherwise dragState.active and inputBusy will
    // always be true (click-through will never be restored).
    if (this.dragState.active && e.buttons === 0) {
      this.onPointerUp(e);
      return;
    }
    // The window follows the cursor frame by frame during dragging, and the pointer jitters relative to the window at the frame level - it is forced to remain interactive and never flipped (flipping will interrupt dragging)
    if (this.dragState.active) {
      this.setInteractive(true);
      return;
    }
    // When the right-click menu/dialog pop-up window/to-do panel is opened: the entire window remains interactive, and the hit zone determination is restored after closing.
    if (this.menuOpen || this.chatOpen || this.todoOpen) {
      this.syncInputRegions(); // The cascading menu increases or decreases panels by hovering, and updates the occupied area in time.
      this.setInteractive(true);
      this.setTip(false); // The prompts give way during the menu/pop-up window and do not compete with the floating layer for attention.
      return;
    }
    const r = this.hitRect;
    // forwarded event coordinates take the window as the origin; when converted to sprite coordinates, the offset of
    // the body within the window must be deducted. Return to the screen coordinate derivation in case of exception: ÷
    // scale and then subtract the origin of the window screen, which is the coordinate within the window (hitRect/pos
    // are all CSS systems).
    const wx = Number.isFinite(e.clientX) ? e.clientX : toLocal(e.screenX) - (this.pos.x + VIEW.x - this.winOffset.x);
    const wy = Number.isFinite(e.clientY) ? e.clientY : toLocal(e.screenY) - (this.pos.y + VIEW.y - this.winOffset.y);
    const px = wx - this.winOffset.x;
    const py = wy - this.winOffset.y;
    const inBody = px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
    // Shortcut keys and dragging only take effect when "the cursor is on the body", which has the same origin as prompt/click-through to avoid another set of judgments.
    this.hoverBody = inBody;
    // The cursor stores the viewport coordinates (window origin + coordinates within the window): the cursor will not
    // drift when the window moves with the pet. It must be updated before setTip - setTip will be rendered immediately
    // when it becomes visible, and the last cursor position will be used one step later.
    if (inBody) this.tipCursor = { x: this.pos.x - this.winOffset.x + wx, y: this.pos.y - this.winOffset.y + wy };
    this.setInteractive(inBody);
    // The floating prompt and the interactive judgment have the same origin (the same inBody): appear when entering the body, and collapse when leaving.
    this.setTip(inBody);
    // Follow the cursor: The position depends on the cursor, and it must be reset every time it moves (setTip is only rendered when the visibility changes)
    if (this.tipOn) this.renderTip();
  },

  onClick(e) {
    const d = this.dragState;
    if (d.active || d.dragging || this.justDragged) return;
    // Ctrl (macOS is Cmd) + left button = call out DSH: The same action as the first item in the menu, just a shortcut
    // key - no click animation will be played, and no points will be involved to avoid "touching the pet" becoming
    // "opening the window".
    if (isOpenShortcut(e)) {
      this.stopThrow();
      this.stopMove();
      if (window.petBridge) window.petBridge.openDshSite(ORIGIN);
      return;
    }
    // Points judgment has been completed at onPointerDown (press to trigger): once triggered, just stop and no longer play the normal click animation.
    if (this.pressScoreFired) {
      this.pressScoreFired = false;
      this.stopThrow();
      this.stopMove();
      return;
    }
    this.stopThrow(); // Click on the pet in flight = stop (replay and click to respond)
    this.stopMove();
    // Sleep: Click to wake up. The squeeze and sound effects are as usual (the feel is the same as usual), but the
    // click response animation is not played - the wake-up performance is driven by the sleep leaf written back by /
    // wake (end is played once, and a random chain is returned after playing). Here we directly press the current
    // foreground frame: we usually rely on pendingSquash and other new animations to be in place, and there is no
    // source change in this way.
    if (this.sleeping) {
      playClickSound();
      const front = this.front === 0 ? this.videoA : this.videoB;
      if (front) this.startSquash(front);
      this.postSleepAction('wake');
      // Being clicked during the transition to falling asleep: This time falling asleep will be invalidated. Press the
      // normal click to play the response animation - the "getting up" part will no longer play. Clear the status
      // locally first: when the leaf comes back, setSleep will return directly because it "didn't sleep", and end will
      // not be inserted.
      if (this.sleepPhase === 'start') {
        this.sleeping = false;
        this.sleepSet = null;
        this.sleepPhase = null;
        if (this.animations.clicks.length) this.playOnce(S.pick(this.animations.clicks));
      }
      return;
    }
    // The click sound effect is in the same position as the browser: placed after the early exit of "Press Triggered Points" and before the click animation judgment
    playClickSound();
    if (!this.animations.clicks.length) return;
    this.pendingSquash = true; // Q after the new click animation switches to the foreground (press the new first frame, consistent with the browser)
    this.playOnce(S.pick(this.animations.clicks));
  },

  // Right-click menu (unified self-drawn component: both tree and rendering come from the same menu module of
  // shared-core) Menu/pop-up window visible rectangle (local coordinates of the window) = window ∩ workspace: When the
  // pet is attached to the edge, the expansion margin extends out of the screen, and the fixedly positioned menu in
  // the window will go into the part cut off by the screen. Constrain the menu to this rectangle to display it
  // completely, with zero movement of the window and pet; degradation (the visual area is too small/the entire window
  // goes off the screen) returns null, and the caller fallsback according to the window viewport.
});

Object.assign(PetSprite.prototype, {
  /**
   * Dragging through the hit area: only dragging with files is processed. Must be preventDefault, otherwise the window
   * will open this file as a navigation (the page will be replaced directly).
   */
  onDragOverImage(e) {
    if (!S.dragHasFiles(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  },

  /** Let go: The first picture will directly open a dialogue and be hung as a picture to be sent; if it is not a picture, it will be treated as if it did not happen. */
  onDropImage(e) {
    const file = S.firstImageFile(e.dataTransfer);
    if (!file) return;
    e.preventDefault();
    this.showChatFromMenu(file);
  },

  /** Hover shortcut keys: press and hold M to speak, L to open a conversation, S to take screenshots, Z to switch sleep/wake, D to switch to-do, 1-4 to switch display positions. */
  onHotkey(e) {
    // Press and hold to speak first: it will eat up the automatic repeat during the press and hold period, and it will be taken away by the input box if it is one step too late.
    if (this.hearHold.onKeyDown(e)) {
      e.preventDefault();
      return;
    }
    if (!this.hoverBody) return;
    const display = S.displayOfHotkey(e);
    if (display) {
      e.preventDefault();
      this.setPetDisplay(display);
      return;
    }
    if (S.isChatHotkey(e)) {
      e.preventDefault();
      this.showChatFromMenu();
      return;
    }
    if (S.isCaptureHotkey(e)) {
      e.preventDefault();
      this.screenshotFromShortcut();
      return;
    }
    if (S.isTodoHotkey(e)) {
      e.preventDefault();
      this.toggleTodo();
      return;
    }
    // Sleep: The same switching semantics as the browser; when this item is not equipped with a sleep animation, the entire item is invalid (it does not appear in the menu)
    if (S.isSleepHotkey(e) && Array.isArray(this.animations.sleep) && this.animations.sleep.length > 0) {
      e.preventDefault();
      this.postSleepAction(this.sleeping ? 'wake' : 'sleep');
    }
  },

  /** Release: End the recording of "Press and Talk" (do nothing while pressing and holding). */
  onHotkeyUp(e) {
    this.hearHold.onKeyUp(e);
  },
});
