/**
 * Event linkage of desktop Helper: balance, whisper, third-party playback request and work status display and polling.
 *
 * The display and tick callback are hung on PetSprite.prototype, which must be loaded after sprite.js (the top-level
 * prototype is rewritten); startLoops is the only entry point for all polling, and is called after boot is successful.
 * Not responsible for animation playback and bubble rendering itself (see sprite.js). Depends on constants.js /
 * sprite.js.
 *
 * @module dsh-pet/runtime/electron-helper/events
 */
'use strict';

// Work-state integration: poll /state every second and advance tick only when counter changes; each pet respects
// workStatusEnabled.
// thinking/working/result/waiting bubbles remain until the state changes; success/error dismiss after 10 seconds, and
// null clears the bubble.
// Loop active-state animations. Play terminal states once before returning to idle; when becoming idle, let the
// current loop finish once and stop.
PetSprite.prototype.onWorkTick = function onWorkTick(snapshot, tick) {
  if (!this.pet.workStatusEnabled) return; // Working status linkage is not enabled -> The pet is completely immune (consistent with the browser)
  if (tick === 0 || tick === this.prevWorkTick) return;
  this.prevWorkTick = tick;
  // Occupying the lock: When the lock is in effect, it does not respond to the working status - it is an automatic
  // source (task event driven), and there is no "user manual request" path. Judgment after consumption of tick: When
  // the changes during the occupation period have passed, the current state will be realigned by applyFreeze when
  // unfreezing. The host side does not block this global segment: sections.workStatus is shared by all pets. Skipping
  // writing will also mute other pets.
  if (this.frozen) return;
  const state = snapshot && snapshot.state ? snapshot.state : null;
  this.workState = state; // Current working status: The interactive/event animation is restored and used in cycle. The session to which the
  // current display item belongs: Click bubble to jump to use it. The external slot (`api`) host has been written as
  // null, and only non-empty strings are recognized here.
  this.workSessionId =
    snapshot && typeof snapshot.sessionId === 'string' && snapshot.sessionId ? snapshot.sessionId : null;
  const stateChanged = this.prevWorkState !== state;
  this.prevWorkState = state;
  if (!state) {
    // Back to idle: Change the ongoing animation that is being played in a loop to "stop after playing". When walking
    // in the middle state, switchTo ( name , false ) ( loop = true ), ended will not be triggered normally; if the
    // animation is not cut here, the chain will not get the propulsion signal, and the pet will be stuck on that
    // working animation. Only change the current segment: after it ends go handleEnded → playIdle. The foreground
    // section during sleep is a sleeping posture loop: changing it to loop/onended will not only interrupt the
    // sleeping posture but also pull the random chain back and skip it.
    if (!this.sleeping && S.poolIncludes(this.animations.events?.workStatus ?? [], this.anim)) {
      const frontEl = this.front === 0 ? this.videoA : this.videoB;
      if (frontEl) {
        frontEl.loop = false;
        frontEl.onended = () => this.handleEnded();
      }
    }
    // Idle: close the resident bubble
    if (this.workTimer !== null) window.clearTimeout(this.workTimer);
    this.workTimer = null;
    this.workOn = false;
    this.workText = null;
    this.workSessionId = null;
    this.renderBubble();
    return;
  }
  const pool = this.animations.events?.workStatus;
  if (!pool || pool.length === 0) {
    console.error('[dsh-pet] Missing animations.events.workStatus; work-state animations are unavailable');
    return;
  }
  const idx = S.WORK_STATUS_INDEX[state];
  const slot = pool[idx];
  if (slot === undefined) {
    console.error('[dsh-pet] work-status band index out of range: state=' + state + ' idx=' + idx);
    return;
  }
  const name = S.pickSlot(slot, this.anim); // Randomly select 1 from the array slot to avoid the currently playing animation (consistent with the browser)
  console.log(
    '[dsh-pet] ' +
      new Date().toTimeString().slice(0, 8) +
      ' workStatus pet=' +
      this.pet.id +
      ' state=' +
      state +
      ' -> [' +
      idx +
      '] ' +
      name,
  );
  this.stopMove();
  // bubble text: task details take priority, otherwise a sentence will be randomly selected from the entry level workStatusTexts [state]; if the entire frame is missing, only the animation will be played.
  const textGroup = Array.isArray(this.pet.workStatusTexts) ? this.pet.workStatusTexts[idx] : undefined;
  const configuredText =
    Array.isArray(textGroup) && textGroup.length > 0
      ? textGroup[Math.floor(Math.random() * textGroup.length)]
      : undefined;
  this.workText = (snapshot && snapshot.task) || configuredText || null;
  const terminal = state === 'success' || state === 'error';
  // Update bubble visibility only when the state changes. Repeated ticks in the same terminal state must not reopen a bubble dismissed by its timeout.
  if (stateChanged) {
    this.workOn = true;
    if (this.workTimer !== null) window.clearTimeout(this.workTimer);
    this.workTimer = terminal
      ? window.setTimeout(() => {
          this.workOn = false;
          this.renderBubble();
        }, BUBBLE_DURATION_MS)
      : null; // Non-final state: permanent, no automatic folding
  }
  this.renderBubble();
  // Sleep: bubble and workState have been updated, the animation does not change - the automatic source should not interrupt the sleeping posture (sleeping posture cycle returns to the sleep state machine).
  if (this.sleeping) return;
  // Loop semantics: The final state is broadcast once and returns to idle; the non-final state multiple candidate
  // states are broadcast once → ended and rotates to the next candidate; the non-final state single candidate state is
  // looped infinitely.
  const rotating = !terminal && Array.isArray(slot) && slot.length > 1;
  if (terminal || rotating) this.playOnce(name);
  else this.switchTo(name, false); // Loop playback in progress (single animation/single candidate position)
};

