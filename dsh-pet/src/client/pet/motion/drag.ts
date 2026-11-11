/**
 * Pointer drag: press state, drag threshold, touch screen long press menu and click interaction. It is not responsible
 * for flight and positioning; the spring follows at ./drag-follow, and the release is settled at ./drag-release.
 * Depends on the current frame capabilities given by PetCard per frame getter: size, animation pool, state setter and
 * stop/start motion. Invariant: after pressing, all position writing will be read and written through the bounding
 * box; the displacement of the stage pad is constant; when you release, you must first stop the spring to follow and
 * then settle the landing point. The mouse release fallback is also here: when the pointer capture is discarded in
 * advance by the browser, mouseup on window uses the same set of cleanup.
 * @module dsh-pet/src/client/pet/motion/drag
 */
import { trimTrail, type DragSample } from '../../../shared/physics.ts';
import { pick } from '../../../shared/pickers.ts';
import { clickScore, mountScorePopup, SCORE_MIN_SPEED, spawnScoreBurst } from '../../../shared/score-popup.ts';
import { DRAG_THRESHOLD, SLINGSHOT_DOUBLE_MS } from '../../../shared/constants.ts';
import { createDragFollow } from './drag-follow.ts';
import { createTouchPress } from './touch-press.ts';
import { decideRelease } from './drag-release.ts';
import type { BoxPoint } from './geometry.ts';
import type { PhysicsParams } from '../../../shared/types.ts';
import type * as ReactNS from 'react';

/** The state of pointer press: threshold judgment, slingshot and long press each occupy several fields. */
interface PressState {
  /** Pressed. */
  active: boolean;
  /** Drag threshold exceeded. */
  dragging: boolean;
  /** Press point (px). */
  sx: number;
  /** Press point (px). */
  sy: number;
  /** The offset of the pressed point to the center of the pet (px). */
  offX: number;
  /** The offset of the pressed point to the center of the pet (px). */
  offY: number;
  /** The drag force is calculated based on the drag distance. */
  sling: boolean;
  /** Pet center when pressed X (px). */
  anchorX: number;
  /** Pet center when pressed Y (px). */
  anchorY: number;
}

/** The scene of a let go: React event is converted to it at the entry point, and the cleanup logic only recognizes it here. */
interface ReleasePoint {
  /** Pointer abscissa coordinate (px). */
  x: number;
  /** Pointer ordinate (px). */
  y: number;
  /** Hit area node: Use it to pick drag and drop classes and determine the placement point of prompts. */
  hit: HTMLDivElement;
}

/** The drag driver takes the current frame capability each time it handles an event. */
export interface DragCard {
  /** This pet is id, used for logs. */
  petId: string;
  /** Pet width (px). */
  size: number;
  /** Box half width (px). */
  halfW: number;
  /** Box half height (px). */
  halfH: number;
  /** The physical parameters of this pet. */
  physics: PhysicsParams;
  /** Drag animation pool. */
  dragAnims: string[];
  /** Click on the animation pool. */
  clickAnims: string[];
  /** Standby animation pool. */
  idleAnims: string[];
  /** The name of the current animation, used to avoid yourself when on standby. */
  currentAnim: string;
  /** Change the source once. */
  setOnce: (on: boolean) => void;
  /** Change to the specified animation. */
  playAnim: (anim: string) => void;
  /** Increment the source sequence number and force switchTo to go through it again. */
  bumpSeq: () => void;
  /** Mark "Wait for the new first frame to be in place before pressing the Q bullet". */
  markSquash: () => void;
  /** Restore non-final state work cycle; returning false means there is no recoverable state. */
  resumeWork: () => boolean;
  /** Stop-and-go position and position following. */
  stopAutonomy: () => void;
  /** Grounded. */
  stopFlight: () => void;
  /** Take off. */
  startFlight: (px: number, py: number, vx: number, vy: number) => void;
  /** Is this card frozen by the occupation lock? */
  isFrozen: () => boolean;
  /** Local unfreeze and release host lock. */
  releaseLock: () => void;
  /** The flight speed at the moment of grabbing; when not flying, it is null. */
  grabVelocity: () => { vx: number; vy: number } | null;
  /** Click sound effects. */
  playClickSound: () => void;
  /** Whether the floating prompt is lit. */
  tipOn: () => boolean;
  /** Place the prompt next to the cursor. */
  placeTip: (x: number, y: number) => void;
  /** Switch the prompt between visible and hidden. */
  setTipOn: (on: boolean) => void;
  /** Root element. */
  root: () => HTMLDivElement | null;
  /** Current bounding box position. */
  box: () => BoxPoint | null;
  /** Write back bounding box position. */
  setBox: (box: BoxPoint) => void;
  /** Put down in place: submit the normalized center after clamping. */
  commitPlace: (box: BoxPoint) => void;
}

