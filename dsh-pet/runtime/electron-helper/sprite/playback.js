/**
 * Playback state machine: source change, front and back alternation, cleanup, freeze and occupation lock, idle random
 * chain.
 *
 * PetSprite is defined by sprite.js. This file only adds methods to the prototype and must be loaded afterwards. The
 * read-only instance state and the pool selection function of shared-core, the side effect is the DOM video source and
 * the this .* field.
 * @module dsh-pet/runtime/electron-helper/sprite-playback
 */
'use strict';

Object.assign(PetSprite.prototype, {
  switchTo(next, nextOnce, playbackId, url) {
    if (!next) return;
    // "Which segment is currently being played" is only written here: ended. Read it for offloading, returning to idle
    // patches, and random links to avoid duplication. When handed over to the caller for maintenance, switchTo ( x ,
    // false ) will leave expired values, and the events.js judgment of "whether it is a working animation" will never
    // be established.
    this.anim = next;
    this.once = !nextOnce;
    const pending = this.pending;
    if (pending && pending.anim === next && pending.once === nextOnce) {
      // Anti-rehit (target = current animation when single animation is clicked, no replay): still consume the Q
      // bullet mark, press the current foreground video, and ensure that the squeeze feedback is not lost when
      // "clicking on the only animation" (isomorphic to the browser).
      if (this.pendingSquash) {
        this.pendingSquash = false;
        this.startSquash(this.front === 0 ? this.videoA : this.videoB);
      }
      // The target of this playback request is already playing (the source is not changed but it is actually playing) → return playing truthfully, otherwise the caller can only wait for timeout
      if (playbackId) {
        this.playback = playbackId;
        this.reportPlayback(playbackId, 'playing');
      }
      return;
    }
    const gen = ++this.gen;
    this.pending = { anim: next, once: nextOnce, gen };
    const target = this.front === 0 ? this.videoB : this.videoA;
    const el = target;
    if (!el) return;
    // There are two ways of asset address: url form directly uses the complete address given by the third party (the
    // host has stuck scheme in http/https, without going through bridge, nor spelling BASE); name form is spelled by
    // "asset root + name".
    el.src = url || this.assetBase + encodeURIComponent(next) + (S.ANIMATION_EXT || '.webm');
    el.loop = !nextOnce;
    el.muted = true;
    el.autoplay = true;
    el.playsInline = true;
    el.onended = nextOnce ? () => this.handleEnded() : () => this.restartLoop(el);
    // Loading fallback (same as the browser side 10 s timeout): pending must be released when the asset fails to load
    // or is stuck, otherwise it will hang permanently - the same target will be swallowed by the anti-duplication
    // branch, and different targets will be covered by gen. The performance is "no response after clicking".
    const loadGuard = (why) => {
      if (!this.pending || this.pending.gen !== gen) return;
      this.pending = null;
      console.warn(
        '[dsh-pet] Asset loading failed pet=' +
          this.pet.id +
          ' anim=' +
          next +
          '：' +
          why +
          '(source switch already disposed)',
      );
      // Playback receipt: This segment could not be played → truthfully return failed (instead of letting the caller wait until timeout)
      if (playbackId) {
        if (this.playback === playbackId) this.playback = null;
        this.reportPlayback(playbackId, 'failed', why === 'video error' ? 'decode-error' : 'asset-load');
      }
    };
    const loadTimer = window.setTimeout(() => loadGuard('10s 超时'), 10000);
    el.onerror = () => {
      window.clearTimeout(loadTimer);
      loadGuard('video error');
    };
    el.load();
    const onReady = () => {
      el.removeEventListener('loadeddata', onReady);
      window.clearTimeout(loadTimer);
      el.onerror = null;
      if (this.pending && this.pending.gen !== gen) return;
      const old = this.front === 0 ? this.videoA : this.videoB;
      el.classList.add('is-front');
      if (old && old !== el) {
        old.classList.remove('is-front');
        old.onended = null;
        old.pause();
        // If the section that is replaced is a third-party playback request and has not finished playing → return to
        // cancelled truthfully (marked when the new playback request is pushed out and accepted by the host, what is
        // added here is click/drag/whisper/balance/work status/idle recycling and other non-playback request
        // interruptions).
        if (this.playback && this.playback !== playbackId) {
          this.reportPlayback(this.playback, 'cancelled', 'superseded');
        }
      }
      this.front = this.front === 0 ? 1 : 0;
      this.pending = null;
      this.playback = playbackId || null;
      el.style.transform = this.facing === 'right' ? 'scaleX(-1)' : '';
      el.play()
        .then(() => {
          // Only the cashing of play() means that the painting has actually started (loadeddata only means that it can be decoded)
          if (playbackId) this.reportPlayback(playbackId, 'playing');
        })
        .catch(() => {
          // Automatic playback rejected/element not playable: return failed truthfully without changing the playback control
          if (!playbackId) return;
          if (this.playback === playbackId) this.playback = null;
          this.reportPlayback(playbackId, 'failed', 'play-rejected');
        });
      // Click Q to pop up: wait for the new animation to be in place before pressing (the first frame of the new click animation is pressed, consistent with the browser)
      if (this.pendingSquash) {
        this.pendingSquash = false;
        this.startSquash(el);
      }
      if (this.pendingMove) this.startMoveDrive(el);
    };
    el.addEventListener('loadeddata', onReady);
    if (el.readyState >= 2) onReady();
  },

  /**
   * The loop segment received ended: Return to the starting point to resume broadcasting.
   *
   * The loop segment should not have ended; its appearance indicates that the asset has been truncated or the decoding
   * has ended prematurely, and the picture has stopped at the last frame. Do not change the source: Changing the
   * source will rebuild the entire playback chain, which is more expensive and may be cut off again at the same place.
   */
  restartLoop(el) {
    el.currentTime = 0;
    void el.play().catch(() => {});
  },

  playOnce(name, playbackId, url) {
    this.switchTo(name, true, playbackId, url);
  },

  // Directly broadcast an external address. A single method, no reuse onMenuAction: That set is the menu semantics
  // (the text class is forced to correct the image to the left, the mobile class uses the real displacement), and the
  // naked address does not have these attributes. Here we only need to stop roaming and change the source to play
  // once, and then return to the normal animation chain after playing; the address itself is also the anti-duplication
  // key and log identification of pending.
  playUrlOnce(url, playbackId) {
    this.stopMove();
    this.playOnce(url, playbackId, url);
  },

  /**
   * Occupying lock: freeze/unfreeze (same semantics as browser).
   *
   * Only four things are blocked during the freezing period, and they are all in the renderer: random chain, current
   * self-playing animation (pause and freeze frame), balance and working status performance of automatic sources (see
   * events.js's onBalanceTick / onWorkTick / showBalanceNotice), and task status bubble on the screen (closed when the
   * lock is in effect, not highlighted when unfrozen). Explicit instructions ( say / anim / position / throw ) are not
   * blocked at all - that's what occupancy is meant to protect.
   */
  applyFreeze(next) {
    if (this.frozen === next) return;
    this.frozen = next;
    const el = this.front === 0 ? this.videoA : this.videoB;
    const stamp = '[dsh-pet] ' + new Date().toTimeString().slice(0, 8) + ' pet=' + this.pet.id;
    if (next) {
      // Stop the currently playing segment: The host cannot stop a video, and complete stillness can only be executed
      // by the renderer; just blocking the random chain entry point is not enough, and that entry point will not be
      // called until the animation is finished.
      this.stopMove();
      if (el) el.pause();
      // Playback receipt: Freezing interrupts the third-party playback request being played → Return cancelled
      // truthfully instead of letting it hang playing (the caller hanging wait = ended will wait for a timeout in
      // vain). Unfreezing goes back to the idle/restore state and will not bring it back. Clear this.playback first and
      // then report it to avoid reporting it again as "rejected" after subsequent source changes.
      const interrupted = this.playback;
      if (interrupted) {
        this.playback = null;
        this.reportPlayback(interrupted, 'cancelled', 'frozen');
      }
      // Task status bubble: it will be closed as soon as the lock takes effect, and will not be filled in after thawing.
      if (this.workTimer !== null) window.clearTimeout(this.workTimer);
      this.workTimer = null;
      this.workOn = false;
      this.renderBubble();
      console.log(
        stamp + ' Lock acquired: freeze random actions, pause current animation and dismiss work-state bubbles',
      );
      return;
    }
    console.log(stamp + ' Lock released: resume');
    // Unfreezing: sleeping position is given priority to be retrieved (freezing only pauses, does not change the
    // source, and resumes broadcasting), and then returns to the non-final working state to cycle, otherwise it
    // returns to idle once, and handleEnded is used to retrieve the random chain after broadcasting.
    if (this.resumeSleepAnim()) return;
    if (this.resumeWorkStatusAnim()) return;
    if (this.animations.idle.length) this.playOnce(S.pick(this.animations.idle, this.anim));
  },

  /**
   * Lock leaves → freeze/thaw.
   *
   * expiresAt has passed = no lock: the stale leaves obtained after the window is reloaded must be judged this way,
   * and you cannot just look at locked. The host will not push "the lock is gone" when it reaches the point, so it is
   * released periodically here, and the "points" at both ends have the same source.
   */
  setLock(state) {
    if (this.lockTimer !== null) {
      window.clearTimeout(this.lockTimer);
      this.lockTimer = null;
    }
    const expiresAt = state && state.locked === true ? state.expiresAt : 0;
    this.applyFreeze(expiresAt > Date.now());
    if (expiresAt <= Date.now()) return;
    this.lockTimer = window.setTimeout(
      () => {
        this.lockTimer = null;
        this.applyFreeze(false);
      },
      Math.max(0, expiresAt - Date.now()),
    );
  },

  /**
   * Sleeping leaves → going to sleep/waking up (same style as setLock: only recognize the value in the leaves, do not
   * write back).
   *
   * The names of the three segments are selected by the host. There is no need to select the names again here -
   * choosing by yourself will cause different sets to be broadcast on both ends (squatting to fall asleep, lying on
   * the stomach to wake up). If you don’t clear the sleep state immediately after waking up: `end` has to be played
   * again. The cleanup and random chain recovery are in handleEnded.
   * @param state - `{ sleeping: true, start, loop, end }` or `{ sleeping: false }` .
   */
  setSleep(state) {
    if (!state) return;
    const stamp = '[dsh-pet] ' + new Date().toTimeString().slice(0, 8) + ' pet=' + this.pet.id;
    if (!state.sleeping) {
      // Not sleeping: waking up is an idempotent no-op (repeat leaf, old host, or wake up an originally awake pet)
      if (!this.sleeping || this.sleepPhase === 'end') return;
      // Being woken up during the transition to falling asleep: Cancel this fall asleep and do not play "get up" - it
      // did not really fall asleep. There is no source change here: clicking on the path has already played the
      // broadcast by itself, and clicking on the response; when the menu wakes up, the current "Start" will naturally
      // return to the random link after playing.
      if (this.sleepPhase === 'start') {
        this.sleeping = false;
        this.sleepSet = null;
        this.sleepPhase = null;
        console.log(stamp + ' Sleep entry interrupted: skip the wake animation');
        return;
      }
      this.sleepPhase = 'end';
      this.stopMove();
      this.playOnce(this.sleepSet.end);
      console.log(stamp + ' Waking: play ' + this.sleepSet.end + ' once');
      return;
    }
    // Already sleeping (including the transition section of "Get Up" being played): Repeating leaves will not play back, and the original set will be kept.
    if (this.sleeping) return;
    this.sleeping = true;
    this.sleepSet = { start: state.start, loop: state.loop, end: state.end };
    this.sleepPhase = 'start';
    this.stopMove();
    // The same conventions as occupation lock: close the task status bubble when you go to sleep (do not fill in the light when you wake up, wait for the next status change to align again)
    if (this.workTimer !== null) window.clearTimeout(this.workTimer);
    this.workTimer = null;
    this.workOn = false;
    this.renderBubble();
    this.playOnce(state.start);
    console.log(stamp + ' Entering sleep:' + state.start + ' → ' + state.loop);
  },

  /**
   * Request to sleep/wake up: only send a request, the screen will not move until the sleep leaf comes back (the
   * three-segment name is selected by the host).
   *
   * The click and right-click menu share this path; if it fails, only the log will be recorded, and no box will pop up
   * - the menu action should not interrupt the user.
   * @param action - `'sleep'` = go to sleep, `'wake'` = wake up.
   */
  postSleepAction(action) {
    const route = action === 'wake' ? '/wake' : '/sleep';
    S.postAction(BASE + route + '?pet=' + encodeURIComponent(this.pet.id)).then((ok) => {
      if (!ok)
        console.error('[dsh-pet] ' + (action === 'wake' ? 'Wake' : 'Sleep') + 'Request failed pet=' + this.pet.id);
    });
  },

  // Animation chain (pure logic in shared)
  playIdle() {
    // Occupied lock: No dice roll while lock is in effect. This is the only entry point of the random chain (it will
    // be reached only after the animation is played). With one judgment, the random animation, random steering and
    // autonomous movement will be stopped together - the pet stops at the last frame, waiting for the next instruction
    // from the lock holder (walk / anim, do not pass here).
    if (this.frozen) return;
    // Sleeping: The random chain stops completely - no dice roll, no walking, no turning direction. When waking up,
    // setSleep plays end first, and after playing, handleEnded clears the sleeping state and then returns here
    // (sleeping is already false at that time).
    if (this.sleeping) return;
    this.stopMove();
    const { animations, animationWeights } = { animations: this.animations, animationWeights: this.weights };
    const roll = Math.random();
    // Pet fixed: When rolling the dice, the two weights of "Turn/Move" are calculated as 0, and the random chain will
    // no longer allow the pet to turn its own direction or move away; the menu playback request and / anim will not go
    // here and will not be affected.
    const k = S.rollKind(roll, animationWeights, { fixed: this.pet.fixedEnabled });
    let next;
    if (k === 'idle') {
      next = S.pick(animations.idle, this.anim);
    } else if (k === 'turn') {
      next = S.pick(animations.turn, this.anim);
    } else if (k === 'move') {
      const moved = this.tryMove();
      if (moved === false) {
        const act = S.pickCategoryAction(animations.categories, animations.idle, this.facing, this.anim);
        next = act.name;
      } else if (typeof moved === 'string') {
        next = moved;
      } else {
        // There is already a move in progress: replay the current animation without setting another one (never load a non-existing move)
        this.playOnce(this.anim);
        return;
      }
    } else {
      const act = S.pickCategoryAction(animations.categories, animations.idle, this.facing, this.anim);
      next = act.name;
    }
    this.playOnce(next);
  },

  handleEnded() {
    // Playback receipt: The front-end video has really finished playing → truthfully reply to ended. Place it before
    // the drag guard - "The broadcast is over" is a fait accompli. The drag guard manages how the animation chain
    // advances and should not affect the accuracy of the receipt.
    if (this.playback) {
      const done = this.playback;
      this.playback = null; // Clear first and then report: subsequent chain source changes should not be regarded as "interrupted"
      this.reportPlayback(done, 'ended');
    }
    // Sleep: The advancement of the animation chain returns to the sleep state machine (start finishes playing → loop;
    // end finishes playing → clears the state and returns to the random chain). Place it before the drag guard: the
    // animation will not be changed when dragging while sleeping, and the sleeping position will still be played.
    // After playing start, you must switch to loop as usual, otherwise it will stop at the last frame when you let go.
    // These branches are all return in advance, and the rest of the ended logic (event rotation, direction flip,
    // random chain) will not be executed when blocked.
    if (this.sleeping) {
      const set = this.sleepSet;
      if (set && this.sleepPhase === 'start') {
        this.sleepPhase = 'loop';
        // Loop segment: loop = true; in case the asset advances ended, restartLoop will continue playing in place and will not enter handleEnded.
        this.switchTo(set.loop, false);
        return;
      }
      if (this.sleepPhase === 'end') {
        // Wake up cleanup: clear the sleeping state first and then return to the random chain, otherwise playIdle will be blocked by its own validation check
        this.sleeping = false;
        this.sleepSet = null;
        this.sleepPhase = null;
        this.playIdle();
        return;
      }
      // The loop segment should not have ended; if it is received, it means that the foreground has been pushed by other animations (local menu playback request). Take the sleeping position back and don't stop at the last frame.
      if (set && this.anim !== set.loop) {
        this.switchTo(set.loop, false);
      }
      return;
    }
    if (this.dragState.active) return;
    // Occupying lock: The animation chain will not advance during the freezing period, and the event animation will
    // stop at the last frame after playing. The following channels will change the source and play, and what they read
    // is real-time workState, which has nothing to do with workTick. The validation check of onWorkTick cannot stop it
    // - especially "restore the state after the event animation is played": every time the lock holder casts a bubble
    // with anim, the working status animation will be restored after the speaking animation is played. Playback
    // receipts are reported above and are not affected by this line.
    if (this.frozen) return;
    const { animations } = { animations: this.animations };
    // After the event animation is played: return to idle (the same branch as drag/clicks, not entering the random chain); the bubble disappears automatically by the timer and is decoupled from the animation
    const isEvent = S.isEventAnim(animations.events, this.anim);
    if (isEvent) {
      // Multiple candidate states in working state: automatically rotate to the next candidate after playing one
      // segment, and the long-term state does not repeat in a single segment; only the non-final state states rotate,
      // and the final state stops after the broadcast is completed; the single candidate state is infinitely looped by
      // loop (normally, ended is not triggered, and it cannot go here).
      const nonTerminal = this.workState && this.workState !== 'success' && this.workState !== 'error';
      const nextWork = nonTerminal ? S.nextWorkStatusAnim(animations.events?.workStatus ?? [], this.anim) : null;
      if (nextWork !== null) {
        console.log(
          '[dsh-pet] ' +
            new Date().toTimeString().slice(0, 8) +
            ' pet=' +
            this.pet.id +
            ' workStatus animation rotation: ' +
            this.anim +
            ' -> ' +
            nextWork,
        );
        this.playOnce(nextWork); // Continue to play again (once = true) → ended and rotate again
        return;
      }
      // After the non-workStatus event animation (balance/whisper) is played: workStatus is still not the final state
      // → immediately resume the state cycle animation and do not enter the random chain (the state remains unchanged
      // during the long event, the random chain will be played until the state is switched and then pulled back)
      if (this.resumeWorkStatusAnim()) return;
      if (animations.idle.length) this.playOnce(S.pick(animations.idle, this.anim));
      return;
    }
    if (animations.turn.includes(this.anim)) {
      const next = this.facing === 'left' ? 'right' : 'left';
      this.facing = next; // Immediate synchronization: flipped pickNext filtered with new orientation noMirror
    }
    if (animations.drag.includes(this.anim) || animations.clicks.includes(this.anim)) {
      // After the interactive animation is played: workStatus returns to the state loop when it is not the final state, otherwise it returns to idle (same semantics as the browser)
      if (this.resumeWorkStatusAnim()) return;
      if (animations.idle.length) this.playOnce(S.pick(animations.idle, this.anim));
      return;
    }
    this.playIdle();
  },

  // After the interactive/event animation is played, the working state is restored. The state cycle: non-final state →
  // reselect the animation according to the current state (avoiding the current segment); final state/idle → false does
  // not take over, and the caller follows the original logic.
  resumeWorkStatusAnim() {
    // Occupied lock: During the freezing period, the working status animation is not allowed to be clicked back
    // through this path - it reads real-time workState, which has nothing to do with workTick. Every time the lock
    // holder casts a bubble with anim, he will come here after the talking animation is played. The unfreezing path is
    // to set frozen = false first and then adjust it.
    if (this.frozen) return false;
    // Sleep: The automatic source does not take over the animation - the entire sleeping posture cycle returns to the sleep state machine, and when you wake up, end plays back to the random chain.
    if (this.sleeping) return false;
    const state = this.workState;
    if (!state || state === 'success' || state === 'error') return false;
    const pool = this.animations.events?.workStatus;
    if (!pool || pool.length === 0) return false;
    const idx = S.WORK_STATUS_INDEX[state];
    const slot = pool[idx];
    if (slot === undefined) return false;
    const name = S.pickSlot(slot, this.anim); // Avoid the currently playing animation (avoid continuous repetition)
    console.log(
      '[dsh-pet] ' +
        new Date().toTimeString().slice(0, 8) +
        ' pet=' +
        this.pet.id +
        ' Resuming work-state animation: ' +
        name,
    );
    const rotating = Array.isArray(slot) && slot.length > 1;
    if (rotating)
      this.playOnce(name); // Multiple candidates: rotate by handleEnded after broadcast
    else this.switchTo(name, false); // Single candidate: infinite loop
    return true;
  },

  // The section that was frozen and paused during sleep can be resumed and played (only pause can be frozen, and the
  // source can be continued without changing the source. start can still be played after playing handleEnded). Return
  // to false when no longer sleeping, allowing the caller to continue on its original recovery path.
  resumeSleepAnim() {
    if (!this.sleeping) return false;
    const el = this.front === 0 ? this.videoA : this.videoB;
    if (el) el.play().catch(() => {});
    return true;
  },

  // Roaming (rAF driver, leadSec/tailSec seconds at the beginning and end of animation; geometry at shared/planMove).
  // This animation is fixed when preferredName is passed in (menu playback request mobile animation), otherwise it is
  // randomly selected consistent with the random chain.
  tryMove(preferredName, playbackId) {
    if (this.moveRef !== null || this.pendingMove || this.throwRef !== null) return true;
    const moves = this.animations.moves;
    const actions = moves.actions;
    if (!actions.length) return false;
    const chosen = preferredName
      ? actions.find((a) => a.name === preferredName) || null
      : actions[Math.floor(Math.random() * actions.length)];
    if (!chosen) return false;
    const mp = Object.assign({}, moves.default, chosen.params || {});
    // Heading → Walking direction: only look at the current facing. turn will synchronize the direction immediately
    // after playing, so XOR correction cannot be made here, otherwise the direction will be flipped one more time (the
    // mirror will face right and the person will go left).
    const dir = this.facing === 'right' ? 1 : -1;
    const W = VIEW.w;
    const H = VIEW.h;
    const distScale = this.size / S.PET_REF_WIDTH;
    const cx = this.currentCenterX();
    const cy = this.currentCenterY();
    // The landing point is determined by the monitor: the default is union (can cross the screen across the seam, but
    // cannot enter the hole in the outer rectangle). When confineToScreen is turned on, only the part of the screen
    // where the pet is currently is judged. The screen seams and holes are used as walls, and the step beyond the
    // boundary is directly canceled. Throwing is a frame-by-frame physical boundary, and roaming is a one-time landing
    // point planning without rebound semantics; when a pet falls into a hole, resolveRect takes the nearest screen and
    // can still move.
    const wanderArea = this.confineToScreen ? S.resolveRect(AREAS, cx, cy) : null;
    const plan = S.planMove({
      cx,
      cy,
      W,
      H,
      dir,
      minDist: mp.minDist * distScale,
      maxDist: mp.maxDist * distScale,
      margin: mp.margin, // Same as position() for marginX/marginY: configuration value is no longer multiplied by scale
      halfW: this.halfW,
      sideAllow: this.sideAllow,
      areas: wanderArea ? [wanderArea] : AREAS,
    });
    if (!plan) return false;
    this.pendingMove = { ...plan, dir, leadSec: mp.leadSec, tailSec: mp.tailSec };
    this.switchTo(chosen.name, true, playbackId);
    return chosen.name;
  },
});
