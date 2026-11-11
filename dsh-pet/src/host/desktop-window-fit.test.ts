/**
 * Desktop "window placement" wiring test: Load sprite/window-fit.js globally with a substitute, and assert its
 * handling of windows and offsets.
 *
 * Why not just test pure functions: This link spans three classic script (CONFIG of constants, PetSprite of sprite.js,
 * fitWindowInArea of shared-core). Any change in the name or loading order will appear as "the pet on the desktop goes
 * elsewhere", and there is no type checking fallback for this error. If you really run that script here, what you read
 * is the behavior, not the text.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { MIN_REACHABLE_PX } from '../shared/constants.ts';
import { resolveRect } from '../shared/displays.ts';
import { fitWindowInArea } from '../shared/motion.ts';

const require = createRequire(import.meta.url);

/** 1920×1080 minus 40 px taskbar. */
const AREA = { x: 0, y: 0, width: 1920, height: 1040 };

/** Global avatar: Let CONFIG / WORK_AREAS / S / PetSprite / window in the classic script be parsed. */
const globals = globalThis as unknown as Record<string, unknown>;
globals.PetSprite = function PetSprite() {};
globals.CONFIG = { isWindowClampedToWorkArea: false };
globals.WORK_AREAS = [AREA];
globals.S = { resolveRect, fitWindowInArea, MIN_REACHABLE_PX };
globals.VIEW = { x: 0, y: 0, w: 1920, h: 1080 };
globals.toScreen = (v: number): number => v; // The reporting unit conversion is 1:1 here, so that assertion can be understood.
globals.window = { __dshPetDebug: {} };
// Only load once: the module cache will make the second require a no-op, and the platform switch is changed to CONFIG before calling.
require('../../runtime/electron-helper/sprite/window-fit.js');

/** The script under test is hung on the window on PetSprite.prototype. */
const spriteProto = (globals.PetSprite as { prototype: Record<string, unknown> }).prototype;

/** Switch "whether the platform clamps the window". */
const setWindowClampedToWorkArea = (value: boolean): void => {
  (globals.CONFIG as { isWindowClampedToWorkArea: boolean }).isWindowClampedToWorkArea = value;
};

/** Window position + size: The script adds the result of the pure function to the window width and height and returns it together. */
type WindowFit = ReturnType<typeof fitWindowInArea> & { width: number; height: number };

/** All states used by a pet in the window placement (the size is based on the actual measured configuration of issue #274). */
interface Sprite {
  size: number;
  /** The body is tall and does not include transparent foot pads. */
  height: number;
  /** High body + transparent sole pads */
  winH: number;
  halfW: number;
  halfH: number;
  margin: { l: number; r: number; t: number; b: number };
  pos: { x: number; y: number };
  winOffset: { x: number; y: number };
  el: { style: Record<string, string> };
  /** Hit area (elf coordinates): The transparent blank space on the left and top is determined by it. */
  hitRect: { x: number; y: number; w: number; h: number };
  /** The transparent blank space on the left and right sides of the video box. */
  sideAllow: number;
  /** Real-time status in flight; null/undefined when stationary. */
  throwState?: { vx: number; vy: number } | null;
  fitWindow(): WindowFit;
  reportWindow(fit: WindowFit): void;
}

/** size 440: Window = body + 220 on the left and right, 294 on the top; the position is configured as bottom-right (24 from the right, 10 from the bottom). */
const makeSprite = (): Sprite =>
  Object.assign(Object.create(spriteProto), {
    size: 440,
    height: 247.5,
    winH: 268,
    halfW: 220,
    halfH: 123.75,
    margin: { l: 220, r: 220, t: 294, b: 220 },
    pos: { x: 1456, y: 782.5 },
    winOffset: { x: 220, y: 294 },
    el: { style: {} as Record<string, string> },
    bottomPad: 20.625,
    // Transparent white space other than the characters in the video box: 137.5 on the left and right (= 0.3125× size), 55 on the top of the head, and 17.1 on the soles of the feet.
    sideAllow: 137.5,
    hitRect: { x: 137.5, y: 55, w: 165, h: 196 },
  }) as Sprite;

