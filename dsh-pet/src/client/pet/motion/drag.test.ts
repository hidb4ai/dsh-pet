/**
 * Contract test of pointer drag (src/client/pet/motion/drag.ts): pressed state and drag threshold, three directions of
 * release (drop/throw/slingshot), click interaction and "just finished dragging" ignore window, local unfreezing when
 * frozen. Driven with fake DOM elements, fake pointer events, and fake rAF, the assertion falls on the logged
 * callback.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_PHYSICS } from '../../../shared/physics/constants.ts';
import { createDrag, type DragCard } from './drag.ts';

/** Fake root element: only a few methods used for dragging are left. */
function fakeEl() {
  const classes = new Set<string>();
  return {
    classList: {
      add: (name: string) => classes.add(name),
      remove: (name: string) => classes.delete(name),
    },
    hasClass: (name: string) => classes.has(name),
    setPointerCapture: () => {},
    releasePointerCapture: () => {},
    hasPointerCapture: () => true,
    dispatchEvent: () => true,
    style: { transform: '' },
    /** Box 200×112.5, upper left corner (400, 300). */
    getBoundingClientRect: () => ({ left: 400, top: 300, right: 600, bottom: 412.5, width: 200, height: 112.5 }),
  };
}

/** Create a pointer event; only the fields read by the processor are required. */
function pointer(el: ReturnType<typeof fakeEl>, x: number, y: number, button = 0, pointerType = 'mouse') {
  return {
    button,
    pointerId: 1,
    pointerType,
    clientX: x,
    clientY: y,
    currentTarget: el as unknown as HTMLDivElement,
  } as unknown as React.PointerEvent<HTMLDivElement>;
}

/** False window: Only the mouseup listener is accepted, used to simulate the release of the only arrival after the pointer capture is lost. */
function withFakeWindow() {
  const scope = globalThis as { window?: unknown };
  const previous = scope.window;
  const listeners = new Set<(e: MouseEvent) => void>();
  scope.window = {
    addEventListener: (type: string, fn: (e: MouseEvent) => void) => {
      if (type === 'mouseup') listeners.add(fn);
    },
    removeEventListener: (type: string, fn: (e: MouseEvent) => void) => {
      if (type === 'mouseup') listeners.delete(fn);
    },
  };
  return {
    /** Number of mouseup monitors still hanging. */
    get count(): number {
      return listeners.size;
    },
    /** Distribute mouseup once; the default is to release the left button completely. */
    mouseUp(x: number, y: number, init: { button?: number; buttons?: number } = {}): void {
      const event = { button: init.button ?? 0, buttons: init.buttons ?? 0, clientX: x, clientY: y } as MouseEvent;
      for (const fn of [...listeners]) fn(event);
    },
    restore(): void {
      scope.window = previous;
    },
  };
}

/** There is no MouseEvent in node: long pressing the menu will construct a contextmenu, which is supported by the smallest avatar. */
function withFakeMouseEvent() {
  const scope = globalThis as { MouseEvent?: unknown };
  const previous = scope.MouseEvent;
  scope.MouseEvent = class {
    type: string;
    constructor(type: string) {
      this.type = type;
    }
  };
  return {
    restore: (): void => {
      scope.MouseEvent = previous;
    },
  };
}