// Click the work bubble: send the intention of "cutting to this session", and then ask the main process to bring the
// DSH main window to the foreground. To bring up the window, you must go to dsh:// of the main process (the same path
// as right-clicking "Open Software"): iframe on the side of the page cannot call up the blocked window. Desktop Pet is
// an independent rendering process and a session service that cannot get the page. The cross-process jump can only be
// transferred through the host (for the contract, see openapi / focus-session).
PetSprite.prototype.openWorkSession = function openWorkSession() {
  const sessionId = this.workSessionId;
  if (!sessionId) return;
  S.postAction(FOCUS_SESSION_URL, { sessionId }).then((ok) => {
    if (!ok) console.warn('[dsh-pet] Session focus request rejected by host pet=' + this.pet.id);
  });
  if (window.petBridge && typeof window.petBridge.focusDshHost === 'function') {
    window.petBridge.focusDshHost();
  }
};

// Balance event: automatic polling by balanceEnabled gating, manual request unconditional.
// manual = This refresh is requested by the user (right-click "View Balance"/`/balance` command): No matter the
// switch, a reply will be given.
PetSprite.prototype.onBalanceTick = function onBalanceTick(state, tick, manual) {
  if (!this.pet.balanceEnabled && !manual) return; // Automatic polling is subject to gating switch; manual pass is passed unconditionally (consistent with the browser)
  if (tick === 0 || tick === this.prevTick) return;
  this.prevTick = tick;
  // Occupying the lock: When the lock takes effect, the automatic balance is not looked at (that is the pet's own
  // behavior), and manual requests are made as usual (user interaction takes precedence). Judgment after tick
  // consumption: During the occupation period, this beat will be regarded as past and will not be replayed after
  // unfreezing (the event is instantaneous).
  if (this.frozen && !manual) return;
  this.showBalanceNow(state, manual);
};

// The balance is unavailable (the service provider is not registered/the certificate is missing/the capture failed):
// only the text description bubble will be played, and the state animation will not be played. The appearance, timing
// and success path are the same; no stopMove - there is no animation to take the foreground this time. gating:
// Automatic polling requires balanceEnabled, manual request for unconditional bombing (including "service provider
// does not support"). Sleeping is a veto: the same conventions as the state animation, manual request will not
// interrupt the sleeping position.
PetSprite.prototype.showBalanceNotice = function showBalanceNotice(state, manual) {
  if (!this.pet.balanceEnabled && !manual) return; // Automatic polling is subject to switch gating; manual pass is passed unconditionally
  if (this.frozen && !manual) return; // Occupied lock: Do not look at the automatic source; manual as usual (the user must have a reply when asked)
  if (this.sleeping) return; // Can’t play while sleeping: sleeping position takes precedence over balance description
  if (!state || state.ok) return;
  this.bubbleOn = true;
  this.balanceWrap = true; // The text description may have multiple lines: renderBubble applies the compact variant accordingly (the font size is reduced to 0.75, and the lower limit of the width is narrower)
  this.balanceView = S.balanceBubbleView(state);
  this.balanceState = state; // Keep: The unavailable state cannot be expanded, but it is necessary to prevent the last balance reading from remaining in the field.
  this.balanceViewIndex = 0; // There is only one page of text description (the number of pages is calculated from balancePageCount to state)
  this.renderBubble();
  if (this.bubbleTimer !== null) window.clearTimeout(this.bubbleTimer);
  this.bubbleTimer = window.setTimeout(() => {
    this.bubbleOn = false;
    this.renderBubble();
  }, BUBBLE_DURATION_MS);
};