/** The external read and write surface of the drag driver. */
export interface Drag {
  /** Press: Handles points, drag and slingshot, and turns on pointer capture. */
  onPointerDown(e: ReactNS.PointerEvent<HTMLDivElement>): void;
  /** Mobile: Updated hover tips, drag thresholds and spring targets. */
  onPointerMove(e: ReactNS.PointerEvent<HTMLDivElement>): void;
  /** Release and Cancel: Resets the drag or throw and resets the hover prompt. */
  onPointerUp(e: ReactNS.PointerEvent<HTMLDivElement>): void;
  /** Click: Play the click animation and trigger the Q bomb. */
  onClick(): void;
  /** Stop spring following and do not touch the pointer capture state. */
  stopFollow(): void;
  /** Remove the mouse and release fallback monitoring; called when unmounting, after which this driver cannot be used again. */
  dispose(): void;
  /** Whether the pointer is pressed (including whether the drag threshold has not been exceeded). */
  isActive(): boolean;
  /** Whether it has just finished dragging: it is true within the short window after letting go, and the right-click menu should ignore this period. */
  justDragged(): boolean;
}

/** Reset pressed state: avoid writing a literal per instance. */
const IDLE_PRESS: PressState = {
  active: false,
  dragging: false,
  sx: 0,
  sy: 0,
  offX: 0,
  offY: 0,
  sling: false,
  anchorX: 0,
  anchorY: 0,
};

/** The pointer events within this period after letting go are regarded as the tail of the same drag (ms). */
const JUST_DRAGGED_MS = 100;

/** Time prefix for log lines. */
const stamp = (): string => new Date().toTimeString().slice(0, 8);

/** A line of logs with time and pet id: The client unifies the prefix to facilitate pressing pet grep. */
const log = (petId: string, message: string): void => {
  console.log('[dsh-pet] ' + stamp() + ' pet=' + petId + ' ' + message);
};

/**
 * Record one line of speed at the moment of grabbing, and score if the hand speed is fast enough.
 *
 * @param current - when frame capability.
 * @param x - The abscissa of the pointer ( px ), where the score pops up.
 * @param y - pointer ordinate (px).
 * Whether @returns has a score; the caller will use this to prevent subsequent click from playing ordinary click
 * animations.
 */
function noteGrab(current: DragCard, x: number, y: number): boolean {
  const grab = current.grabVelocity();
  const speed = grab ? Math.hypot(grab.vx, grab.vy) : 0;
  log(
    current.petId,
    'grab vx=' +
      (grab ? Math.round(grab.vx) : 0) +
      ' vy=' +
      (grab ? Math.round(grab.vy) : 0) +
      ' |v|=' +
      Math.round(speed),
  );
  if (speed < SCORE_MIN_SPEED) return false;
  const score = clickScore(speed, current.size);
  log(current.petId, 'click-score speed=' + Math.round(speed) + ' size=' + current.size + ' -> +' + score);
  spawnScoreBurst(x, y);
  mountScorePopup({ x, y, score, speed, size: current.size });
  return true;
}

/**
 * Build a drag driver.
 *
 * @param card - Get the getter of the current frame capability; called once for each event processing.
 * @returns Recallable driver; pointer state is retained across renders within the instance.
 */
