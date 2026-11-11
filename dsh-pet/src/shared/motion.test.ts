/**
 * Window placement test: When the main body is close to the edge of the screen, after the window is clamped back to
 * the workspace by the window manager, how can the main body be compensated by the offset within the window.
 *
 * The size is taken from the actual measured configuration of issue #274: pet size 440 (body 440×247.5), window = body
 * + left and right bottom 220, top 294 (bubble/to-do panel height), work area 1920×1040 (1920×1080 minus 40 px
 * taskbar).
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { anchorPixel, fitWindowInArea } from './motion.ts';

/** Actual measured window size: left and right margin 0.5× size, upper margin is the maximum value of bubble/to-do panel height. */
const WINDOW = { width: 880, height: 782 };
/** Body box: Width = video box width, height does not include the transparent pads on the soles of the feet (the window is allowed in that section). */
const BODY = { width: 440, height: 247.5 };
/** Expected margin = window origin to body origin. */
const INSET = { x: 220, y: 294 };
/** 1920×1080 minus 40 px taskbar. */
const AREA = { x: 0, y: 0, width: 1920, height: 1040 };

/** The same input parameters as caller: the body position is the lower right corner of the configuration + margin. */
const fitOf = (bodyX: number, bodyY: number, extra: Partial<Parameters<typeof fitWindowInArea>[0]> = {}) =>
  fitWindowInArea({
    bodyX,
    bodyY,
    width: WINDOW.width,
    height: WINDOW.height,
    bodyWidth: BODY.width,
    bodyHeight: BODY.height,
    insetX: INSET.x,
    insetY: INSET.y,
    ...extra,
  });

describe('fitWindowInArea - Platform without window clamping (Windows / macOS)', () => {
  test('There is no workspace: the window sticks out of the screen → the body offset is the margin', () => {
    const fit = fitOf(1456, 782.5);
    assert.deepEqual(fit, { x: 1236, y: 488.5, offsetX: 220, offsetY: 294 });
  });

  test('The window should stick out of the screen: not clamped → sticking out of the screen is an old behavior consistent with both ends', () => {
    const fit = fitOf(1456, 782.5, { area: undefined });
    assert.equal(fit.x + fit.offsetX, 1456, 'Window origin + offset = body position');
    assert.equal(fit.y + fit.offsetY, 782.5);
  });
});

describe('fitWindowInArea - the platform for clamping the window (X11 and other WM that close the window in the workspace)', () => {
  test("The lower right corner of the main body is: the window is clamped into the workspace → the clamped amount is converted to the main body offset, and the main body's foothold remains unchanged.", () => {
    const fit = fitOf(1456, 782.5, { area: AREA });
    assert.deepEqual(
      fit,
      { x: 1040, y: 258, offsetX: 416, offsetY: 524.5 },
      'x/y = Lower right of the workspace minus the window size',
    );
    assert.equal(fit.x + fit.offsetX, 1456, 'The main body is still configured x');
    assert.equal(fit.y + fit.offsetY, 782.5, 'The main body is still configured y');
    assert.ok(
      fit.offsetX > INSET.x && fit.offsetY > INSET.y,
      'The offset must be clamped and amplified, otherwise the body will return a margin',
    );
  });

  test('Window in workspace: Offset retention margin → consistent bit by bit with unclamped platform', () => {
    const fit = fitOf(600, 400, { area: AREA });
    assert.deepEqual(fit, { x: 380, y: 106, offsetX: 220, offsetY: 294 });
  });

  test('Stick to the top: The window stops at the top edge of the work area → the body offset is pressed to 0 (clamp all four sides, and the body can be dragged out of the screen by missing one side)', () => {
    const body = anchorPixel({
      corner: 'top-left',
      marginX: 24,
      marginY: 0,
      size: BODY.width,
      W: AREA.width,
      H: AREA.height,
      area: AREA,
    });
    const fit = fitOf(body.x, body.y, { area: AREA });
    assert.equal(fit.x, AREA.x, 'Left border sight');
    assert.equal(fit.y, AREA.y, 'The top edge of the window is attached to the top edge of the work area');
    assert.equal(
      fit.offsetY,
      0,
      'The top edge of the main body coincides with the top edge of the window, so the pet is really attached to the top of the screen.',
    );
    assert.equal(
      fit.x + fit.offsetX,
      24,
      'The main body is 24 px from the left, achieved by offset 24 within the window',
    );
  });

  test('The work area is smaller than the window: the body is clamped into the work area → the window sticks to the starting point', () => {
    // Only 600×400 is left in the work area (window 880×782 cannot fit): The window is attached to the starting point, and the main body is clamped to the position where it can stand according to the work area.
    const narrow = { x: 0, y: 0, width: 600, height: 400 };
    const fit = fitOf(560, 700, { area: narrow });
    assert.equal(fit.x, 0, 'Stick to the starting point when the window is wider than the work area');
    assert.equal(fit.x + fit.offsetX, 160, 'The maximum left side of the main body is 600 − 440');
    assert.equal(fit.y + fit.offsetY, 152.5, 'The upper limit of the main body is up to 400 − 247.5');
  });

  test('Over-the-border allowance reach: The main body can be hung out of the work area → the out-of-border section will be cropped by the window', () => {
    const reach = { left: 144, right: 144, top: 0, bottom: 0 };
    const right = fitOf(1920, 782.5, { area: AREA, reach });
    assert.equal(right.x + right.offsetX, 1624, 'The right side of the main body can be hung to 1920 + 144 − 440');
    assert.equal(
      right.x + right.offsetX + BODY.width,
      AREA.width + reach.right,
      'The right edge of the box just exceeds reach',
    );
    const left = fitOf(-100, 782.5, { area: AREA, reach });
    assert.equal(left.offsetX, -100, 'The left side is also allowed to hang out, and the offset becomes negative.');
  });

  test('No reach: The body remains completely in the work area (default is not relaxed)', () => {
    const fit = fitOf(5000, 5000, { area: AREA });
    assert.equal(fit.x + fit.offsetX, AREA.width - BODY.width);
    assert.equal(fit.y + fit.offsetY, AREA.height - BODY.height);
  });

  test('The body falls outside the work area (in the cavity) → When the offset is clamped to 0, the body will not be moved to the left/top of the window.', () => {
    const right = { x: 1000, y: 500, width: 800, height: 600 };
    const fit = fitOf(0, 0, { area: right });
    assert.equal(fit.x, 1000, 'The window is pulled back to the workspace');
    assert.equal(fit.offsetX, 0);
    assert.equal(fit.offsetY, 0);
  });
});

describe('fitWindowInArea - end-to-end placement combined with corner positioning', () => {
  test('Configuration bottom-right + marginX24 + marginY10: Do not give reach → The body falls 24 from the right and 10 from the bottom', () => {
    const body = anchorPixel({
      corner: 'bottom-right',
      marginX: 24,
      marginY: 10,
      size: BODY.width,
      W: AREA.width,
      H: AREA.height,
      area: AREA,
    });
    const fit = fitOf(body.x, body.y, { area: AREA });
    assert.equal(fit.x + fit.offsetX, 1456, 'Right: 1920 − 440 − 24 = 1456');
    assert.equal(fit.y + fit.offsetY, 782.5, 'Bottom: 1040 − 247.5 − 10 = 782.5');
  });
});
