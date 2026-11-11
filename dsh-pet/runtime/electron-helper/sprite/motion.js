/**
 * Motion driver: frame loop of drag following, throwing, position command and Q bullet extrusion.
 *
 * PetSprite is defined by sprite.js. This file only adds methods to the prototype and must be loaded afterwards. Each
 * driver only has its own frame handle and generation number; the stop is determined by the caller, not import.
 * @module dsh-pet/runtime/electron-helper/sprite-motion
 */
'use strict';

Object.assign(PetSprite.prototype, {
  startMoveDrive(el) {
    const pm = this.pendingMove;
    if (!pm || this.moveRef !== null) return;
    this.pendingMove = null;
    const { startRatio, startYRatio, targetRatio, leadSec, tailSec } = pm;
    const duration = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : 10.09;
    const travelWindow = Math.max(0.1, duration - leadSec - tailSec);
    const token = ++this.moveToken;
    const W = VIEW.w;
    const H = VIEW.h;
    const step = () => {
      if (this.moveToken !== token) return;
      const t = el.currentTime || 0;
      let ratioX;
      if (t <= leadSec) ratioX = startRatio;
      else if (t >= duration - tailSec) ratioX = targetRatio;
      // Interpolate according to the planned landing point instead of dir × distance: When minDist/maxDist is
      // negative, the sign must be retained, otherwise the plan will go to the left, the drive will go to the right,
      // and then jump back to the original direction after walking.
      else ratioX = startRatio + (targetRatio - startRatio) * ((t - leadSec) / travelWindow);
      // What is moved is the window (the pet bounding box follows); the offset of the body within the window is calculated by sendBounds according to the clamping situation.
      this.sendBounds(ratioX * W - this.halfW, startYRatio * H - this.halfH);
      if (t < duration - tailSec) {
        this.moveRef = requestAnimationFrame(step);
      } else {
        this.moveRef = null;
        this.customPos = { rx: targetRatio, ry: startYRatio };
      }
    };
    this.moveRef = requestAnimationFrame(step);
  },

  stopMove() {
    this.pendingMove = null;
    this.moveToken++;
    if (this.moveRef !== null) {
      cancelAnimationFrame(this.moveRef);
      this.moveRef = null;
    }
    // The position command spring also moves autonomously: it stops when you stop and walk, otherwise the two motion systems will change the window position at the same time.
    this.stopPosFollow();
  },

  // Drag and throw physics (spring hand + throw + gravity rebound)
  stopDragFollow() {
    this.dragFollowToken++;
    if (this.dragFollow !== null) {
      cancelAnimationFrame(this.dragFollow);
      this.dragFollow = null;
    }
    this.dragTarget = null;
    this.dragVel = { vx: 0, vy: 0 };
  },

  /** rAF spring following: the window is over-damped and chases towards the drag target (no longer hard-pasting the pointer), smoothing out high-frequency jitter */
  startDragFollow() {
    if (this.dragFollow !== null) return;
    const token = ++this.dragFollowToken;
    let last = performance.now();
    const step = () => {
      if (this.dragFollowToken !== token) return;
      const target = this.dragTarget;
      if (!target) {
        this.dragFollow = null;
        return;
      }
      const now = performance.now();
      const dt = Math.min((now - last) / 1000, 1 / 30);
      last = now;
      const vel = this.dragVel;
      let x = this.pos.x;
      let y = this.pos.y;
      vel.vx = S.springStep(vel.vx, x, target.x, dt, this.physics.throwPower);
      vel.vy = S.springStep(vel.vy, y, target.y, dt, this.physics.throwPower);
      x += vel.vx * dt;
      y += vel.vy * dt;
      this.sendBounds(x, y); // What is moved is the window (this.pos real-time update); the body offset is calculated uniformly by sendBounds
      this.dragFollow = requestAnimationFrame(step);
    };
    this.dragFollow = requestAnimationFrame(step);
  },

  /**
   * Stop throwing (caught in the air/click menu/freeze at the current landing point when returning home). throwState
   * must be cleared at the same time - otherwise "grab and then gently put it down" will retain the last flight speed,
   * and a stationary pet will be mistakenly judged as flying if clicked.
   */
  stopThrow() {
    this.throwToken++;
    if (this.throwRef !== null) {
      cancelAnimationFrame(this.throwRef);
      this.throwRef = null;
    }
    this.throwState = null;
  },

  /** Throwing drive: gravity + edge rebound + landing friction, write customPos after settling */
  startThrow(px, py, vx, vy) {
    this.stopDragFollow();
    this.stopMove();
    // Boundary = union of workspaces: the hole is a wall, the screen gap is not a wall (bounce across screens remains
    // the same). When confineToScreen is turned on, it is changed to locked. The screen where it is at the moment when
    // you let go will not be retrieved during the flight; when relayout changes the number of screens, it is changed
    // to throwStepRegion and returned to not locked.
    const lockScreen = this.confineToScreen ? S.screenOfBox(this.throwSpaceOf(), px, py) : -1;
    const token = ++this.throwToken;
    let state = { x: px, y: py, vx, vy };
    let last = performance.now();
    let prevGrounded = false; // Landed Q bomb: only triggered once in the air → ground transition frame
    const step = () => {
      if (this.throwToken !== token) return;
      const now = performance.now();
      const dt = (now - last) / 1000;
      last = now;
      const fallingVy = state.vy; // The vertical speed before integration in this frame (positive = falling): that is, the landing impact speed.
      // Retrieve each frame: when the display changes, relayout() will invalidate the cache. res.screen must correspond to
      // this one.
      const sp = this.throwSpaceOf();
      // Subdivision points: The slingshot has no speed limit, and one frame may span hundreds of px; if not
      // disassembled, the landing/rebound frames will be skipped, and Q bullets, ground friction, and atRest judgments
      // will all be missed. Ordinary throwing calculations calculate 1 step, which is the same as single-step
      // integration bit by bit.
      const substeps = S.throwSubsteps(state.vx, state.vy, dt);
      let res = S.throwStepRegion(state, dt / substeps, sp, this.physics, lockScreen);
      for (let i = 1; i < substeps && !res.atRest; i++) {
        res = S.throwStepRegion(res, dt / substeps, sp, this.physics, lockScreen);
      }
      state = { x: res.x, y: res.y, vx: res.vx, vy: res.vy };
      this.throwState = state;
      // Collision between pets (only enabled for petCollision): When flying, you hit other pets → the momentum bounces away
      if (this.physics && this.physics.petCollision) {
        const myBody = S.bodyPixelBox({ x: state.x, y: state.y, size: this.size, bottomPad: this.bottomPad });
        for (const pid of Object.keys(this.others)) {
          const o = this.others[pid];
          if (!o || !o.size) continue;
          const otherBody = S.bodyPixelBox({ x: o.x, y: o.y, size: o.size, bottomPad: o.bottomPad });
          if (!S.rectsOverlap(myBody, otherBody)) continue;
          const hit = S.collidePet(
            { x: state.x, y: state.y, vx: state.vx, vy: state.vy, size: this.size },
            { x: o.x, y: o.y, vx: o.vx, vy: o.vy, size: o.size },
          );
          if (hit) {
            // Flying side: continue to bounce according to the momentum result; hit side: main process forwarded to the target window → target window startThrow
            state.vx = hit.fvx;
            state.vy = hit.fvy;
            this.throwState = state;
            if (window.petBridge && window.petBridge.reportCollide) {
              // The initial velocity of the hit party is broker. Physical pixel protocol: × scale
              window.petBridge.reportCollide(pid, toScreen(hit.hvx), toScreen(hit.hvy));
            }
            break; // Only handle one collision per frame (to avoid chain trigger jitter)
          }
        }
      }
      this.sendBounds(res.x, res.y);
      // Landed Q bomb: It is only triggered once in the air → ground transition frame, and the strength depends on the impact speed; "ground" is the bottom edge of the current screen.
      const curBounds = sp.bounds[res.screen] || sp.bounds[0];
      const grounded = curBounds ? res.y >= curBounds.maxY - 1 : false;
      if (res.bounced && grounded && !prevGrounded) {
        const frontEl = this.front === 0 ? this.videoA : this.videoB;
        this.startSquash(frontEl, S.landingSquash(fallingVy));
      }
      prevGrounded = grounded;
      if (res.atRest) {
        this.throwRef = null;
        this.throwState = null;
        this.customPos = { rx: (this.pos.x + this.halfW) / VIEW.w, ry: (this.pos.y + this.halfH) / VIEW.h };
        window.__dshPetDebug.lastDragRelease = { x: this.pos.x, y: this.pos.y };
        return;
      }
      this.throwRef = requestAnimationFrame(step);
    };
    this.throwRef = requestAnimationFrame(step);
  },

  // Position/throw command (POST/position, POST/throw)
  stopPosFollow() {
    this.posFollowToken++;
    if (this.posFollow !== null) {
      cancelAnimationFrame(this.posFollow);
      this.posFollow = null;
    }
  },

  /**
   * Position command: Move the pet center to the normalized coordinates (rx, ry), which has the same semantics as
   * customPos. mode Choose one of three: instant reaches one frame; spring walks through the damping spring; line
   * completes the straight line in duration milliseconds (duration <= 0 is equivalent to instant). Silently discard
   * for the entire duration while the user is holding down the pet - things under their fingers should not escape. The
   * normalized space is the bounding rectangle of the union of workspaces, and the drop point will be clamped to the
   * AREAS union (the hole is unreachable).
   */
  moveToCenter(rx, ry, mode, duration) {
    if (this.dragState.active) return; // User interaction priority
    this.stopThrow(); // Explicit takeover first: stop flying and walking (stopMove stops the last position following by the way)
    this.stopMove();
    // The normalized space is an enclosing rectangle, and the irregular layout contains large holes; the customPos
    // branch of position() has zero clamping. If not clamped, the coordinates falling into the hole will put the pet
    // into an invisible place. The reason why the mouse cannot be dragged there is not because the code is blocking
    // it, but because the cursor cannot physically leave the screen - the position interface must make up for this
    // guard by itself: clamp the center of the body to the union of AREAS.
    const c = S.clampPointToRegion(AREAS, rx * VIEW.w, ry * VIEW.h);
    // The clipped ratio is the value to be written into customPos: position() will recalculate the window position according to it.
    const fx = c.x / VIEW.w;
    const fy = c.y / VIEW.h;
    const px = c.x - this.halfW;
    const py = c.y - this.halfH;
    if (mode === 'instant' || (mode === 'line' && duration <= 0)) {
      this.sendBounds(px, py);
      this.customPos = { rx: fx, ry: fy };
      return;
    }
    const token = ++this.posFollowToken;
    if (mode === 'line') {
      // Line tweening: interpolation in pixel space - interpolation according to the normalized ratio will distort the diagonal line (the enclosing rectangle is not a square)
      const fromX = this.pos.x;
      const fromY = this.pos.y;
      const t0 = performance.now();
      const step = () => {
        if (this.posFollowToken !== token) return;
        const p = Math.min((performance.now() - t0) / duration, 1);
        if (p >= 1) {
          // Accurate positioning: no residual deviation is left at the end point (the spring one depends on the convergence threshold cleanup, this one depends on p to 1)
          this.posFollow = null;
          this.sendBounds(px, py);
          this.customPos = { rx: fx, ry: fy };
          return;
        }
        this.sendBounds(fromX + (px - fromX) * p, fromY + (py - fromY) * p);
        this.posFollow = requestAnimationFrame(step);
      };
      this.posFollow = requestAnimationFrame(step);
      return;
    }
    // spring: Over-damped spring following - no travel time, rely on convergence to determine its own cleanup
    let last = performance.now();
    const vel = { vx: 0, vy: 0 };
    const step = () => {
      if (this.posFollowToken !== token) return;
      const now = performance.now();
      const dt = Math.min((now - last) / 1000, 1 / 30);
      last = now;
      let x = this.pos.x;
      let y = this.pos.y;
      vel.vx = S.springStep(vel.vx, x, px, dt, this.physics.throwPower);
      vel.vy = S.springStep(vel.vy, y, py, dt, this.physics.throwPower);
      x += vel.vx * dt;
      y += vel.vy * dt;
      this.sendBounds(x, y);
      // Convergence judgment: close enough and slow enough → accurately position and submit. The dragging is ended by letting go of the pointer. You have to judge this by yourself.
      if (Math.abs(px - x) < 0.5 && Math.abs(py - y) < 0.5 && Math.abs(vel.vx) < 1 && Math.abs(vel.vy) < 1) {
        this.posFollow = null;
        this.sendBounds(px, py);
        this.customPos = { rx: fx, ry: fy };
        return;
      }
      this.posFollow = requestAnimationFrame(step);
    };
    this.posFollow = requestAnimationFrame(step);
  },

  /**
   * Throwing command: Angle (degree, 0 = positive right, counterclockwise is positive) + force multiplier → initial
   * velocity, handed to startThrow; downstream gravity/rebound/friction/landing Q bomb/cross-window collision are all
   * existing behaviors.
   */
  throwWith(angleDeg, power) {
    if (this.dragState.active) return; // User interaction priority
    const v = S.throwVelocity(angleDeg, power);
    this.startThrow(this.pos.x, this.pos.y, v.vx, v.vy);
  },

  /** Being hit callback (cross-window collision broker forward): Stop the current action and throw it from the landing point with a new initial velocity (all reuse existing physics) */
  onDeskHit(vx, vy) {
    this.stopMove();
    this.stopDragFollow();
    this.stopThrow();
    this.startThrow(this.pos.x, this.pos.y, vx, vy);
  },

  /**
   * Q spring extrusion: the front video is vertically flattened (anchored to the ground and then rebounded), and the
   * curve is at shared. depth = Pressure amplitude (fixed at 0.55 when clicked, dynamically determined according to
   * the impact speed when landing); skipped when reduce-motion.
   */
  startSquash(el, depth = S.SQ_SQUASH) {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const token = ++this.squashToken;
    if (this.squashRef !== null) cancelAnimationFrame(this.squashRef);
    const origin = el.style.transformOrigin;
    el.style.transformOrigin = 'bottom';
    const t0 = performance.now();
    const step = () => {
      if (this.squashToken !== token) return;
      const u = Math.min((performance.now() - t0) / S.SQ_DURATION_MS, 1);
      const scale = S.squashScale(u, depth);
      el.style.transform = (this.facing === 'right' ? 'scaleX(-1) ' : '') + 'scaleY(' + scale + ')';
      if (u < 1) {
        this.squashRef = requestAnimationFrame(step);
      } else {
        this.squashRef = null;
        el.style.transformOrigin = origin;
        // Restore pure mirroring (if switchTo has reset transform during the period, the mirroring shall prevail)
        el.style.transform = this.facing === 'right' ? 'scaleX(-1)' : '';
      }
    };
    this.squashRef = requestAnimationFrame(step);
  },

  stopSquash() {
    this.squashToken++;
    if (this.squashRef !== null) {
      cancelAnimationFrame(this.squashRef);
      this.squashRef = null;
    }
  },

  // Click vs and drag (threshold/grab offset/release back to loop standby; the window is moved)
});