// whisper / command bubble / conversation reply / clear go through the same channel: pets .< id >. say are all written
// into S, and are uniformly polled by / state and distributed to the corresponding pets (see applySayLeaf) - only one
// pet is installed in this window, just press id to hit it.

// Advance the speech bubble closing plan and reschedule the timer: it hangs during speech synthesis and leaves a short
// tail after playing. The plan and constants are in shared/bubble-hold and share the same copy with the browser (the
// behavior of both ends cannot drift independently).
PetSprite.prototype.applyWhisperHold = function applyWhisperHold(event) {
  const next = S.reduceBubbleHold(this.whisperHold, event);
  if (next === this.whisperHold) return; // Same reference = nothing happens, no need to reset the timer
  this.whisperHold = next;
  this.whisperOn = next.on;
  if (this.whisperTimer !== null) window.clearTimeout(this.whisperTimer);
  this.whisperTimer = null;
  if (next.delayMs !== null) {
    this.whisperTimer = window.setTimeout(() => {
      this.whisperTimer = null;
      this.applyWhisperHold({ kind: 'hide' });
    }, next.delayMs);
  }
  this.renderBubble();
};

// Close the speech bubble (the placement point of POST /bubble/clear). Only move the bubble: the currently playing
// animation, balance bubble, and working status bubble will not be touched - the bubble and the action are two locks
// that are released separately. The same semantics as clearWhisperBubble on the browser side.
PetSprite.prototype.clearWhisper = function clearWhisper() {
  this.whisperText = '';
  this.whisperView = null;
  this.whisperImage = '';
  this.whisperUrl = '';
  this.applyWhisperHold({ kind: 'clear' });
};

// Whisper display (this pet): Randomly draw events.whisper animation + pop text bubble (the same set of timing
// semantics as the balance). image is the picture name randomly selected by host; url is the complete address provided
// by the third party: choose one of the two (guaranteed by the host decision layer), distinguished by field names and
// not relying on sniffing. When anim === false, the entire animation linkage is skipped (no pool checking, no source
// change, no stopMove), so when events.whisper is missing, just playing bubbles also works. duration === 0 means that
// this item will not be displayed and the current bubble will not move (to close it, please use POST /bubble/clear,
// the two things do not overlap).
PetSprite.prototype.showWhisper = function showWhisper(text, image, url, duration, anim) {
  let name = null;
  if (anim !== false) {
    const pool = this.animations.events?.whisper;
    if (!pool || pool.length === 0) {
      console.error('[dsh-pet] Missing animations.events.whisper; whisper animations are unavailable');
      return;
    }
    // 1 slot will be randomly selected from the entire pool (avoiding the current live animation to avoid continuous repetition); if the slot is an array candidate, it will be randomly selected within the file (consistent with the browser)
    name = S.pickSlot(S.pick(pool, this.anim), this.anim);
  }
  console.log(
    '[dsh-pet] ' +
      new Date().toTimeString().slice(0, 8) +
      ' whisper pet=' +
      this.pet.id +
      (name === null ? ' (no linked animation)' : ' -> [' + name + ']') +
      ' 「' +
      text +
      '」' +
      (image ? ' [' + image + ']' : ''),
  );
  // Start the animation first: it and the bubble duration are two independent parameters (when duration =0, the
  // animation will still play, but the bubble will not pop). Sleep: the bubble will play (this is how the rejection
  // line comes), and the animation will not change - the automatic source should not interrupt the sleeping posture
  // (the sleeping posture cycle returns to the sleep state machine).
  if (name !== null && !this.sleeping) {
    this.stopMove();
    this.playOnce(name);
  }
  if (duration === 0) return;
  this.whisperView = S.whisperBubbleView({ ok: true, text, ts: 0 });
  this.whisperText = text;
  this.whisperImage = typeof image === 'string' ? image : '';
  this.whisperUrl = typeof url === 'string' ? url : '';
  // The folding time is left to the folding plan: when this sentence is read, the subsequent voice start event will suspend it (see applyWhisperHold).
  this.applyWhisperHold({ durationMs: duration ?? BUBBLE_DURATION_MS, kind: 'show' });
};