describe('sprite/window-fit.js ——Window wiring', () => {
  test('The platform does not clamp the window (Windows / macOS): the window sticks out of the screen as it is → the body is not moved and the style is not written.', () => {
    setWindowClampedToWorkArea(false);
    const sprite = makeSprite();
    const fit = sprite.fitWindow();
    assert.deepEqual(fit, { x: 1236, y: 488.5, width: 880, height: 782, offsetX: 220, offsetY: 294 });
    assert.deepEqual(sprite.winOffset, { x: 220, y: 294 }, 'The body offset should not be changed without clamping');
    assert.deepEqual(
      sprite.el.style,
      {},
      'The style must not be written when the value has not changed (called frame by frame)',
    );
  });

  test('Platform clamp window (X11): The window is pressed back to the work area → the body offset absorbs the clamping amount and falls to DOM', () => {
    setWindowClampedToWorkArea(true);
    const sprite = makeSprite();
    const fit = sprite.fitWindow();
    assert.deepEqual(fit, { x: 1040, y: 258, width: 880, height: 782, offsetX: 416, offsetY: 524.5 });
    assert.deepEqual(
      sprite.winOffset,
      { x: 416, y: 524.5 },
      'The offset must increase accordingly, otherwise the body will return a margin',
    );
    assert.equal(sprite.el.style.left, '416px');
    assert.equal(sprite.el.style.top, '524.5px');
  });

  test('The window moves within the work area: offset retention margin → body position = window origin + offset', () => {
    setWindowClampedToWorkArea(true);
    const sprite = makeSprite();
    sprite.pos = { x: 600, y: 400 };
    const fit = sprite.fitWindow();
    assert.deepEqual(sprite.winOffset, { x: 220, y: 294 }, 'Compensation is not triggered in the work area');
    assert.equal(fit.x + fit.offsetX, 600);
    assert.equal(fit.y + fit.offsetY, 400);
  });

  test('Stick to the lower right corner: the window and offset match → the body falls at the configured position (24 from the right, 10 from the bottom)', () => {
    setWindowClampedToWorkArea(true);
    const sprite = makeSprite();
    const fit = sprite.fitWindow();
    assert.equal(fit.x + fit.offsetX, 1456, 'Right edge of body = 1456 + 440 = 1896, 24 from screen right');
    assert.equal(
      fit.y + fit.offsetY,
      782.5,
      'Bottom edge of body = 782.5 + 247.5 = 1030, 10 away from taskbar (configuration value)',
    );
    assert.ok(
      fit.x + fit.width <= AREA.width,
      'The window must not go beyond the right edge of the work area (otherwise it will be clamped again by WM)',
    );
    assert.ok(fit.y + fit.height <= AREA.height, 'The window must not extend beyond the lower edge of the work area');
  });

  test('Report to the main process: once with the window rectangle + body box + hit area offset → parameter order is the protocol', () => {
    setWindowClampedToWorkArea(true);
    const sent: number[][] = [];
    const win = globals.window as { petBridge?: { setBounds: (...args: number[]) => void } };
    win.petBridge = { setBounds: (...args: number[]) => sent.push(args) };
    const sprite = makeSprite();
    const fit = sprite.fitWindow();
    // Same step as sendBounds: first move pos to the actual reachable position, and then report it
    sprite.pos = { x: fit.x + fit.offsetX, y: fit.y + fit.offsetY };
    sprite.reportWindow(fit);
    assert.deepEqual(
      sent,
      [
        [
          1040, // Window x
          258, // Window y
          880, // Window width
          782, // Window high
          1456, // Bounding box x
          782.5, // Bounding box y
          440, // Body width
          20.625, // Transparent pads for the soles of the feet (included in the main body)
          0, // vx (static)
          0, // vy
          416, // Left offset of hit zone determination
          524.5, // Upper offset of hit zone determination
        ],
      ],
      'Read this copy for both the hit zone and the collision site. If the order is wrong, it will only result in a missed hit/missed collision.',
    );
    delete win.petBridge;
  });

  test('Out of bounds: The hit zone leaves 24 px in the screen → the main body can be hung out (same rules as the web version clampReachableBox)', () => {
    setWindowClampedToWorkArea(true);
    const sprite = makeSprite();
    sprite.pos = { x: 9999, y: 9999 };
    const right = sprite.fitWindow();
    assert.equal(
      right.x + right.offsetX + sprite.hitRect.x,
      AREA.width - 24,
      'Right: The left edge of the hit area stops at 24 px on the right side of the screen',
    );
    sprite.pos = { x: 0, y: -9999 };
    const left = sprite.fitWindow();
    assert.equal(
      left.y + left.offsetY + sprite.hitRect.y + sprite.hitRect.h,
      24,
      'Top: Leave 24 px at the bottom of the hit area so that the main body hangs above the screen',
    );
    assert.equal(left.offsetY, -227, 'Offset turns negative when hanging out');
  });
});
