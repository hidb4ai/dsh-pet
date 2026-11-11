/**
 * Initialization during construction: DOM skeleton, event binding, initial values of each panel and driver,
 * cross-window collision subscribe.
 *
 * Called only once by constructor; runtime behavior is in sprite-playback / sprite-motion / sprite-input. PetSprite is
 * defined by sprite.js. This file only adds methods to the prototype and must be loaded afterwards.
 * @module dsh-pet/runtime/electron-helper/sprite-init
 */
'use strict';

Object.assign(PetSprite.prototype, {
  initPlayback(pet) {
    // The animation pool and weight are injected from the flattening layer by entry (S.flattenConfigPets of renderer).
    // If the entry is missing animations, it means the configuration is incomplete: clearly report the error to the
    // red bar of boot and 5 s to try again, and never fallback to an undefined global (that will only become a
    // sentence ReferenceError).
    if (!pet.animations) throw new Error('Pet has no animations configuration:' + String(pet.id ?? ''));
    this.animations = pet.animations;
    this.weights = pet.animationWeights;
    this.front = 0; // 0 = A, 1 = B
    this.pending = null;
    this.gen = 0;
    this.anim = this.animations.idle[0] ?? '';
    this.once = true;
    // Playback receipt: The third-party playback request number currently being played (null = self-played animation,
    // not reported). There is a single field because the animation name cannot be determined as "should this section
    // be reported?" - the menu playback request and the third party / anim can play the animation with the same name.
    this.playback = null;
    // Heading towards accessor: Assignment means marking the live dirty. Write `_facing` directly during the initialization phase to avoid triggering reporting before other fields are ready.
    this._facing = 'left';
    this.poseTimer = null; // throttling timer for live reporting (see markPoseDirty)
  },

  /** Frame handle and status of dragging/throwing/moving/squeezing; stop There was only one copy of these before. */
  initMotion() {
    // Interaction/Movement
    this.dragState = { active: false, dragging: false, sx: 0, sy: 0, petX: 0, petY: 0 };
    this.justDragged = false;
    // The time of the last press (0 = not yet recorded): The slingshot is judged based on the time between two presses, regardless of the release time.
    this.lastPressAt = 0;
    this._interactive = null; // Reported interactive status (for setInteractive deduplicate)
    this._inputBusy = null; // Reported "input in use" status (used by syncInputBusy deduplicate) Drag and throw physics (pure calculation in
    // shared): The spring follows the upper left corner of the bounding box, let go and estimate the speed according to
    // the pointer trajectory → Throw
    this.dragTrail = []; // Pointer trajectory sampling (screenX/Y + performance.now(), used for muzzle velocity estimation)
    this.dragTarget = null;
    this.dragVel = { vx: 0, vy: 0 };
    this.dragFollow = null; // Spring following rAF handle
    this.dragFollowToken = 0;
    this.throwRef = null; // Throw rAF handle
    this.throwToken = 0;
    // Position command following rAF (shared by spring and line): Separate from dragging and following the hand - this line has an end point, and must be closed when it converges or reaches the point.
    this.posFollow = null;
    this.posFollowToken = 0;
    this.space = null; // Throwing space (screen-by-screen AABB) cache; when the display changes, relayout() is left blank and rebuilt. Q
    // bomb squeeze (click response/throw landing): rAF + waiting mark (wait for the new animation to become the foreground
    // before pressing, and press the new first frame)
    this.squashRef = null;
    this.squashToken = 0;
    this.pendingSquash = false;
    this._interactive = null; // Current interactive status (null = undecided; only send IPC when changing to avoid refreshing the screen frame by frame)
    this.moveRef = null;
    this.moveToken = 0;
    this.pendingMove = null;
    this.customPos = null; // Position within the session after dragging ({ rx , ry } ratio); restart returns to the corner
  },

  /** Menu, bubble, prompt, balance, whisper, working status, occupation lock and dialogue pop-up window switching status. */
  initPanels() {
    // Third-party menu item (/ sections.menu snapshot of state): only enters the menu at the moment of right-clicking, and does not participate in rendering.
    this.menuItems = [];
    // Right-click menu (unified self-drawn components, both ends share the same one: tree + rendering are both from shared-core)
    this.menuOpen = false; // Force the entire window to be interactive when the menu is open (hovering the menu does not trigger click-through flip)
    this.menuClose = null; // close() of the current menu (mounted when opened, empty after closed) balance bubble
    this.bubbleOn = false;
    this.bubbleTimer = null;
    // Floating prompt (replacing native title): visible + latest cursor position (viewport coordinates, see renderTip)
    this.tipOn = false;
    this.tipCursor = null;
    this.balanceView = null;
    this.balanceWrap = false; // true = The current balance bubble is unavailable "text description" (multiple lines, line wrapping variant required)
    this.balanceState = null; // The latest balance reading (details and usage of the current calculation window in the expanded state; balanceView is only the row in the collapsed state)
    this.balanceViewIndex = 0; // Current page: Click to cut the next page (windows is the collapse / window details / usage, the third page is only available when the amount is used; custom is the views.length page)
    this.balanceFadeTimer = null; // Expand/collapse fade-out wait (change content after 250 ms to avoid hard cutting)
    this.prevTick = 0;
    // Speaking (whisper/command bubble/conversation reply): Text and images are polled by the container / state and then sent in via showWhisper.
    this.whisperOn = false;
    this.whisperTimer = null;
    this.whisperView = null;
    this.whisperText = '';
    // Collapse plan: suspend the timing during synthesis, and leave the tail after playing (the state machine is at shared/bubble-hold, the same as the browser)
    this.whisperHold = S.BUBBLE_HOLD_IDLE;
    // Picture name (configure the key of memes; when whisperImageEnabled is turned on, it is randomly selected by host and comes with the text)
    this.whisperImage = '';
    // Picture address (choose one from whisperImage): The two forms are distinguished by field names and do not rely on sniffing.
    this.whisperUrl = '';
    // Working status linkage: The polling of the container increases every second by workTick → This pet plays
    // animation and bubble according to the state, and is completely immune when not enabled. Bubble single slot
    // priority: final tasks > whisper > balance > non-final tasks (see renderBubble).
    this.workOn = false;
    this.workTimer = null;
    this.workText = null;
    this.workState = null; // The latest working status (used to restore the state cycle after the interaction/event animation is played)
    this.workSessionId = null; // The session to which the currently displayed item belongs: Only when there is a value, the working bubble can be clicked (click to skip)
    this.bubbleSlot = 'none'; // Currently displayed bubble slot (written by renderBubble): Click processing to distinguish page turning and session jumping.
    this.prevWorkState = null; // Previous state (the bubble only lights up/closes when the state changes)
    this.prevWorkTick = 0;
    // Occupied lock: frozen = is currently occupied by a third party; lockTimer press expiresAt in the leaf to release
    // it yourself (expiration on the host side is lazy and will not push "lock lost").
    this.frozen = false;
    this.lockTimer = null;
    // Sleeping: sleeping = In the sleeping state at this moment (including the transition of "getting up"), sleepSet =
    // The three-segment name selected by the host,
    // sleepPhase = current segment ( start / loop / end ). The stage is advanced by handleEnded - only the renderer
    // knows when the video is finished.
    this.sleeping = false;
    this.sleepSet = null;
    this.sleepPhase = null;
    // Dialog pop-up window: currently mounted handle (close / startHear / stopHear) + open mark. chatOpen is a
    // click-through guard - the pop-up window is DOM in the window, during which the entire window remains
    // interactive, otherwise the cursor will be turned back to click-through by onMouseMove when it moves to the input
    // box, and all clicks will be transparently transmitted.
    this.chatMount = null;
    this.chatOpen = false;
    // Shortcut key "Press and hold M to speak": press to start recording, release to cleanup. The state machine is in
    // shared (both auto-repeat and out-of-focus are blocked). This example is only responsible for sending the two
    // keyboard events as they are, and the action falls on startHearChat / stopHearChat of menu. There are two gates:
    // the mouse is on the pet, or the cursor is still in the pet's own pop-up window - as soon as the pop-up window
    // opens, the focus is on the input box, which is exactly the time when you most want to hold down and speak (it is
    // determined that the focus is not visible, and chat/dom clears the input box blur when starting recording).
    this.hearHold = S.createHearHold({
      isArmed: () =>
        Boolean(this.hoverBody) || Boolean(this.chatMount && this.chatMount.el.contains(document.activeElement)),
      onPress: () => this.startHearChat(),
      onRelease: () => this.stopHearChat(),
    });
    // To-do panel: The same set of click-through guards as the dialog pop-up window (the panel is also DOM in the
    // window, and is larger than the dialog window). todoPanel is the panel handle (occupies the bubble slot, and the
    // node is stuffed in this.bubble), and todoOpen is the click-through guard mark.
    this.todoPanel = null;
    this.todoOpen = false;
  },

  /** Create DOM and drop the first frame position into the window; all layout values come from geometry calculated above. */
  buildDom() {
    // DOM: sprite is placed in the window (winOffset.x, winOffset.y); pet "position" = sprite position, the window
    // expands with the margin. The initial value is equal to the margin. After the window is clamped back to the work
    // area by the system, it is changed from fitWindow to a larger offset frame by frame.
    this.el = document.createElement('div');
    this.el.className = 'pet-sprite';
    this.el.style.left = this.winOffset.x + 'px';
    this.el.style.top = this.winOffset.y + 'px';
    this.el.style.setProperty('--pet-size', this.size + 'px');
    // Font size (configuration font): Calculate the final px injection according to the size of this pet, and read these two variables of bubble and prompt CSS
    const fontPx = S.resolveFontPx(this.font, this.size);
    this.el.style.setProperty('--dsh-pet-font-bubble', fontPx.bubble + 'px');
    this.el.style.setProperty('--dsh-pet-font-tip', fontPx.tip + 'px');
    const stage = document.createElement('div');
    stage.className = 'pet-stage';
    // Constant displacement: Do not cancel during dragging, otherwise the video will jump up relative to the cursor and the grab point will be offset by bottomPad.
    stage.style.transform = 'translateY(' + this.bottomPad + 'px)';
    this.videoA = document.createElement('video');
    this.videoA.className = 'pet-video is-front';
    this.videoB = document.createElement('video');
    this.videoB.className = 'pet-video';
    for (const v of [this.videoA, this.videoB]) {
      v.muted = true;
      v.playsInline = true;
      v.autoplay = true;
    }
    this.hit = document.createElement('div');
    this.hit.className = 'pet-hit';
    this.hit.style.left = (S.HIT_BOX.x0 / 640) * 100 + '%';
    this.hit.style.top = (S.HIT_BOX.y0 / 360) * 100 + '%';
    this.hit.style.width = ((S.HIT_BOX.x1 - S.HIT_BOX.x0) / 640) * 100 + '%';
    this.hit.style.height = ((S.HIT_BOX.y1 - S.HIT_BOX.y0) / 360) * 100 + '%';
    // The hit layer hangs aria-label: The original title has been replaced by a self-drawn floating layer, but the accessibility name cannot be lost along with it.
    this.hit.setAttribute('aria-label', this.pet.name);
    this.bubble = document.createElement('div');
    this.bubble.className = 'pet-bubble';
    // Clicking on the bubble will be split according to the current slot: the working bubble will jump to the session, and the balance bubble will switch to the page. Swallow the events on the spot, don't fall to the body hit layer below.
    this.bubble.addEventListener('click', (e) => {
      if (this.workClickable()) {
        e.stopPropagation();
        e.preventDefault();
        this.openWorkSession();
        return;
      }
      if (!this.balanceClickable()) return;
      e.stopPropagation();
      e.preventDefault();
      this.toggleBalanceDetail();
    });
    // Floating prompt: The absolute positioning floating layer in this.el, the position and flanging are determined by renderTip, and the style is shared's TOOLTIP_CSS.
    this.tip = document.createElement('div');
    this.tip.className = S.TOOLTIP_CLASS;
    this.tip.setAttribute('aria-hidden', 'true');

    stage.appendChild(this.videoA);
    stage.appendChild(this.videoB);
    stage.appendChild(this.hit);
    this.el.appendChild(this.bubble);
    this.el.appendChild(this.tip);
    this.el.appendChild(stage);
    rootEl.appendChild(this.el);
    this.position();
  },

  /** Binding pointers, windows and collision broadcasts; one-time AbortController is canceled uniformly in dispose. */
  bindEvents() {
    // Event (same set as browser: pointerdown/move, click, window pointerup/cancel)
    const ac = new AbortController();
    this.ac = ac;
    // New panels in the cascading menu and chat input growth may occur when the mouse is stopped. You cannot just wait for the next mousemove.
    this.inputRegionResize = new ResizeObserver(() => this.syncInputRegions());
    this.inputRegionElements = new Set();
    this.inputRegionMutation = new MutationObserver(() => this.syncInputRegions());
    this.inputRegionMutation.observe(document.body, { childList: true, subtree: true });
    this.hit.addEventListener('pointerdown', (e) => this.onPointerDown(e), { signal: ac.signal });
    this.hit.addEventListener('pointermove', (e) => this.onPointerMove(e), { signal: ac.signal });
    this.hit.addEventListener('click', (e) => this.onClick(e), { signal: ac.signal });
    this.hit.addEventListener('contextmenu', (e) => this.onContextMenu(e), { signal: ac.signal });
    window.addEventListener('pointerup', (e) => this.onPointerUp(e), { signal: ac.signal });
    window.addEventListener('pointercancel', (e) => this.onPointerUp(e), { signal: ac.signal });
    this.hit.addEventListener('lostpointercapture', (e) => this.onPointerUp(e), { signal: ac.signal });
    // Drag a picture to your pet: open a conversation directly and hang it as a picture to be sent (same set of criteria on the browser side)
    this.hit.addEventListener('dragover', (e) => this.onDragOverImage(e), { signal: ac.signal });
    this.hit.addEventListener('drop', (e) => this.onDropImage(e), { signal: ac.signal });
    // Keys when hovering: L to open a conversation, press and hold M to speak, D to switch to-do, S to take
    // screenshots, Z to switch sleep/wake. No buttons are received when the window is not focused (the transparent
    // window is displayed with showInactive, which does not grab the focus)
    window.addEventListener('keydown', (e) => this.onHotkey(e), { signal: ac.signal });
    // Paste on hover: If there is an image in the clipboard, open the conversation directly (or insert it into an already open conversation)
    window.addEventListener('paste', (e) => this.onPasteImage(e), { signal: ac.signal });
    // Press and hold to speak by keyup cleanup: This must be valid while pressing and holding, and it is the same lifecycle as keydown
    window.addEventListener('keyup', (e) => this.onHotkeyUp(e), { signal: ac.signal });
    // When the text input gets the focus, the system keyboard focus is replenished: X11/KWin will not give the
    // keyboard focus to the window just because DOM is focused. If not, the cursor will flash and the keys will fall
    // to the previous window. The criterion is isTypingTarget of reuse shared. The dialog pop-up window and to-do
    // panel are both DOM in the window, and one commission is fully covered.
    document.addEventListener(
      'focusin',
      (e) => {
        if (S.isTypingTarget(e.target) && window.petBridge && window.petBridge.requestKeyboardFocus) {
          window.petBridge.requestKeyboardFocus();
        }
      },
      { signal: ac.signal },
    );
    // Click-through: The window defaults to full-window click-through. When the cursor enters and exits the body hit
    // area, it can be flipped and interacted; during click-through, mousemove is forwarded by the main process
    // (forward:true), and mouseleave ensures that click-through is restored immediately after the cursor leaves the
    // window.
    window.addEventListener('mousemove', (e) => this.onMouseMove(e), { signal: ac.signal });
    window.addEventListener(
      'blur',
      () => {
        // The old menu should not continue to occupy the transparent window after switching to other applications; the drag should also be released when lost.
        this.closeMenu();
        // Unable to receive keyup when I let go when switching away: If you don’t cleanup here, the recording will continue to the upper limit of 24 seconds.
        this.hearHold.release();
        if (this.dragState.active) this.onPointerUp();
        if (!this.chatOpen && !this.todoOpen) this.setInteractive(false);
      },
      { signal: ac.signal },
    );
    window.addEventListener(
      'mouseleave',
      () => {
        // The cursor leaves the window: If the menu is open, it will be closed immediately (DOM in the window, it will
        // be inaccessible if you leave it), and then click-through will be restored. It will not be restored during
        // dragging or when the dialog pop-up window is open: the former will bypass busy and lose pointerup, while the
        // latter requires leaving the cursor to return to the input box.
        this.closeMenu();
        if (!this.chatOpen && !this.todoOpen && !this.dragState.active) this.setInteractive(false);
      },
      { signal: ac.signal },
    );

    this.subscribeCollision();
  },

  /**
   * Collision between pets (cross-window broker): subscribe to other pet status broadcast + "collision" event →
   * onDeskHit. Unsubscription is naturally recycled by window destruction (the ipc event will no longer be dispatched
   * after webContents is destroyed), without explicit cancellation.
   */
  subscribeCollision() {
    this.others = {}; // petId -> { x , y , vx , vy , size , bottomPad } (the latest status of other pets, broadcast from main process)
    this.throwState = null; // Real-time status in flight (for collision query/reporting during other window collision detection)
    this.pressScoreFired = false; // Points have been triggered at the moment of pressing (pointerdown is triggered; click will not be played repeatedly accordingly, the same as the browser)
    if (window.petBridge && window.petBridge.onFlightStates) {
      window.petBridge.onFlightStates((states) => {
        if (!states || typeof states !== 'object') return;
        const next = {};
        for (const pid of Object.keys(states)) {
          if (pid === this.pet.id) continue; // Exclude yourself
          const s = states[pid];
          next[pid] = {
            // Collision broker protocol unit is physical pixel: ÷ scale Enter this window CSS system
            x: toLocal(Number(s && s.x) || 0),
            y: toLocal(Number(s && s.y) || 0),
            vx: toLocal(Number(s && s.vx) || 0),
            vy: toLocal(Number(s && s.vy) || 0),
            size: toLocal(Number(s && s.size) || 0),
            bottomPad: toLocal(Number(s && s.bottomPad) || 0),
          };
        }
        this.others = next;
      });
      window.petBridge.onPetHit((payload) => {
        const vx = Number(payload && payload.vx);
        const vy = Number(payload && payload.vy);
        if (Number.isFinite(vx) && Number.isFinite(vy)) this.onDeskHit(toLocal(vx), toLocal(vy));
      });
    }
  },
});
