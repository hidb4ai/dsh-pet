/**
 * Right-click menu: open/close, leaf action dispatch, and self-drawn node rendering used in the menu.
 *
 * PetSprite is defined by sprite.js. This file only adds methods to the prototype and must be loaded afterwards. The
 * menu structure and text come from shared-core (the same copy at both ends); here only determines what to do
 * after clicking.
 * @module dsh-pet/runtime/electron-helper/sprite-menu
 */
'use strict';

// The text of the first menu item changes with the host form: the desktop application evokes the main window, the standalone mode opens the local AI settings page, and the web host opens the site.
const OPEN_LABEL = { desktop: '打开软件', standalone: '打开 AI 设置', web: '打开网站' };

/** The bubble duration of the sleep rejection line (ms): slightly shorter than the default 10 s, it is just a rejection of "I was disturbed". */
const SLEEP_REFUSE_BUBBLE_MS = 8000;

Object.assign(PetSprite.prototype, {
  onContextMenu(e) {
    const d = this.dragState;
    if (d.active || d.dragging || this.justDragged || this.menuOpen) return;
    e.preventDefault();
    this.stopThrow(); // Stop the flying pet before the menu pops up
    this.stopMove(); // Pets do not roam during menu hover. Desktop exclusive tool root item + shared menu tree (Action → Category →
    // Specific animation). Whisper/conversation is displayed unconditionally: manual triggering is not restricted by
    // whisperEnabled (this field only affects automatic polling). The text and destination of the first item change
    // with the host form, see OPEN_LABEL. Sequence: open the software / balance / to-do / whisper / conversation / picture
    // / sleep → action tree → display position / reload configuration / return to the initial position.
    const tools = [
      {
        label: OPEN_LABEL[OPEN_TARGET],
        action: 'open-site',
        hint: OPEN_SHORTCUT_HINT,
      },
      // "Check Balance" is displayed unconditionally: balanceEnabled pets can also click it if it is turned off. Manual requests are not restricted by the switch. If you click it, you will definitely get a reply.
      { label: '查看余额', action: 'show-balance' },
      // "To-do items" is the only entry point of the to-do panel (clicking the pet will no longer pop up the panel), ranking after the balance.
      { label: '待办事项', action: 'todo', hint: S.TODO_HOTKEY_HINT },
      { label: '碎碎念', action: 'whisper' },
      { label: '对话', action: 'chat', hint: S.CHAT_HOTKEY_HINT },
    ];
    // "Pictures": The same branch as the browser (pictures included in the conversation/others), click on one and use
    // it to say a sentence; when there is no available picture, null will be returned, and the entire item will not
    // appear. The data comes from the entry-level fields (this.pet.memes/chatImageEnabled/chatImageLimit) blown in
    // from the flat layer, which is the same as flattenConfigPets on the web page; the thumbnail goes to the absolute
    // address of BASE/pic/memes (the desktop window is file://, and the relative path cannot get the image).
    const memeBranch = S.buildMemeBranch(this.pet, (name) => S.memeThumbUrl(BASE, this.pet.assetRoot, name));
    if (memeBranch) tools.push(memeBranch);
    // Sleep/wake up: When you are asleep, this item is "wake up" (clicking it is equivalent to waking up), when you
    // are awake, it is "sleep". The two types of text share the same position, ranking after the "image" and
    // before the action tree (the same arrangement as the menu on the browser side). If this entry is not configured
    // with animations.sleep, the entire entry will not appear - consistent with the configuration comment "not written
    // = no sleep function".
    if (Array.isArray(this.animations.sleep) && this.animations.sleep.length > 0) {
      if (this.sleeping) tools.push({ label: '起来', action: 'wake', hint: S.SLEEP_HOTKEY_HINT });
      else tools.push({ label: '睡觉', action: 'sleep', hint: S.SLEEP_HOTKEY_HINT });
    }
    // After the action tree is the maintenance class: display position → reload configuration → return to initial position.
    const tail = [
      // Display location (web page only/desktop only/both/neither): Change the display configuration of this pet, and
      // the host reload will take effect. Inject the same submenu as the browser side, and the copy and values at both
      // ends will not drift. Do not open and close windows in place: Windows are created once by pressing DSH_PET_PETS
      // when the process is started. In-place additions and deletions cannot change either the disk configuration or
      // the number of windows.
      S.displayMenuBranch(),
      // Reload configuration: Please restart the host desktop Helper and rebuild all windows according to the latest configuration. Maintenance actions are scheduled before returning to the initial position.
      { label: '重载配置', action: 'reload' },
      { label: '回到初始位置', action: 'home' },
    ];
    // Third-party menu items are unified under "More": label is the only direct tile, label has the same name as owner
    // molecule menu. Put it last - "More" is not inserted between the tool item and the action.
    const more = S.buildMoreBranch(this.menuItems);
    const tree = tools.concat(S.buildMenuTree(this.animations), tail, more ? [more] : []);
    if (!tree.length) return;
    this.menuOpen = true;
    this.setInteractive(true); // The menu is inside the window DOM: The entire window remains interactive during hovering, and the hit area is restored after closing click-through
    this.syncInputBusy();
    window.__dshPetDebug.menuOpen = true;
    const m = S.mountContextMenu({
      tree,
      x: e.clientX,
      y: e.clientY,
      // Only allowed to be displayed in "Window ∩ Workspace": When the pet is close to the edge, the expansion margin extends out of the screen, and the menu will be cropped by OS when entering there.
      clamp: this.visibleClampRect(),
      onAction: (leaf) => this.onMenuAction(leaf),
      // Menu clicked out/Esc closed (non-menu item path): Also reset the interactive mark and restore the hit area determination
      onClose: () => {
        this.menuOpen = false;
        window.__dshPetDebug.menuOpen = false;
        this.syncInputBusy();
        if (!this.inputBusy()) this.setInteractive(false);
      },
    });
    this.menuClose = m.close;
    this.syncInputRegions(); // mountContextMenu can only read the menu rectangle after completing the layout
  },

  /** keepFacing = caller has explicitly specified the orientation: Skip the following mirror correction of "Forcing the left orientation before text animation playback request", the explicit value takes precedence. */
  onMenuAction(leaf, keepFacing, fromHost) {
    this.closeMenu();
    if (!leaf || typeof leaf !== 'object') return;
    // Sleep: Interruption actions will be rejected at the moment of clicking - play a line and nothing will be
    // executed. Give way while holding a lock (lock = giving control to a third party). Dialog pop-ups, to-do panels,
    // and playback request animations are all renderer behaviors and cannot be blocked by the host gate; both ends use
    // the same release decision.
    if (this.sleeping && !this.frozen && !fromHost && !S.isSleepAllowedAction(leaf.action)) {
      const pool = Array.isArray(this.pet.sleepRefuseTexts) ? this.pet.sleepRefuseTexts : [];
      const text = pool[Math.floor(Math.random() * pool.length)];
      if (text !== undefined) this.showWhisper(text, undefined, undefined, SLEEP_REFUSE_BUBBLE_MS, false);
      return;
    }
    if (leaf.action === 'third-party') {
      // Third-party menu items: Only ( owner , label ) are handed over to the host, and the specific actions are left
      // to the register party to check / menu/events. Bring pets id - If the same menu item is clicked on different
      // pets, register must be able to tell which one it is.
      if (leaf.owner) {
        S.postAction(BASE + '/menu/click', { owner: leaf.owner, label: leaf.label, pet: this.pet.id }).catch(() => {
          /* Failure to report does not affect the local area: the register party will naturally not get this trigger next time it polls */
        });
      }
      return;
    }
    if (leaf.action === 'open-site') {
      if (window.petBridge) window.petBridge.openDshSite(ORIGIN); // The system default browser is opened (equivalent to Ctrl + click link)
      return;
    }
    if (leaf.action === 'show-balance') {
      this.showBalanceFromMenu(); // Pull the balance immediately and display it (no need to wait for 1 s to trigger polling, the display path is consistent with the periodic trigger)
      return;
    }
    if (leaf.action === 'sleep' || leaf.action === 'wake') {
      // Only send requests, and the screen will not move until the sleep leaf comes back: the three segment names and timing are determined by the host / renderer state machine (see setSleep)
      this.postSleepAction(leaf.action);
      return;
    }
    if (leaf.action === 'whisper') {
      // leaf.image only appears on the sub-item of the "Picture" menu: specify which picture to use for this sentence, and the other entry points are not included (pictures are still randomly selected).
      this.showWhisperFromMenu(leaf.image); // Immediately force host to generate a new sentence and display it (bypass throttling; the display path is consistent with the periodic trigger)
      return;
    }
    if (leaf.action === 'chat') {
      this.showChatFromMenu(); // Open the dialog pop-up window (memory via host / chat to read and write, browser/desktop shared in the same instance)
      return;
    }
    if (leaf.action === 'todo') {
      this.toggleTodo(); // Open the to-do panel (right-click menu entry point)
      return;
    }
    if (leaf.action === 'home') {
      this.goHome(); // Stop roaming/mobility, clear the session location, and return to the configuration corner
      return;
    }
    if (leaf.action === 'set-display') {
      this.setPetDisplay(leaf.display); // Change the display position of this pet: write display configuration, and it will take effect after host reloading
      return;
    }
    if (leaf.action === 'reload') {
      this.reloadDesktop(); // Please host to restart the desktop Helper: All desktop pet windows will be rebuilt according to the latest configuration.
      return;
    }
    if (!leaf.anim) return;
    // Receipt attribution: If this section comes from a third-party playback request, the number will follow the source change (self-broadcast animation transmission null)
    const playbackId = typeof leaf.playbackId === 'string' && leaf.playbackId ? leaf.playbackId : null;
    // The text class (noMirror) is mirrored to the right: it is forced to the left before playback request to avoid text mirroring. Skip if keepFacing (explicit values take precedence).
    if (!keepFacing && S.isNoMirrorAnimation(this.animations.categories, leaf.anim) && this.facing === 'right') {
      this.facing = 'left';
    }
    // playback request moving animation: real movement (same set as random walk), only "which animation to choose" is determined by the menu; if it cannot move, it will degrade to pure playback.
    if (this.animations.moves.actions.some((a) => a.name === leaf.anim)) {
      const moved = this.tryMove(leaf.anim, playbackId);
      if (moved === false) this.playOnce(leaf.anim, playbackId);
      // moved === true = There is already a move/throw in progress (no source change): this segment will not be played → truthfully return to failed/busy
      else if (moved === true && playbackId) this.reportPlayback(playbackId, 'failed', 'busy');
      return;
    }
    this.playOnce(leaf.anim, playbackId);
  },

  closeMenu() {
    if (this.menuClose) {
      this.menuClose();
      this.menuClose = null;
    }
    this.menuOpen = false;
    window.__dshPetDebug.menuOpen = false;
    this.syncInputBusy(); // Menu off: If there is no other occupation (drag/pop-up window), return to regular judgment.
    if (!this.inputBusy()) this.setInteractive(false);
  },

  // The balance menu sends a POST refresh command. Updating the state leaf changes its counter and immediately
  // releases the pending long poll, which displays the result through the usual path.
  // State S remains the sole data source; the menu only requests a refresh. Manual requests bypass balanceEnabled so a
  // disabled periodic balance feature still supports explicit checks.
  showBalanceFromMenu() {
    S.postAction(BALANCE_URL)
      .then((ok) => {
        if (!ok) console.warn('[dsh-pet] Balance refresh from the context menu failed');
      })
      .catch((e) => {
        console.error('[dsh-pet] Balance context-menu action threw an error', e);
      });
  },

  // "Whisper" menu: The POST action allows the host to immediately generate a new sentence (written into S). The
  // action does not return text. The text changes with the version number and is sent by hanging long polling. Manual
  // triggering is not restricted by whisperEnabled (this field only turns off the automatic cycle). If image is given,
  // only use this one (click on the specific picture in the "Picture" menu): if it is not in the pool, the host will
  // return unknown-image, and the local end will only record the log.
  showWhisperFromMenu(image) {
    // surface Required: This window is the desktop. The desktop window is file://, and the voice interface must use
    // the bridge absolute address; whether to read or not is determined by say.voiceTo. The identity of this terminal
    // has been registered as S.setSurface (' desktop ') at startup.
    S.setVoiceBase(BASE);
    // The picture name is the Chinese key in the configuration and must be encoded (may contain spaces and full-width characters)
    const pic = image ? '&image=' + encodeURIComponent(image) : '';
    S.postAction(WHISPER_URL + '?pet=' + encodeURIComponent(this.pet.id) + '&surface=desktop' + pic)
      .then((ok) => {
        if (!ok)
          console.warn(
            '[dsh-pet] Menu whisper generation failed pet=' + this.pet.id + (image ? ' image=' + image : ''),
          );
      })
      .catch((e) => {
        console.warn('[dsh-pet] Whisper context-menu action threw an error', e);
      });
  },

  // "Dialogue" menu: the simplest input box (shared component) - the pop-up window disappears after pressing Enter to
  // send, and the same style of reuse whisper is displayed (speaking animation + bubble 10 s), with only one more step
  // for user input. The memory is read and written via host / chat, and is shared between the browser and desktop of
  // the same instance. The pop-up window follows the body hit area this.hit (desktop pet is in the middle of the
  // video, the upper right corner of the video frame ≠ the upper right corner of the pet), and is automatically
  // clipped back when it exceeds the viewport; the pop-up window is DOM within the window, during which the entire
  // window remains interactive, and the hit area is restored after click-through is closed.
  /** Paste a picture when hovering: open the pop-up window with the picture when it is not open, and insert it when it is open; leave the pure text to the system for processing. */
  onPasteImage(e) {
    if (!this.hoverBody) return;
    // If the focus is in the input box, the text will be pasted normally. If you grab it, the text will be lost. In that case, the pop-up window will automatically respond.
    const active = document.activeElement;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return;
    const file = S.firstImageFromClipboard(e.clipboardData);
    if (!file) return;
    e.preventDefault();
    if (this.chatMount) {
      void this.chatMount.setImageFile(file);
      return;
    }
    this.showChatFromMenu(file);
  },

  /** Cut a frame (the main process takes the screen where the pet is); the shape is consistent with EncodedImage on the browser side. If it cannot be obtained, it will be thrown to the caller for decision. */
  async captureEncoded() {
    if (!window.petBridge || typeof window.petBridge.captureScreen !== 'function') {
      throw new Error('Screen capture is unavailable in this environment');
    }
    const shot = await window.petBridge.captureScreen();
    if (!shot) throw new Error('No screen image was captured');
    return {
      base64: shot.data,
      mediaType: shot.mediaType,
      bytes: shot.bytes,
      width: shot.width,
      height: shot.height,
      resized: true,
      previewUrl: 'data:' + shot.mediaType + ';base64,' + shot.data,
    };
  },

  /** Shortcut key for taking screenshots: If the pop-up window is open, insert the picture into the current pop-up window; if it is not open, open it with the picture; if the pop-up window cannot be taken, open the pop-up window and write down the reason. */
  async screenshotFromShortcut() {
    let encoded;
    try {
      encoded = await this.captureEncoded();
    } catch (error) {
      const reason = '截屏失败：' + (error && error.message ? error.message : error);
      if (this.chatMount) {
        this.chatMount.flash(reason);
        return;
      }
      this.showChatFromMenu();
      if (this.chatMount) this.chatMount.flash(reason);
      return;
    }
    if (this.chatMount) {
      this.chatMount.setEncoded(encoded);
      return;
    }
    this.showChatFromMenu(undefined, encoded);
  },

  showChatFromMenu(image, encoded) {
    if (this.chatMount) {
      this.chatMount.close();
      this.chatMount = null;
      return; // Already open: turn off the old one first
    }
    // The voice interface also uses the bridge address; whether to read or not is determined by say.voiceTo (the local identity is setSurface (' desktop ') when starting)
    S.setVoiceBase(BASE);
    const m = S.mountChatDialog({
      petId: this.pet.id,
      baseUrl: BASE + '/chat',
      surface: 'desktop',
      x: Math.max(4, this.hit.getBoundingClientRect().right + 6),
      y: Math.max(4, this.hit.getBoundingClientRect().top + 6),
      // When dragging and dropping on the pet, the pop-up window will be opened directly with the picture.
      ...(image ? { initialImage: image } : {}),
      // Screenshot shortcut key: The captured frame is base64, not File
      ...(encoded ? { initialEncoded: encoded } : {}),
      // Screenshot: main process takes a frame of the screen where the pet is (JPEG base64), the shape is consistent with the browser side
      capture: () => this.captureEncoded(),
      // The pop-up window is the same as the menu: it is only allowed to be displayed in "Window ∩ Workspace" and will not be cropped by the screen when it is attached to the edge.
      clamp: this.visibleClampRect(),
      onSent: () => {
        // Sent successfully: the reply has been written into S → the version number changes → the hanging long polling returns immediately and pops the bubble
        console.info('[dsh-pet] Chat sent pet=' + this.pet.id);
      },
      onClose: () => {
        this.chatMount = null;
        this.chatOpen = false;
        window.__dshPetDebug.chatOpen = false;
        this.syncInputBusy(); // Pop-up window closed: Return to normal judgment (remain busy if the menu is still open)
        if (!this.menuOpen) this.setInteractive(false); // Restore hit area click-through when there is no menu
      },
    });
    this.chatMount = m;
    this.chatOpen = true; // click-through guard: the entire window remains interactive during the pop-up window
    window.__dshPetDebug.chatOpen = true;
    this.syncInputBusy();
    this.setInteractive(true);
  },

  // Both ends of the shortcut key "Press and hold M to speak": if there is no pop-up window when pressed, open one
  // first, and then let it start recording; release it only to cleanup, not close the window, and the recognition
  // result will fall into the input box and wait for user confirmation (not automatically sent).
  startHearChat() {
    if (!this.chatMount) this.showChatFromMenu();
    if (this.chatMount) this.chatMount.startHear();
  },

  stopHearChat() {
    if (this.chatMount) this.chatMount.stopHear();
  },

  // To-do panel switch: The panel occupies the bubble slot (highest priority), during which the entire window remains
  // interactive, and the hit area is returned to click-through after closing. It shares shared/todo/panel with the
  // browser side, only the interface base address is different (the desktop is the file:// page, which must be an
  // absolute address).
  toggleTodo() {
    if (this.todoPanel) {
      this.closeTodo();
      return;
    }
    const panel = S.createTodoPanel({
      baseUrl: BASE + '/todos',
      onClose: () => this.closeTodo(),
      // Keep the list open when clicking the pet so users can drag the pet while reading the list.
      keepOpenOn: (target) => typeof target?.closest === 'function' && target.closest('.pet-hit') !== null,
    });
    // replaceChildren instead of appendChild: The last rendered line (whisper/balance) still remains in the bubble,
    // but renderBubble will return early when the panel is open and cannot reach the clear step, and the unclear line
    // will be stacked on top of the panel.
    this.bubble.replaceChildren(panel.el);
    this.todoPanel = panel;
    this.todoOpen = true;
    window.__dshPetDebug.todoOpen = true;
    this.renderBubble();
    this.syncInputBusy();
    this.setInteractive(true);
  },

  // Collapse the to-do panel: remove the panel node, remove the bubble variant class, and then return the slot to normal judgment.
  closeTodo() {
    const panel = this.todoPanel;
    if (!panel) return;
    panel.dispose();
    this.todoPanel = null;
    this.todoOpen = false;
    window.__dshPetDebug.todoOpen = false;
    this.renderBubble();
    if (!this.menuOpen && !this.chatOpen) this.setInteractive(false);
  },

  // "Return to initial position" menu: stop roaming/moving, clear the session position, and return to the configuration corner
  goHome() {
    this.stopThrow();
    this.stopMove();
    this.customPos = null;
    this.position();
  },

  // "Reload Configuration" menu: Please host the desktop Helper and use the same restart path as the "Save" setting
  // page (host POST /reload → syncDesktop). Without in-place re-pulling of the renderer: Number of
  // windows/display/size is built by the host according to DSH_PET_PETS, and global polling is started once
  // (loopsStarted). In-place reconstruction will miss the start of the new cycle or leave the old timer. This request
  // is issued by a process that is about to be restarted, and the response may never be returned (the callback address
  // has expired when the host kills the process), so there is no await or retry, and only a log is recorded for
  // failure - reloading itself means replacing the process.
  reloadDesktop() {
    fetch(BASE + '/reload', { method: 'POST' }).catch((e) => {
      console.warn('[dsh-pet] Configuration reload request failed; the host may be unreachable', e);
    });
  },

  // "Display location" menu: Change the display of this pet, write its own configuration, and then reload it by the
  // host to take effect. The value comes directly from the menu item, and the renderer does not perform derivation
  // (the current status is subject to the configuration). Do not open and close the window locally: the window is
  // created once by pressing DSH_PET_PETS when the process is started. The same situation as reloadDesktop: When
  // selecting "Only web pages/neither", this process will be replaced during reloading, so await will not be retried.
  setPetDisplay(display) {
    if (!display) return;
    fetch(BASE + '/pet-display', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: this.pet.id, display }),
    }).catch((e) => {
      console.warn('[dsh-pet] Display-mode request failed; the host may be unreachable', e);
    });
  },

  /**
   * Custom node tree → DOM (custom form renderer).
   *
   * tag and the style whitelist have been cut out in the parsing layer of shared, and only mapping is done here:
   * innerHTML is not used, the text is createTextNode, and there is no injection surface for third-party content. The
   * style key is camelCase, which can be directly assigned to el.style.
   */
  renderTree(node) {
    const el = document.createElement(node.tag);
    if (node.style) {
      for (const [key, value] of Object.entries(node.style)) el.style[key] = value;
    }
    if (node.tag === 'img') {
      el.src = node.src || '';
      el.alt = '';
      return el;
    }
    // Text and sub-nodes can exist at the same time: text first, then sub-nodes (consistent with the order of textContent + appendChild)
    if (node.text) el.appendChild(document.createTextNode(node.text));
    for (const child of node.children || []) el.appendChild(this.renderTree(child));
    return el;
  },
});
