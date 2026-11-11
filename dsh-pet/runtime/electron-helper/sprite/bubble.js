/**
 * Rendering of bubbles and floating prompts: the three pieces of content, working status / whisper / balance, share a
 * bubble slot, and one is displayed according to priority.
 *
 * PetSprite is defined by sprite.js. This file only adds methods to the prototype and must be loaded afterwards.
 * read-only instance state, no fields are written except DOM and syncInputBusy().
 * @module dsh-pet/runtime/electron-helper/sprite-bubble
 */
'use strict';

Object.assign(PetSprite.prototype, {
  setTip(on) {
    const next = !!on;
    if (next === this.tipOn) return;
    this.tipOn = next;
    this.renderTip();
  },

  /**
   * Rendering of floating prompts: text = pet display name (host is guaranteed to be non-empty); position = lower
   * right of the cursor (cannot be loaded and automatically flanged), and the positioning criterion shares shared and
   * tooltipPlacement with the browser.
   *
   * The cursor stores the viewport coordinates, and the prompts are position:fixed and DOM coordinates relative to the
   * window, so the window origin is subtracted here. The viewport coordinates are stored instead of the window
   * coordinates because the window will move with the pet: it is only recalculated based on the current origin here,
   * and the cursor will not drift.
   */
  renderTip() {
    if (this.tip.textContent !== this.pet.name) this.tip.textContent = this.pet.name;
    const cursor = this.tipCursor;
    if (cursor) {
      const winX = this.pos.x - this.winOffset.x;
      const winY = this.pos.y - this.winOffset.y;
      const winW = this.size + this.margin.l + this.margin.r;
      const winH = this.winH + this.margin.t + this.margin.b;
      // Allowed display range = window ∩ The work area of the screen where the cursor is located: just pressing the
      // window clip will draw it outside the screen, and just pressing the work area clip will fall outside the window
      // (html/body is overflow:hidden, which is also invisible).
      const area = S.resolveRect(WORK_AREAS, cursor.x, cursor.y) ?? { x: winX, y: winY, width: winW, height: winH };
      const x0 = Math.max(winX, area.x);
      const y0 = Math.max(winY, area.y);
      const x1 = Math.min(winX + winW, area.x + area.width);
      const y1 = Math.min(winY + winH, area.y + area.height);
      const p = S.tooltipPlacement(
        { x: cursor.x - winX, y: cursor.y - winY },
        { w: this.tip.offsetWidth, h: this.tip.offsetHeight },
        { x: x0 - winX, y: y0 - winY, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) },
        this.size * S.TOOLTIP_GAP_RATIO,
      );
      this.tip.style.left = p.x + 'px';
      this.tip.style.top = p.y + 'px';
    }
    this.tip.classList.toggle('is-on', this.tipOn);
    window.__dshPetDebug.tooltipOn = this.tipOn;
  },
  renderBubble() {
    // The to-do panel occupies the bubble slot and has the highest priority: it is the window that the user actively
    // opens, and all other bubbles will give way. The panel is DOM plugged in from the outside. Rebuilding innerHTML
    // will erase it, so this section only makes up for the display and hiding.
    this.bubble.classList.toggle('dsh-pet-todo-bubble', this.todoOpen);
    if (this.todoOpen) {
      this.bubble.classList.remove('is-whisper', 'is-clickable', 'is-expanded', S.MEME_BUBBLE_CLASS);
      this.bubble.classList.add('is-on');
      window.__dshPetDebug.lastBubbleTitle = '待办事项';
      this.syncInputBusy();
      return;
    }
    // bubble single slot: only one is displayed at the same time (priority: final task > whisper/dialogue > balance >
    // non-final task). The final state task does not give way: the completed/failed bubble only lives 10 s, and it
    // will be completely invisible if it is pushed out; the non-final state bubble is permanent, and there is zero
    // loss when giving way. The work bubble has the same style as whisper (width adaptive + automatic word wrapping);
    // the picture mark is given to CSS (cancel min-width when adding pictures). The picture URL has the same rules as
    // the video: pass the BASE prefix (the desktop is the file:// page, which must be an absolute address), and the
    // asset root is the same.
    const workOn = !!(this.workOn && this.workText);
    const whisperOn = !!(this.whisperOn && this.whisperView);
    const balanceOn = !!(this.bubbleOn && this.balanceView);
    const workTerminal = this.workState === 'success' || this.workState === 'error';
    const slot =
      workTerminal && workOn ? 'work' : whisperOn ? 'whisper' : balanceOn ? 'balance' : workOn ? 'work' : 'none';
    // Remember the current slot: click processing is at init.js. You must know "which bubble is displayed now" to distinguish between page turning and session jumping.
    this.bubbleSlot = slot;
    // Choose one of two forms of pictures: url uses the complete address, image uses the asset root to spell the meme path; style/class is shared.
    const whisperImg =
      slot === 'whisper'
        ? this.whisperUrl
          ? S.createMemeImageFromUrl(this.whisperUrl)
          : S.createMemeImage(this.whisperImage, BASE, this.assetRoot)
        : null;
    this.bubble.classList.toggle(
      'is-whisper',
      // The balance "text description" also has a compact variant: the font size is smaller, the lower limit of the width is narrower, and the multi-line description is more compact.
      slot === 'whisper' || slot === 'work' || (slot === 'balance' && this.balanceWrap),
    );
    this.bubble.classList.toggle(S.MEME_BUBBLE_CLASS, !!whisperImg);
    // Apply separate clickable and expanded classes. Clickable bubbles participate in syncInputRegions; index > 0 uses
    // a wider box and smaller text.
    // Only built-in windows detail and usage pages expand. Custom pages remain peers and retain the same text size
    // when paging.
    const isCustom = !!(this.balanceState && S.customViews(this.balanceState));
    const workClickable = this.workClickable();
    const clickable = (slot === 'balance' && this.balanceClickable()) || workClickable;
    const expanded = slot === 'balance' && clickable && !isCustom && this.balanceViewIndex > 0;
    this.bubble.classList.toggle('is-clickable', clickable);
    this.bubble.classList.toggle('is-expanded', expanded);
    if (slot === 'none') {
      // None of the three have displayable content: hidden (does not occupy space, so it will not block any layer)
      this.bubble.classList.remove('is-on');
      window.__dshPetDebug.lastBubbleTitle = '';
      this.syncInputBusy(); // The bubble is gone → Cancel its control rectangle and busy mark (otherwise the entire window will still have a clickable area)
      return;
    }
    this.bubble.innerHTML = '';
    if (slot === 'work') {
      const line = document.createElement('div');
      line.className = 'pet-bub-row';
      line.textContent = this.workText;
      this.bubble.appendChild(line);
    } else if (slot === 'whisper') {
      // Pictures (generated by shared < img > + shared style): Look at the pictures first and then read the words
      if (whisperImg) this.bubble.appendChild(whisperImg);
      const line = document.createElement('div');
      line.className = 'pet-bub-row';
      line.textContent = this.whisperView[0]?.text ?? '';
      this.bubble.appendChild(line);
      // Voice status code: idle does not add anything; failed uses a mute speaker to indicate that the sentence is not pronounced.
      const voice = S.getVoiceState();
      if (voice !== 'idle') {
        S.injectMemeBubbleCss(); // The corner mark style and the accompanying picture are the same CSS, shared at both ends.
        const badge = document.createElement('span');
        badge.className =
          'dsh-pet-voice-badge' + (voice === 'loading' ? ' is-loading' : '') + (voice === 'failed' ? ' is-failed' : '');
        badge.setAttribute('aria-hidden', 'true');
        if (voice === 'ready') badge.textContent = '🔊';
        else if (voice === 'failed') badge.textContent = '🔇';
        this.bubble.appendChild(badge);
      }
    } else if (this.balanceState && S.customViews(this.balanceState)) {
      // custom form: third party’s own node tree. The page index retrieves the current page; when the number of pages becomes less, it clips to the last page and does not display the remaining pages.
      const views = S.customViews(this.balanceState);
      const page = views[Math.min(this.balanceViewIndex, views.length - 1)];
      if (page) this.bubble.appendChild(this.renderTree(page));
    } else {
      // The expanded rows are calculated here: renderBubble is a read-only rendering path and is not cached (the
      // balance changes every round, but the cache must be invalidated simultaneously). The content of each page has
      // the same source as the page number (S.balancePageView / S.balancePageCount): no longer divided by "index > 0,
      // that is, window details", otherwise the new usage page will be squeezed into the same page as the details.
      // Fallback to the cached above-the-fold row when there are no readings.
      const rows = this.balanceState ? S.balancePageView(this.balanceState, this.balanceViewIndex) : this.balanceView;
      const hasTier = rows.some((r) => r.role === 'tier');
      if (hasTier) {
        // deepseek Balance single line: Balance (peak/trough) ¥ x — state word coloring
        const line = document.createElement('div');
        line.className = 'pet-bub-row';
        for (const r of rows) {
          const span = document.createElement('span');
          if (r.role === 'tier') span.className = 'pet-bub-tier pet-bub-tier-' + r.tier;
          span.textContent = r.text;
          line.appendChild(span);
        }
        this.bubble.appendChild(line);
      } else {
        for (const r of rows) {
          // One line in the expanded state = one window: window name + progress bar + used percentage + reset countdown, four segments flex in the same row, the bar takes up the remaining width.
          if (r.role === 'quota') {
            const row = document.createElement('div');
            row.className = 'pet-bub-quota';
            const label = document.createElement('span');
            label.className = 'pet-bub-quota-label';
            label.textContent = r.label;
            const bar = document.createElement('span');
            bar.className = 'pet-bub-quota-bar';
            const fill = document.createElement('i');
            fill.className = 'pet-bub-quota-fill pet-bub-quota-' + r.tone;
            fill.style.width = Math.max(0, Math.min(100, r.percent)) + '%';
            bar.appendChild(fill);
            const used = document.createElement('span');
            used.className = 'pet-bub-quota-used';
            used.textContent = r.usedText;
            const reset = document.createElement('span');
            reset.className = 'pet-bub-quota-reset';
            reset.textContent = r.resetText;
            row.append(label, bar, used, reset);
            this.bubble.appendChild(row);
            continue;
          }
          // Usage page: three rows and two columns, the total amount is the only big word; there is an accent color for each entry/exit, and the rest are gray.
          if (r.role === 'usage') {
            const box = document.createElement('div');
            box.className = 'pet-bub-usage';
            const line = (cells) => {
              const row = document.createElement('div');
              row.className = 'pet-bub-usage-line';
              for (const cell of cells) {
                const span = document.createElement('span');
                span.className = cell.cls;
                span.textContent = cell.text;
                row.appendChild(span);
              }
              return row;
            };
            // In/out ratio bar: The width is the actual proportion. The input usually accounts for an overwhelming majority. It is normal for the bar to be a single color.
            const bar = document.createElement('div');
            bar.className = 'pet-bub-usage-bar';
            if (r.inputPercent !== undefined) {
              const inBar = document.createElement('i');
              inBar.className = 'pet-bub-usage-bar-in';
              inBar.style.width = r.inputPercent + '%';
              const outBar = document.createElement('i');
              outBar.className = 'pet-bub-usage-bar-out';
              outBar.style.width = 100 - r.inputPercent + '%';
              bar.append(inBar, outBar);
            }
            box.append(
              line([
                { cls: 'pet-bub-usage-title', text: r.title },
                { cls: 'pet-bub-usage-total', text: r.total },
              ]),
            );
            if (r.inputPercent !== undefined) box.appendChild(bar);
            box.append(
              line([
                { cls: 'pet-bub-usage-in', text: r.input },
                { cls: 'pet-bub-usage-out', text: r.output },
              ]),
              line([
                { cls: 'pet-bub-usage-period', text: r.period },
                { cls: 'pet-bub-usage-spend', text: r.spend },
              ]),
            );
            this.bubble.appendChild(box);
            continue;
          }
          const div = document.createElement('div');
          if (r.role === 'error') div.className = 'pet-bub-err';
          else if (r.role === 'sub') div.className = 'pet-bub-row pet-bub-sub';
          else div.className = 'pet-bub-row';
          div.textContent = r.text;
          this.bubble.appendChild(div);
        }
      }
    }
    this.bubble.classList.add('is-on');
    window.__dshPetDebug.lastBubbleTitle = this.bubble.textContent.slice(0, 60);
    // The bubble content/size has changed → Re-report the control rectangle and synchronize the busy mark. This is where all the revealing and changing content comes together.
    this.syncInputBusy();
  },
});
