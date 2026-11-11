/**
 * Contract test of pet box geometry (src/client/pet/motion/geometry.ts): the two directions of the center and the
 * bounding box are reciprocal, the measurement scales linearly with the width, the hit area is converted according to
 * the canvas, the inline style of the stage and the root node, and the visible lower limit of out-of-bounds placement.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { HIT_BOX, MIN_REACHABLE_PX } from '../../../shared/constants.ts';
import { bodyPixelBox } from '../../../shared/physics.ts';
import {
  boxToRatio,
  centerToBox,
  clampReachableBox,
  derivePetMetrics,
  PET_HIT_STYLE,
  petRootStyle,
  petStageStyle,
} from './geometry.ts';

const viewport = { width: 1280, height: 800 };
const half = { w: 130, h: 73 };

describe('centerToBox / boxToRatio —— Center and bounding box conversion', () => {
  test('Center→upper left corner: subtract respective half-width and half-height', () => {
    assert.deepEqual(centerToBox({ rx: 0.5, ry: 0.5 }, viewport, half), { x: 640 - 130, y: 400 - 73 });
  });

  test('Reciprocal: convert back and forth to restore the same center (no jump when letting go)', () => {
    for (const center of [
      { rx: 0.12, ry: 0.34 },
      { rx: 0.5, ry: 0.5 },
      { rx: 0.999, ry: 0.001 },
    ]) {
      const back = boxToRatio(centerToBox(center, viewport, half), viewport, half);
      assert.ok(Math.abs(back.rx - center.rx) < 1e-9, `rx should be restored: ${back.rx}`);
      assert.ok(Math.abs(back.ry - center.ry) < 1e-9, `ry should be restored: ${back.ry}`);
    }
  });

  test('Unequal width and height: half-height will not be mixed into horizontal conversion', () => {
    const box = centerToBox({ rx: 0.5, ry: 0.5 }, viewport, half);
    assert.equal(box.x, viewport.width / 2 - half.w);
    assert.equal(box.y, viewport.height / 2 - half.h);
  });

  test('Ratio 0 / 1: Allow half of the box to exit the screen without clamping', () => {
    assert.deepEqual(centerToBox({ rx: 0, ry: 0 }, viewport, half), { x: -half.w, y: -half.h });
    assert.deepEqual(centerToBox({ rx: 1, ry: 1 }, viewport, half), {
      x: viewport.width - half.w,
      y: viewport.height - half.h,
    });
  });
});

describe('derivePetMetrics - Deriving box measurement from width', () => {
  test('Half-width, half-height: keep half of the 16:9 box', () => {
    const m = derivePetMetrics(462);
    assert.equal(m.halfW, 231);
    assert.ok(
      Math.abs(m.halfH / m.halfW - 9 / 16) < 1e-9,
      `The ratio of half-height to half-width should be 9/16: ${m.halfH / m.halfW}`,
    );
  });

  test('Linear scaling: double the width and double all four quantities', () => {
    const one = derivePetMetrics(300);
    const two = derivePetMetrics(600);
    for (const key of ['halfW', 'halfH', 'bottomPad', 'sideAllow'] as const) {
      assert.ok(Math.abs(two[key] - one[key] * 2) < 1e-9, `${key} should scale linearly with width`);
    }
  });

  test('The height of the sole of the foot pad is less than half the height: the foot pad only eats up a blank space at the bottom of the box', () => {
    const m = derivePetMetrics(462);
    assert.ok(
      m.bottomPad > 0 && m.bottomPad < m.halfH,
      `bottomPad = ${m.bottomPad} should fall in (0, halfH = ${m.halfH})`,
    );
  });

  test('The left and right margins are less than half the width: the welt is the body, not the entire transparent box', () => {
    const m = derivePetMetrics(462);
    assert.ok(
      m.sideAllow > 0 && m.sideAllow < m.halfW,
      `sideAllow = ${m.sideAllow} should fall in (0, halfW = ${m.halfW})`,
    );
  });

  test('Zero width: all four quantities degenerate to 0, no NaN is output', () => {
    const m = derivePetMetrics(0);
    assert.deepEqual(m, { halfW: 0, halfH: 0, bottomPad: 0, sideAllow: 0 });
  });
});

describe('petStageStyle —— Stage displacement', () => {
  test('Always press the foot pad to move down: it will not be canceled during dragging, so that the grab point will not be offset relative to the cursor.', () => {
    assert.deepEqual(petStageStyle(21.6), { transform: 'translateY(21.6px)' });
  });

  test('Pad is 0: displacement is 0, no additional offset is generated', () => {
    assert.deepEqual(petStageStyle(0), { transform: 'translateY(0px)' });
  });
});

describe('petRootStyle ——Root node positioning', () => {
  test('Not dragged: an empty object is returned, and the position is given to the CSS variables of the corners and margins.', () => {
    assert.deepEqual(petRootStyle(null, viewport, { w: 231, h: 130 }), {});
  });

  test('Dragged: Calculate the upper left corner according to the normalized center and return the other side to zero', () => {
    assert.deepEqual(petRootStyle({ rx: 0.5, ry: 0.25 }, viewport, { w: 231, h: 130 }), {
      left: 640 - 231 + 'px',
      top: 200 - 130 + 'px',
      right: 'auto',
      bottom: 'auto',
    });
  });

  test('No boundary clamping: ratio 0 / 1 allows half of the box to exit the screen', () => {
    assert.equal(petRootStyle({ rx: 0, ry: 0 }, viewport, { w: 231, h: 130 }).left, -231 + 'px');
    assert.equal(petRootStyle({ rx: 1, ry: 1 }, viewport, { w: 231, h: 130 }).top, 800 - 130 + 'px');
  });
});

describe('PET_HIT_STYLE —— Hit area converted into percentage', () => {
  test('Four percentages consistent with hitbox on 640×360 canvas', () => {
    assert.deepEqual(PET_HIT_STYLE, {
      left: (HIT_BOX.x0 / 640) * 100 + '%',
      top: (HIT_BOX.y0 / 360) * 100 + '%',
      width: ((HIT_BOX.x1 - HIT_BOX.x0) / 640) * 100 + '%',
      height: ((HIT_BOX.y1 - HIT_BOX.y0) / 360) * 100 + '%',
    });
  });

  test('The hit box does not exceed the pet box', () => {
    const left = parseFloat(PET_HIT_STYLE.left as string);
    const top = parseFloat(PET_HIT_STYLE.top as string);
    const width = parseFloat(PET_HIT_STYLE.width as string);
    const height = parseFloat(PET_HIT_STYLE.height as string);
    assert.ok(left >= 0 && top >= 0, 'The upper left corner should be inside the box');
    assert.ok(
      left + width <= 100 + 1e-9 && top + height <= 100 + 1e-9,
      'The box should not come out of the lower right corner',
    );
  });
});

describe('clampReachableBox——The visible lower limit of out-of-bounds placement', () => {
  const size = 462;
  const { bottomPad } = derivePetMetrics(size);
  const inset = bodyPixelBox({ x: 0, y: 0, size, bottomPad });

  /** The intersection size of the hit area and the viewport (px), that is, "how many points are left to get". */
  function visible(box: { x: number; y: number }): { w: number; h: number } {
    const body = bodyPixelBox({ x: box.x, y: box.y, size, bottomPad });
    return {
      w: Math.min(body.right, viewport.width) - Math.max(body.left, 0),
      h: Math.min(body.bottom, viewport.height) - Math.max(body.top, 0),
    };
  }

  test('The right edge is out of bounds: the right edge of the hit area exceeds the viewport → push back to only 24 px visible', () => {
    const box = clampReachableBox({ x: 5000, y: 200 }, viewport, { size, bottomPad });
    assert.equal(
      box.x,
      viewport.width - inset.left - MIN_REACHABLE_PX,
      'The left edge should be pushed to the hit zone to leave a lower limit',
    );
    assert.ok(Math.abs(visible(box).w - MIN_REACHABLE_PX) < 1e-9, `The visible width should be ${MIN_REACHABLE_PX}`);
    assert.equal(box.y, 200, 'The axis that has not crossed the boundary does not move.');
  });

  test('Left out of bounds: the left edge of the hit area exceeds the viewport → push back to only 24 px visible', () => {
    const box = clampReachableBox({ x: -5000, y: 200 }, viewport, { size, bottomPad });
    assert.equal(
      box.x,
      MIN_REACHABLE_PX - inset.right,
      'The right edge should be pushed to the hit zone to leave a lower limit',
    );
    assert.ok(Math.abs(visible(box).w - MIN_REACHABLE_PX) < 1e-9, `The visible width should be ${MIN_REACHABLE_PX}`);
  });

  test('Bottom out of bounds: The bottom edge of the hit area is lower than the viewport → push back to only 24 px visible', () => {
    const box = clampReachableBox({ x: 200, y: 5000 }, viewport, { size, bottomPad });
    assert.equal(
      box.y,
      viewport.height - inset.top - MIN_REACHABLE_PX,
      'The top edge should be pushed to the hit zone to leave a lower limit',
    );
    assert.ok(Math.abs(visible(box).h - MIN_REACHABLE_PX) < 1e-9, `The visible height should be ${MIN_REACHABLE_PX}`);
  });

  test('Top out of bounds: The top edge of the hit area is higher than the viewport → push back to only 24 px visible', () => {
    const box = clampReachableBox({ x: 200, y: -5000 }, viewport, { size, bottomPad });
    assert.equal(
      box.y,
      MIN_REACHABLE_PX - inset.bottom,
      'The bottom edge should be pushed to the hit zone to leave a lower limit',
    );
    assert.ok(Math.abs(visible(box).h - MIN_REACHABLE_PX) < 1e-9, `The visible height should be ${MIN_REACHABLE_PX}`);
  });

  test('Not crossing the boundary: return as is → without any displacement', () => {
    const inside = { x: 400, y: 300 };
    assert.deepEqual(clampReachableBox(inside, viewport, { size, bottomPad }), inside);
  });

  test('Extremely narrow viewport + small pets: the range is reversed → the axis is centered and does not clip to the wrong side', () => {
    const narrow = { width: 5, height: 800 };
    const tiny = 100;
    const box = clampReachableBox({ x: 5000, y: 200 }, narrow, { size: tiny, bottomPad: 0 });
    assert.equal(
      box.x,
      (narrow.width - tiny) / 2,
      'When twice the lower limit cannot be accommodated, the box should be centered',
    );
  });

  test('Four corners out of bounds: Two axes are clamped separately → 24 px remains on the corner', () => {
    const box = clampReachableBox({ x: 5000, y: 5000 }, viewport, { size, bottomPad });
    const seen = visible(box);
    assert.ok(Math.abs(seen.w - MIN_REACHABLE_PX) < 1e-9, `The visible width should be ${MIN_REACHABLE_PX}`);
    assert.ok(Math.abs(seen.h - MIN_REACHABLE_PX) < 1e-9, `The visible height should be ${MIN_REACHABLE_PX}`);
  });
});