// Balance display (bubble + state animation): Periodic polling and menu playback request share the same display path,
// and the visual and behavior are strictly consistent. Bubble popping: manual request for unconditional popping (even
// if balanceEnabled is turned off, even if there is no percentage semantics); automatic polling requires content to be
// displayed, and the custom form does not look at the percentage. The state animation only belongs to pets with balance
// enabled, and must be based on percentages. The click menu to turn off the switch will not work.
PetSprite.prototype.showBalanceNow = function showBalanceNow(state, manual) {
  if (!state || !state.ok) return;
  const p = S.balancePercent(state);
  if (!manual && p === undefined && state.shape !== 'custom') return; // Automatic polling has no percentage semantics: no state basis, no polling (manual still needs to give a reply)
  this.bubbleOn = true;
  this.balanceWrap = false; // Normal balance bubble uses regular size, do not inherit the compact variant of the last text description
  this.balanceView = S.balanceBubbleView(state);
  this.balanceState = state; // The details and usage lines of the page-based calculation window in the expanded state (balanceView are only the two lines in the collapsed state)
  this.balanceViewIndex = 0; // A new round of queries always starts from the first page (consistent with the browser)
  this.renderBubble();
  // bubble 10 s disappears on time (decoupled from animation: even if the animation is interrupted by click/drag, the bubble will be closed on time; if it is triggered repeatedly, the old timer will be cleared first)
  if (this.bubbleTimer !== null) window.clearTimeout(this.bubbleTimer);
  this.bubbleTimer = window.setTimeout(() => {
    this.bubbleOn = false;
    this.renderBubble();
  }, BUBBLE_DURATION_MS);
  // Gear animation: Pets with the switch turned off do not perform; there is no percentage semantics (pure balance
  // amount) and no state to map. Sleeping: the bubble is already on, and the animation does not change - the automatic
  // source should not interrupt the sleeping posture (sleeping posture cycle returns to the sleep state machine).
  if (this.sleeping) return;
  if (!this.pet.balanceEnabled) return;
  if (p === undefined) return;
  const pool = this.animations.events?.balance;
  if (!pool || pool.length === 0) {
    console.error('[dsh-pet] Missing animations.events.balance; balance animations are unavailable');
    return;
  }
  const idx = S.balanceEventIndex(p);
  const slot = pool[idx];
  if (!slot) {
    console.error('[dsh-pet] balance band index out of range: p=' + p + ' idx=' + idx);
    return;
  }
  const name = S.pickSlot(slot, this.anim); // Randomly select 1 from the array slot, and avoid the currently playing animation (to avoid continuous repetition, consistent with the browser)
  this.stopMove();
  this.playOnce(name);
};

// Click balance bubble: switch to the next page (the last page returns to the first page), the number of pages is
// determined by balancePageCount. Fade out → change content → fade in (redraw after 250 ms, otherwise the content will
// be replaced when translucent = hard cut); at the same time, reset the 10 s timer, otherwise there will be only 2
// seconds left after clicking on the 8th second. The hit zone is re-reported by syncInputBusy() at the end of
// renderBubble.
PetSprite.prototype.toggleBalanceDetail = function toggleBalanceDetail() {
  if (!this.balanceClickable()) return;
  this.balanceViewIndex = (this.balanceViewIndex + 1) % this.balancePageCount();
  this.bubble.classList.add('is-fading');
  if (this.balanceFadeTimer !== null) window.clearTimeout(this.balanceFadeTimer);
  this.balanceFadeTimer = window.setTimeout(() => {
    this.balanceFadeTimer = null;
    this.bubble.classList.remove('is-fading');
    this.renderBubble(); // Redraw content + re-report control rectangle (if the expanded state/page change width changes, the rectangle must also change)
  }, BALANCE_FADE_MS);
  if (this.bubbleTimer !== null) window.clearTimeout(this.bubbleTimer);
  this.bubbleTimer = window.setTimeout(() => {
    this.bubbleOn = false;
    this.renderBubble();
  }, BUBBLE_DURATION_MS);
};

