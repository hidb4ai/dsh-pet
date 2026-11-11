/**
 * Touch screen long press: press and hold for a certain period of time and treat this press as a right button. During
 * the timing, the finger moves beyond the tolerance and is canceled. It is not responsible for the right-click menu
 * itself, nor does it touch the drag and click judgment-it only calls back when the point is reached, and dispatches
 * it to the caller. The mouse and pen do not follow this branch. Before starting the table, block it according to the
 * pointer type. Invariant: There is only one timer at the same time; if the pressing is over when the time is reached,
 * the callback will abandon itself.
 * @module dsh-pet/src/client/pet/motion/touch-press
 */
/** How long does it take to press and hold the touch screen to calculate the right button (ms). */
const LONG_PRESS_MS = 500;

/** If the finger moves beyond this distance during timing, it will be canceled (px). */
const SLOP_PX = 8;

/** The scene of a single press: the synthesis event must be dispatched when the point is reached, and the elements, pointers and coordinates must be retained. */
export interface TouchPressTarget {
  /** Element captured when pressed. */
  el: HTMLElement;
  /** Pointer id, used for release capture. */
  pointerId: number;
  /** Pointer type; mouse and pen are ignored directly. */
  pointerType: string;
  /** Pressed viewport abscissa (px). */
  x: number;
  /** Viewport Y coordinate at pointer-down, in pixels. */
  y: number;
}

/** Long press driver dependency. */
export interface TouchPressDeps {
  /** Is the press still valid when the point is reached: false will be returned if the user has let go or has entered dragging. */
  stillHolding(): boolean;
  /** At the point: Treat this press as a right button and dispatch it from the caller. */
  onMenu(target: TouchPressTarget): void;
}

/** Long press driver: one instance per pet. */
export interface TouchPress {
  /** Start table; cancel the old one first if called repeatedly. Mouse and pen are useless. */
  arm(target: TouchPressTarget): void;
  /** The cumulative distance of finger movement (px); if it exceeds the tolerance, it will be cancelled. */
  move(distancePx: number): void;
  /** Release or cancel pressing: clear the timer. */
  cancel(): void;
  /** Whether it is waiting for trigger. */
  isArmed(): boolean;
}

/**
 * Build and hold the driver.
 *
 * @param deps - Validity and callback at the point.
 * @returns is a driver that can start the watch repeatedly; the timer is cleared by this module.
 */
export function createTouchPress(deps: TouchPressDeps): TouchPress {
  /** timer to be triggered; `null` = not waiting. */
  let timer: ReturnType<typeof setTimeout> | null = null;
  /** The scene pressed this time will be handed over to callback when the point is reached. */
  let pending: TouchPressTarget | null = null;

  const cancel = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    pending = null;
  };

  const arm = (target: TouchPressTarget): void => {
    cancel();
    if (target.pointerType === 'mouse' || target.pointerType === 'pen') return;
    pending = target;
    timer = setTimeout(() => {
      timer = null;
      const current = pending;
      pending = null;
      if (current === null || !deps.stillHolding()) return;
      deps.onMenu(current);
    }, LONG_PRESS_MS);
  };

  const move = (distancePx: number): void => {
    if (timer === null) return;
    if (distancePx > SLOP_PX) cancel();
  };

  return { arm, cancel, isArmed: () => timer !== null, move };
}