export function createDrag(card: () => DragCard): Drag {
  let press: PressState = { ...IDLE_PRESS };
  /** The deadline of the "just finished dragging" window (ms); use time instead of timer, and judge when reading, leaving one less handle to be cleaned. */
  let justDraggedUntil = 0;
  let pressScoreFired = false;
  let lastPressAt = 0;
  /** Pointer trajectory sampling for muzzle velocity estimation. */
  let trail: DragSample[] = [];
  const follow = createDragFollow({ card });
  // The pointer capture may be discarded by the browser before the mouse is released. At that time, the real pointerup
  // falls on other elements, and the drag will be stuck in the pressed state. Only hang a window level mouseup
  // fallback while the mouse is pressed, follow the same set of cleanup according to the current coordinates, and do
  // not forge pointerup events.
  let mousePressHit: HTMLDivElement | null = null;
  /** Release after loss of capture: The coordinates come from mouseup, and the landing point determination is completely consistent with normal release. */
  function onWindowMouseUp(e: MouseEvent): void {
    const hit = mousePressHit;
    // When the right button or other keys are pressed, it is not counted as being released. Only the time when the left button is completely released is recognized.
    if (!hit || e.button !== 0 || e.buttons !== 0) return;
    endPress(card(), { x: e.clientX, y: e.clientY, hit });
  }
  /** Register the hit area and hang fallback when the mouse is pressed; the test in node does not have window, the avatar is provided by itself. */
  const armMouseFallback = (hit: HTMLDivElement): void => {
    mousePressHit = hit;
    if (typeof window !== 'undefined') window.addEventListener('mouseup', onWindowMouseUp, true);
  };
  const clearMouseFallback = (): void => {
    mousePressHit = null;
    if (typeof window !== 'undefined') window.removeEventListener('mouseup', onWindowMouseUp, true);
  };
  /** Long press on the touch screen: The timing and tolerance are at motion/touch-press.ts. After reaching the point, this press will be treated as the right button. */
  const touchPress = createTouchPress({
    onMenu: (target) => {
      // End this press: neither throwing nor clicking animation will be played when letting go.
      press.active = false;
      pressScoreFired = true;
      if (target.el.hasPointerCapture(target.pointerId)) target.el.releasePointerCapture(target.pointerId);
      log(card().petId, '-> [TOUCH-MENU]');
      // The same entry point as the right mouse button: dispatch contextmenu to the right button for processing.
      target.el.dispatchEvent(
        new MouseEvent('contextmenu', {
          bubbles: true,
          button: 2,
          cancelable: true,
          clientX: target.x,
          clientY: target.y,
          view: window,
        }),
      );
    },
    stillHolding: () => press.active && !press.dragging,
  });

  /**
   * Write down the geometry and slingshot judgment of this press.
   *
   * @param c - when frame capability.
   * @param e - Press event.
   * @returns New pressed state.
   */
  const beginPress = (c: DragCard, e: ReactNS.PointerEvent<HTMLDivElement>): PressState => {
    e.currentTarget.classList.add('dragging');
    e.currentTarget.setPointerCapture(e.pointerId);
    // pointerleave is not triggered during pointer capture, and the prompt will keep running if it is not actively closed.
    c.setTipOn(false);
    const rootEl = c.root();
    let offX = 0;
    let offY = 0;
    if (rootEl) {
      const rr = rootEl.getBoundingClientRect();
      offX = e.clientX - (rr.left + rr.width / 2);
      offY = e.clientY - (rr.top + rr.height / 2);
      c.setBox({ x: rr.left, y: rr.top });
    }
    // The slingshot only compares the interval between two presses, and has nothing to do with how long it was dragged or when it was released.
    const pressNow = performance.now();
    const sling = pressNow - lastPressAt < SLINGSHOT_DOUBLE_MS;
    lastPressAt = sling ? 0 : pressNow; // Clear after hitting, so as not to bounce twice in three consecutive clicks.
    const anchor = c.box();
    return {
      active: true,
      anchorX: anchor ? anchor.x + c.halfW : e.clientX,
      anchorY: anchor ? anchor.y + c.halfH : e.clientY,
      dragging: false,
      offX,
      offY,
      sling,
      sx: e.clientX,
      sy: e.clientY,
    };
  };

  const onPointerDown = (e: ReactNS.PointerEvent<HTMLDivElement>): void => {
    const c = card();
    // Only the left click is recognized: the right click will determine conflict with the menu, and both ends are consistent.
    if (e.button !== 0) return;
    // The user clicks or drags this pet to take over: immediately unfreeze locally and force release the host lock.
    // Unfreezing locally first is to avoid waiting for a round trip; there is indeed a lock at this moment, and
    // optimistic release is safe.
    if (c.isFrozen()) c.releaseLock();
    // Points for grabbing the moment: points will be awarded if the hand speed is fast enough. Then this time click will no longer play the normal click animation.
    pressScoreFired = noteGrab(c, e.clientX, e.clientY);
    // Mid-air grabbing: Stop throwing, roaming and spring following, and start dragging from the current landing point.
    c.stopFlight();
    follow.stop();
    c.stopAutonomy();
    trail = [];
    press = beginPress(c, e);
    clearMouseFallback();
    // pointerup for pen and touch screens will be delivered to the hit area normally; only the mouse requires this fallback.
    if (e.pointerType === 'mouse') armMouseFallback(e.currentTarget);
    touchPress.arm({
      el: e.currentTarget,
      pointerId: e.pointerId,
      pointerType: e.pointerType,
      x: e.clientX,
      y: e.clientY,
    });
  };

  const onPointerMove = (e: ReactNS.PointerEvent<HTMLDivElement>): void => {
    const c = card();
    // Prompt to follow the cursor, must be before dragging and exiting early.
    if (c.tipOn()) c.placeTip(e.clientX, e.clientY);
    if (!press.active) return;
    const dx = e.clientX - press.sx;
    const dy = e.clientY - press.sy;
    // If the finger moves beyond the tolerance after long pressing in the window, it will be cancelled.
    touchPress.move(Math.hypot(dx, dy));
    if (!press.dragging) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      press.dragging = true;
      c.setOnce(true);
      if (c.dragAnims.length) {
        const name = pick(c.dragAnims);
        log(c.petId, '-> [DRAG] ' + name);
        c.playAnim(name);
      }
    }
    // Record the pointer trajectory for muzzle velocity estimation.
    const now = performance.now();
    trail = trimTrail([...trail, { t: now, x: e.clientX, y: e.clientY }], now);
    // The spring target is the upper left corner of the bounding box, and it follows the loop to catch up frame by frame.
    follow.aim({ x: e.clientX - press.offX - c.halfW, y: e.clientY - press.offY - c.halfH });
    const rootEl = c.root();
    if (rootEl) follow.start(rootEl);
  };

  /**
   * Let go and settle: put down on the spot, throw or slingshot.
   *
   * @param c - when frame capability.
   * @param point - Let go at the scene; when the pointer does not keep up, use its coordinate fallback to calculate
   * the landing point.
   */
  const settleRelease = (c: DragCard, point: ReleasePoint): void => {
    // The release position takes the real-time bounding box that the spring follows instead of the pointer target.
    const current = c.box();
    const box = current ?? { x: point.x - press.offX - c.halfW, y: point.y - press.offY - c.halfH };
    const decision = decideRelease({
      anchor: { x: press.anchorX, y: press.anchorY },
      box,
      half: { w: c.halfW, h: c.halfH },
      now: performance.now(),
      physics: c.physics,
      size: c.size,
      sling: press.sling,
      trail,
    });
    trail = [];
    if (decision.kind === 'sling') {
      log(
        c.petId,
        'sling dist=' +
          Math.round(decision.dist) +
          ' power=' +
          decision.power.toFixed(2) +
          ' vx=' +
          Math.round(decision.velocity.vx) +
          ' vy=' +
          Math.round(decision.velocity.vy),
      );
      c.startFlight(box.x, box.y, decision.velocity.vx, decision.velocity.vy);
      return;
    }
    if (decision.kind === 'throw') {
      const { vx, vy } = decision.velocity;
      log(c.petId, 'release vx=' + Math.round(vx) + ' vy=' + Math.round(vy) + ' |v|=' + Math.round(Math.hypot(vx, vy)));
      // During flight, rAF directly writes left/top, and is submitted to the normalization center after finalization.
      c.startFlight(box.x, box.y, vx, vy);
      return;
    }
    // Put it down in place: Clamp to the visible lower limit and submit to the normalized center; the root node position is directly written by commitPlace, without relying on re-rendering.
    c.commitPlace(box);
  };

  /**
   * After letting go, the prompt returns to the cursor and lights up; the pointer remains retracted when it has moved
   * out of the hit zone.
   *
   * @param c - when frame capability.
   * @param point - Let go scene.
   */
  const restoreTip = (c: DragCard, point: ReleasePoint): void => {
    const hitRect = point.hit.getBoundingClientRect();
    const inside =
      point.x >= hitRect.left && point.x <= hitRect.right && point.y >= hitRect.top && point.y <= hitRect.bottom;
    if (!inside) return;
    c.placeTip(point.x, point.y);
    c.setTipOn(true);
  };

  /**
   * The only way to release the cleanup: reset the pressed state, remove the drag and drop class, settle the
   * destination and put the prompt back.
   *
   * @param c - when frame capability.
   * @param point - Release scene; normal pointerup and window mouseup after capture loss are converted into it.
   */
  const endPress = (c: DragCard, point: ReleasePoint): void => {
    clearMouseFallback();
    // pointercancel also takes this path, long press the timer to clear it here.
    touchPress.cancel();
    const wasDragging = press.dragging;
    press.active = false;
    press.dragging = false;
    point.hit.classList.remove('dragging');
    follow.stop();
    if (wasDragging) {
      justDraggedUntil = performance.now() + JUST_DRAGGED_MS;
      // Drag and release: non-final state resumes the work cycle, otherwise it plays once and returns to the random
      // chain after standby. once must be true, otherwise ended will not be triggered and the random chain will not be
      // returned.
      if (!c.resumeWork()) {
        if (c.idleAnims.length) c.playAnim(pick(c.idleAnims, c.currentAnim));
        c.setOnce(true);
      }
      settleRelease(c, point);
    }
    restoreTip(c, point);
  };

  const onPointerUp = (e: ReactNS.PointerEvent<HTMLDivElement>): void => {
    endPress(card(), { x: e.clientX, y: e.clientY, hit: e.currentTarget });
  };

  const onClick = (): void => {
    const c = card();
    if (press.active || press.dragging || performance.now() < justDraggedUntil) return;
    // This press has already triggered points: just close the hand and stop, and no longer play the normal click animation.
    if (pressScoreFired) {
      pressScoreFired = false;
      c.stopFlight();
      c.stopAutonomy();
      return;
    }
    c.stopFlight(); // Click on a flying pet to stop it.
    c.stopAutonomy();
    // Click sound effects are placed after all early exit branches of "no click animation".
    c.playClickSound();
    c.setOnce(true);
    if (!c.clickAnims.length) return;
    const name = pick(c.clickAnims);
    log(c.petId, '-> [CLICK] ' + name);
    c.markSquash(); // Wait for the new click animation to switch to the foreground before pressing the new first frame. When a single
    // animation is clicked, the state remains unchanged and effect will not be replayed; incrementing seq forces switchTo
    // to go through once, and the anti-replication branch is responsible for consuming the Q bullet mark.
    c.bumpSeq();
    c.playAnim(name);
  };

  return {
    isActive: () => press.active,
    justDragged: () => performance.now() < justDraggedUntil,
    onClick,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    stopFollow: follow.stop,
    dispose: clearMouseFallback,
  };
}