// Polling assembly: The container pulls and triggers in a unified manner, using the same path as the browser.

// Balance unavailable → text description bubble (periodic polling and manual/balance share this path, judged at
// shared): explicit (manual trigger) will always pop up; automatic polling will only pop up once when the reason
// (including service provider) changes, to avoid repeatedly flashing the same sentence.
function applyBalanceNotice(state, explicit) {
  const notice = S.decideBalanceNotice(state, balanceNoticeKey, explicit);
  balanceNoticeKey = notice.key;
  if (notice.show) for (const s of sprites) s.showBalanceNotice(state, explicit);
  // The unregistered service provider is a configuration fact (declared by bubble), no more console; other reasons will still report an error explicitly, and the balance will never be forged.
  if (state.reason !== 'unsupported') {
    console.error('[dsh-pet] Balance query failed reason=' + state.reason + (state.message ? ' ' + state.message : ''));
  }
}

// Unified polling (GET /state, long polling): the same data source and rendering entry point as the browser. Each
// leaf = { counter , data }: Only the baseline will be remembered (not rendered) in the first pull, and counter will
// be rendered only after it changes.
let stateBaseline = null;
/** The version number of S in my hand (undefined = first pull, without parameters → get the full amount immediately) */
let stateSince;
/** Does the host support long polling? Response with counter = supported; without = old host (full amount will be returned immediately and must be backed off) */
let stateLongPoll = true;

/** Balance leaf → display (successful playback of state animation + bubble; unavailable, press shared to determine pop-up text description) */
function applyBalanceLeaf(leaf) {
  const hit = S.readBalance(leaf);
  if (!hit) return;
  balance = hit.state;
  window.__dshPetDebug.lastBalanceOk = hit.state && hit.state.ok === true;
  if (hit.state.ok) {
    balanceTick++;
    // No playback will occur while asleep: state animations and bubbles will not be updated, and manual requests are no exception (sleeping position priority)
    for (const s of sprites) if (!s.sleeping) s.onBalanceTick(hit.state, balanceTick, hit.manual);
  } else {
    // Unavailable: manual (requested by the user) will always play, and the periodic refresh will only play once when the reason changes.
    applyBalanceNotice(hit.state, hit.manual);
  }
}

/** Talking leaves → corresponding pets play talking animation + bubble. `kind: 'clear'` = close the bubble, the rest = pop a bubble. */
function applySayLeaf(petId, leaf) {
  const said = S.readSay(leaf);
  if (!said) return;
  for (const s of sprites) {
    if (s.pet.id !== petId) continue;
    if (said.kind === 'clear') {
      s.clearWhisper();
      continue;
    }
    s.showWhisper(said.text, said.image, said.url, said.duration, said.anim);
    // Both sides have their own decisions: desktop will be pronounced only when the leaves are called, and bubbles
    // will be played only when the name is not called or the web page is clicked. It must be kept in a loop filtered
    // by petId: each window receives all leaves (the global counter wakes up all windows). If it is placed outside the
    // loop, windows that do not have this pet will read together. N desktop pets are N voices.
    S.playSayVoice(said);
  }
}

/** Working state leaf → Each pet switches state animation + bubble (including returning to idle: state = null is used to close the resident bubble) */
function applyWorkStatusLeaf(leaf) {
  const snap = S.toWorkStatus(leaf.data);
  if (!snap) return;
  workTick++;
  // Don’t watch or listen when you fall asleep: The working status of the automatic source is skipped entirely (the animation and bubbles are not updated), and the next status change after waking up is realigned.
  for (const s of sprites) if (!s.sleeping) s.onWorkTick(snap, workTick);
}

/**
 * playback request animation leaf → play the animation for the corresponding pet. name reuse the same processing
 * function in the right-click menu (mirror correction, real displacement for mobile types), url is the third-party
 * complete address, and only changes the source once. facing must be assigned to sprite before changing the source -
 * switchTo press it in onReady to paste scaleX (-1). If facing is not given, the current orientation of the pet will
 * be maintained; if it is given, the correction of "forced left facing before text animation playback request" will be
 * skipped.
 */