/** False clock + false rAF. */
function withFakeFrames() {
  const previousRaf = globalThis.requestAnimationFrame;
  const previousCancel = globalThis.cancelAnimationFrame;
  const previousNow = performance.now;
  let now = 100000;
  let pending: Array<{ id: number; cb: () => void }> = [];
  let seq = 0;
  (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = (cb: () => void) => {
    const id = ++seq;
    pending.push({ id, cb });
    return id;
  };
  (globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame = (id: number) => {
    pending = pending.filter((entry) => entry.id !== id);
  };
  performance.now = () => now;
  return {
    advance(ms: number): void {
      now += ms;
    },
    get queued(): number {
      return pending.length;
    },
    restore(): void {
      (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = previousRaf;
      (globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame = previousCancel;
      performance.now = previousNow;
    },
  };
}

/** Create a set of abilities + records of all callbacks. */
function harness(extra: Partial<DragCard> = {}) {
  const el = fakeEl();
  const stage = fakeEl();
  let box: { x: number; y: number } | null = { x: 400, y: 300 };
  const calls = {
    stopFlight: 0,
    stopAutonomy: 0,
    releaseLock: 0,
    plays: [] as string[],
    flights: [] as Array<{ px: number; py: number; vx: number; vy: number }>,
    places: [] as Array<{ x: number; y: number }>,
    clicks: 0,
    squashes: 0,
    seqs: 0,
    tipOn: [] as boolean[],
  };
  const card: DragCard = {
    petId: 'main',
    size: 200,
    halfW: 100,
    halfH: 56.25,
    physics: DEFAULT_PHYSICS,
    dragAnims: ['drag1'],
    clickAnims: ['click1'],
    idleAnims: ['idle1'],
    currentAnim: 'idle1',
    setOnce: () => {},
    playAnim: (name) => calls.plays.push(name),
    bumpSeq: () => {
      calls.seqs++;
    },
    markSquash: () => {
      calls.squashes++;
    },
    resumeWork: () => false,
    stopAutonomy: () => {
      calls.stopAutonomy++;
    },
    stopFlight: () => {
      calls.stopFlight++;
    },
    startFlight: (px, py, vx, vy) => calls.flights.push({ px, py, vx, vy }),
    isFrozen: () => false,
    releaseLock: () => {
      calls.releaseLock++;
    },
    grabVelocity: () => null,
    playClickSound: () => {
      calls.clicks++;
    },
    tipOn: () => false,
    placeTip: () => {},
    setTipOn: (on) => calls.tipOn.push(on),
    root: () => el as unknown as HTMLDivElement,
    box: () => box,
    setBox: (next) => {
      box = next;
    },
    commitPlace: (point) => calls.places.push(point),
    ...extra,
  };
  return {
    drag: createDrag(() => card),
    el,
    stage,
    calls,
    setBox: (next: { x: number; y: number }) => {
      box = next;
    },
  };
}

describe('createDrag - Press and Threshold', () => {
  test('Non-left click: does not enter the pressed state', () => {
    const frames = withFakeFrames();
    try {
      const { drag, el } = harness();
      drag.onPointerDown(pointer(el, 500, 350, 2));
      assert.equal(drag.isActive(), false);
    } finally {
      frames.restore();
    }
  });

  test('Left button press: enter the pressed state, stop flying, stop spring, and stop and go position once each', () => {
    const frames = withFakeFrames();
    try {
      const { drag, el, calls } = harness();
      drag.onPointerDown(pointer(el, 500, 350));
      assert.equal(drag.isActive(), true);
      assert.equal(calls.stopFlight, 1);
      assert.equal(calls.stopAutonomy, 1);
      assert.deepEqual(calls.tipOn, [false]);
    } finally {
      frames.restore();
    }
  });

  test('Press when frozen: defrost locally once', () => {
    const frames = withFakeFrames();
    try {
      const { drag, el, calls } = harness({ isFrozen: () => true });
      drag.onPointerDown(pointer(el, 500, 350));
      assert.equal(calls.releaseLock, 1);
    } finally {
      frames.restore();
    }
  });

  test('Movement that does not exceed the threshold: does not count as drag and does not play drag animation', () => {
    const frames = withFakeFrames();
    try {
      const { drag, el, calls } = harness();
      drag.onPointerDown(pointer(el, 500, 350));
      drag.onPointerMove(pointer(el, 502, 351));
      assert.deepEqual(calls.plays, []);
    } finally {
      frames.restore();
    }
  });

  test('Exceeding the threshold: Enter drag and drop and play the drag animation, but the stage displacement will not be rewritten (the grab point will not jump)', () => {
    const frames = withFakeFrames();
    try {
      const { drag, el, stage, calls } = harness();
      stage.style.transform = 'translateY(10px)';
      drag.onPointerDown(pointer(el, 500, 350));
      drag.onPointerMove(pointer(el, 540, 350));
      assert.deepEqual(calls.plays, ['drag1']);
      assert.equal(stage.style.transform, 'translateY(10px)', 'Stage displacement should remain constant');
    } finally {
      frames.restore();
    }
  });
});

describe('createDrag —— Where to go if you let go', () => {
  test('Let go without dragging: neither release nor fly, prompt to press release position to reset', () => {
    const frames = withFakeFrames();
    try {
      const { drag, el, calls } = harness();
      drag.onPointerDown(pointer(el, 500, 350));
      drag.onPointerUp(pointer(el, 500, 350));
      assert.deepEqual(calls.places, []);
      assert.deepEqual(calls.flights, []);
      assert.deepEqual(calls.tipOn, [false, true]);
    } finally {
      frames.restore();
    }
  });

  test('Drag slowly and then let go: put it down in place and submit the current bounding box.', () => {
    const frames = withFakeFrames();
    try {
      const { drag, el, calls } = harness();
      drag.onPointerDown(pointer(el, 500, 350));
      frames.advance(50);
      drag.onPointerMove(pointer(el, 540, 350));
      frames.advance(50);
      drag.onPointerMove(pointer(el, 560, 350));
      frames.advance(400); // The pause is long enough and the speed cannot be estimated.
      drag.onPointerUp(pointer(el, 560, 350));
      assert.equal(calls.flights.length, 0);
      assert.equal(calls.places.length, 1);
    } finally {
      frames.restore();
    }
  });

  test('Shake quickly and then let go: take off instead of putting down', () => {
    const frames = withFakeFrames();
    try {
      const { drag, el, calls } = harness();
      drag.onPointerDown(pointer(el, 500, 350));
      frames.advance(20);
      drag.onPointerMove(pointer(el, 600, 350));
      frames.advance(20);
      drag.onPointerMove(pointer(el, 700, 350));
      frames.advance(20);
      drag.onPointerMove(pointer(el, 800, 350));
      drag.onPointerUp(pointer(el, 800, 350));
      assert.equal(calls.places.length, 0);
      assert.equal(calls.flights.length, 1);
      assert.ok(calls.flights[0]!.vx > 0, `Should fly right: ${calls.flights[0]!.vx}`);
    } finally {
      frames.restore();
    }
  });

  test('Slingshot: The interval between two presses is short enough, press the pull distance to take off in the opposite direction', () => {
    const frames = withFakeFrames();
    try {
      const { drag, el, calls, setBox } = harness();
      drag.onPointerDown(pointer(el, 500, 350));
      drag.onPointerUp(pointer(el, 500, 350));
      frames.advance(60);
      // After pressing it for the second time, pull it up and to the left: when you let go, it should fly down and to the right.
      drag.onPointerDown(pointer(el, 500, 350));
      frames.advance(60);
      drag.onPointerMove(pointer(el, 420, 300));
      // Spring following only advances in the real rAF, and the pulled position is directly given here.
      setBox({ x: 380, y: 280 });
      frames.advance(20);
      drag.onPointerUp(pointer(el, 420, 300));
      assert.equal(calls.flights.length, 1);
      const flight = calls.flights[0]!;
      assert.ok(
        flight.vx > 0 && flight.vy > 0,
        `Pulling to the upper left should fly to the lower right: vx = ${flight.vx} vy = ${flight.vy}`,
      );
    } finally {
      frames.restore();
    }
  });
});

describe('createDrag —— mouse release fallback', () => {
  test('The pointer capture is lost and only comes mouseup: The release settlement is still completed and the drag state is reset.', () => {
    const frames = withFakeFrames();
    const win = withFakeWindow();
    try {
      const { drag, el, calls } = harness();
      drag.onPointerDown(pointer(el, 500, 350));
      frames.advance(50);
      drag.onPointerMove(pointer(el, 540, 350));
      frames.advance(400); // After a long enough pause, the settlement is "Put it down where you are"
      win.mouseUp(560, 350);
      assert.equal(calls.places.length, 1, 'mouseup should complete the release settlement after the capture is lost');
      assert.equal(el.hasClass('dragging'), false, 'The drag and drop class should be removed');
      assert.deepEqual(calls.tipOn, [false, true], 'Prompt should be reset');
    } finally {
      frames.restore();
      win.restore();
    }
  });

  test('Normal pointerup followed by mouseup: No settlement for the second time', () => {
    const frames = withFakeFrames();
    const win = withFakeWindow();
    try {
      const { drag, el, calls } = harness();
      drag.onPointerDown(pointer(el, 500, 350));
      frames.advance(50);
      drag.onPointerMove(pointer(el, 540, 350));
      frames.advance(400);
      drag.onPointerUp(pointer(el, 560, 350));
      assert.equal(win.count, 0, 'Fallback monitoring should not be hung after pointerup');
      win.mouseUp(560, 350);
      assert.equal(calls.places.length, 1, 'The same release can only be settled once.');
    } finally {
      frames.restore();
      win.restore();
    }
  });

  test('dispose: Remove fallback monitoring, and subsequent mouseup will no longer be settled.', () => {
    const frames = withFakeFrames();
    const win = withFakeWindow();
    try {
      const { drag, el, calls } = harness();
      drag.onPointerDown(pointer(el, 500, 350));
      drag.onPointerMove(pointer(el, 540, 350));
      frames.advance(400);
      drag.dispose();
      assert.equal(win.count, 0, 'Monitoring should not be left after dispose');
      win.mouseUp(560, 350);
      assert.equal(calls.places.length, 0, 'It should not be settled after unmounting');
    } finally {
      frames.restore();
      win.restore();
    }
  });

  test('Releasing the right button or pressing another button does not count as letting go.', () => {
    const frames = withFakeFrames();
    const win = withFakeWindow();
    try {
      const { drag, el, calls } = harness();
      drag.onPointerDown(pointer(el, 500, 350));
      drag.onPointerMove(pointer(el, 540, 350));
      frames.advance(400);
      win.mouseUp(560, 350, { button: 2 });
      win.mouseUp(560, 350, { buttons: 2 });
      assert.equal(calls.places.length, 0, 'It should not be settled unless the left button is released.');
      win.mouseUp(560, 350);
      assert.equal(calls.places.length, 1, 'Settlement still needs to be settled after releasing the left button.');
    } finally {
      frames.restore();
      win.restore();
    }
  });
});

describe('createDrag —— Release when pressing is finished', () => {
  test('Long pressing the menu ends the pressing: letting go will still pick the category and reset the prompt, but will not throw it.', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const frames = withFakeFrames();
    const win = withFakeWindow();
    const mouseEvent = withFakeMouseEvent();
    try {
      const { drag, el, calls } = harness();
      drag.onPointerDown(pointer(el, 500, 350, 0, 'touch'));
      assert.equal(el.hasClass('dragging'), true, 'The drag class should be brought when pressed');
      t.mock.timers.tick(500); // Long press to the point: the menu takes over and this press ends
      drag.onPointerUp(pointer(el, 500, 350, 0, 'touch'));
      assert.equal(el.hasClass('dragging'), false, 'The drag class should be removed when you let go');
      assert.deepEqual(
        calls.places,
        [],
        'The pressing has been terminated by the menu and should not be put down in place.',
      );
      assert.deepEqual(calls.flights, [], 'The press has been terminated by the menu and should not be thrown');
      assert.deepEqual(calls.tipOn, [false, true], 'Prompt should be reset');
    } finally {
      frames.restore();
      win.restore();
      mouseEvent.restore();
    }
  });
});

describe('createDrag —— Click', () => {
  test('Click: click sound effect + click animation + mark Q bomb + increment the source change serial number', () => {
    const frames = withFakeFrames();
    try {
      const { drag, el, calls } = harness();
      drag.onPointerDown(pointer(el, 500, 350));
      drag.onPointerUp(pointer(el, 500, 350));
      drag.onClick();
      assert.equal(calls.clicks, 1);
      assert.deepEqual(calls.plays, ['click1']);
      assert.equal(calls.squashes, 1);
      assert.equal(calls.seqs, 1);
    } finally {
      frames.restore();
    }
  });

  test('Just dragged within 100 ms: click is ignored', () => {
    const frames = withFakeFrames();
    try {
      const { drag, el, calls } = harness();
      drag.onPointerDown(pointer(el, 500, 350));
      drag.onPointerMove(pointer(el, 540, 350));
      frames.advance(400);
      drag.onPointerUp(pointer(el, 540, 350));
      assert.equal(drag.justDragged(), true);
      drag.onClick();
      assert.equal(calls.clicks, 0);
      frames.advance(150);
      drag.onClick();
      assert.equal(calls.clicks, 1);
    } finally {
      frames.restore();
    }
  });

  test('The click animation pool is empty: the sound is still produced, but the animation is not played.', () => {
    const frames = withFakeFrames();
    try {
      const { drag, el, calls } = harness({ clickAnims: [] });
      drag.onPointerDown(pointer(el, 500, 350));
      drag.onPointerUp(pointer(el, 500, 350));
      drag.onClick();
      assert.equal(calls.clicks, 1);
      assert.deepEqual(calls.plays, []);
    } finally {
      frames.restore();
    }
  });
});