function applyAnimLeaf(petId, leaf) {
  const hit = S.readAnim(leaf);
  if (!hit) return;
  for (const s of sprites) {
    if (s.pet.id !== petId) continue;
    const explicitFacing = hit.facing !== undefined;
    if (explicitFacing) s.facing = hit.facing; // You must click it to paste scaleX (-1) before changing the source: switchTo
    if (hit.url !== undefined) s.playUrlOnce(hit.url, hit.playbackId);
    else if (hit.name !== undefined)
      s.onMenuAction({ label: hit.name, anim: hit.name, playbackId: hit.playbackId }, explicitFacing, true);
  }
}

/** Position command leaf → corresponding pet moves over; reuse sprite.moveToCenter, only distributes and does not rewrite kinematics. */
function applyPositionLeaf(petId, leaf) {
  const hit = S.readPosition(leaf);
  if (!hit) return;
  for (const s of sprites) {
    if (s.pet.id === petId) s.moveToCenter(hit.x, hit.y, hit.mode, hit.duration);
  }
}

/** Throw command leaves → fly out according to angle/strength; muzzle velocity is converted to shared, and all downstream are existing throwing physics. */
function applyThrowLeaf(petId, leaf) {
  const hit = S.readThrow(leaf);
  if (!hit) return;
  for (const s of sprites) {
    if (s.pet.id === petId) s.throwWith(hit.angle, hit.power);
  }
}

/**
 * Occupying the lock leaf → corresponding to pet freezing/thawing. It is not a command but a status: sprite Press
 * expiresAt to release it regularly, because expiration on the host side is lazy and will not push "lock out".
 */
function applyLockLeaf(petId, leaf) {
  const hit = S.readLock(leaf);
  if (!hit) return;
  for (const s of sprites) {
    if (s.pet.id === petId) s.setLock(hit);
  }
}

/**
 * Sleeping leaf → corresponds to pet sleeping/waking up. It is also a state rather than an instruction: the three
 * segment names are selected by the host. sprite only plays and advances by itself "Start (once) → Loop (infinite) →
 * Get up (once)" - only the renderer knows after the video is played.
 */
function applySleepLeaf(petId, leaf) {
  const data = leaf && leaf.data;
  if (!data || typeof data !== 'object') return;
  let state;
  if (data.sleeping === false) {
    state = { sleeping: false };
  } else if (data.sleeping === true) {
    // sleeping : true but lacks any name = invalid shape: I would rather not sleep (maintain the status quo) than play a non-existent animation
    for (const key of ['start', 'loop', 'end']) {
      if (typeof data[key] !== 'string' || data[key] === '') return;
    }
    state = { sleeping: true, start: data.start, loop: data.loop, end: data.end };
  } else {
    return; // Unknown value (old host/dirty data): skip this beat
  }
  for (const s of sprites) {
    if (s.pet.id === petId) s.setSleep(state);
  }
}

/**
 * Third-party menu snapshot leaf → Inject each pet (the right-click menu spells "more" accordingly). It is the current
 * state, not an event. It is written once when registering and overwriting, and all windows share the same snapshot.
 */
function applyMenuLeaf(leaf) {
  const items = S.readMenuItems(leaf ? leaf.data : null, 'desktop');
  for (const s of sprites) s.menuItems = items;
}

/** Run a beat / state. Return true = hit by long polling (the host supports long polling and can request again immediately). */
async function pollStateOnce() {
  try {
    const s = await S.fetchState(
      STATE_URL,
      stateLongPoll && stateSince !== undefined ? { since: stateSince, timeoutMs: STATE_WAIT_MS } : undefined,
    );
    if (!s) return false;
    // The response with counter = host supports long polling; without = old host (it does not recognize since/timeout
    // and will return the full amount immediately). At this time, the fixed interval polling must be returned,
    // otherwise the cycle will be busy waiting.
    stateLongPoll = typeof s.counter === 'number';
    if (stateLongPoll) stateSince = s.counter;
    if (stateBaseline === null) {
      stateBaseline = S.flattenCounters(s); // First pull: only remember the baseline, not render (to avoid replaying old bubbles during startup/reload) The
      // third-party menu item is a state rather than an event: the first pull must be installed, otherwise helper will have
      // to wait for the next register to appear after restarting
      applyMenuLeaf(s.sections ? s.sections.menu : null);
      // The sleeping state is also the same: helper After restarting/reloading the configuration, the host still
      // remembers that it is sleeping. You must make up for it here; otherwise, the renderer shows that it is awake,
      // and the host does not write back the leaves because it is "already sleeping". It can only be restored after
      // the host restarts.
      for (const [petId, entry] of Object.entries((s && s.pets) || {})) {
        if (entry && entry.sleep && entry.sleep.data !== null) applySleepLeaf(petId, entry.sleep);
      }
      return true;
    }
    for (const change of S.takeChanged(s, stateBaseline)) {
      if (change.leaf.data === null) continue;
      if (change.path === 'sections.balance') applyBalanceLeaf(change.leaf);
      else if (change.path === 'sections.workStatus') applyWorkStatusLeaf(change.leaf);
      else if (change.path === 'sections.menu') applyMenuLeaf(change.leaf);
      else if (change.path.startsWith('pets.') && change.path.endsWith('.say')) {
        // Pet id is allowed to contain dots: slice by prefix/suffix, never split ('.')
        applySayLeaf(change.path.slice('pets.'.length, -'.say'.length), change.leaf);
      } else if (change.path.startsWith('pets.') && change.path.endsWith('.anim')) {
        // playback request animation: also sliced by prefix/suffix (counter is incremented every time it is written, and will be distributed twice even if clicked twice)
        applyAnimLeaf(change.path.slice('pets.'.length, -'.anim'.length), change.leaf);
      } else if (change.path.startsWith('pets.') && change.path.endsWith('.position')) {
        // Position command: also sliced by prefix/suffix, never split ('.')
        applyPositionLeaf(change.path.slice('pets.'.length, -'.position'.length), change.leaf);
      } else if (change.path.startsWith('pets.') && change.path.endsWith('.throw')) {
        // Throwing command: Same as above
        applyThrowLeaf(change.path.slice('pets.'.length, -'.throw'.length), change.leaf);
      } else if (change.path.startsWith('pets.') && change.path.endsWith('.lock')) {
        // Lock occupied: same slice as above, never split ('.'). It is a state rather than an instruction (see applyLockLeaf )
        applyLockLeaf(change.path.slice('pets.'.length, -'.lock'.length), change.leaf);
      } else if (change.path.startsWith('pets.') && change.path.endsWith('.sleep')) {
        // Sleeping: Ditto for slices. It is a state not an instruction (see applySleepLeaf )
        applySleepLeaf(change.path.slice('pets.'.length, -'.sleep'.length), change.leaf);
      }
    }
    return true;
  } catch {
    /* Lightweight polling fails silently: try again next tick */
    return false;
  }
}

function startLoops() {
  if (loopsStarted) return;
  loopsStarted = true;

  // The bubble is redrawn as soon as the voice status changes: circle → speaker (or return without corner mark) must
  // be reflected immediately, and the bubble cannot be redrawn until the next message. There is no react on the
  // desktop, so you can only rely on subscribe to manually redraw it.
  S.subscribeVoiceState(() => {
    for (const s of sprites) s.renderBubble();
  });

  // The start/end of each voice sentence advances the bubble closing plan: when synthesis is slow, the bubble hangs
  // and is closed after playing. Recognize sentences by text: This window only contains one pet, but the same status
  // is a module singleton, so the sentence recognition will not be blamed on others.
  S.subscribeVoiceUtterance((event) => {
    // The state machine only recognizes hold/release, and the voice message is start/end: the translation and the web page share the same copy, don't write it again.
    const hold = S.utteranceToHold(event);
    for (const s of sprites) if (s.whisperText === event.text) s.applyWhisperHold(hold);
  });

  // Unified polling is a self-scheduled long polling (request → process → request again immediately): the host hangs
  // when the version does not change, 1 request/second when idle, and is received immediately when the leaf changes.
  // This window only holds one pet, so each window runs a copy; the global counter means that any write will wake up
  // all windows (intentional).
  const stateLoop = async () => {
    const hit = await pollStateOnce();
    setTimeout(() => void stateLoop(), hit && stateLongPoll ? 0 : 1000);
  };
  void stateLoop();
}
