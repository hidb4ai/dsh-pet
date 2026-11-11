/**
 * Set contract testing for page overlay positioning.
 *
 * Four contracts:
 * 1. The default is to expand downward: the top edge of the floating layer is attached to the bottom edge of the
 * trigger 4 px downward, and the height does not exceed 360 px;
 * 2. Turn it up when the lower part cannot fit and the upper part is more spacious. When you turn it up, you will get
 * `bottom` (close to the top edge of the trigger and go up);
 * 3. The width is clamped within [lower limit, min (upper limit, viewport width - 16)], and the left and right are
 * clamped to the viewport without crossing the boundary;
 * 4. The lower limit and upper limit can be overridden by caller: a single line pull-down pass 0 is the same width as
 * the trigger.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { computePanelPlacement } from './placement.ts';

const anchor = { left: 100, top: 300, bottom: 328, width: 340 };

describe('computePanelPlacement —— Floating layer positioning', () => {
  test('Enough space: expand downward, the width is the width of the trigger', () => {
    const pos = computePanelPlacement(anchor, { width: 1280, height: 900 });
    assert.equal(pos.left, 100);
    assert.equal(pos.top, 332, 'Trigger bottom edge + 4 px offset');
    assert.equal(pos.bottom, undefined, 'When expanding downward, bottom cannot be given at the same time.');
    assert.equal(pos.width, 340);
    assert.equal(pos.maxHeight, Math.min(360, 900 - 328 - 12), 'The height is limited by the remaining space below');
  });

  test('The lower part is insufficient and the upper part is more generous: turn it to the upper part and place the bottom edge against the top edge of the trigger', () => {
    // Viewport height 400, trigger bottom 380 → only 8 left at the bottom; 288 above is more generous.
    const pos = computePanelPlacement({ left: 100, top: 352, bottom: 380, width: 340 }, { width: 1280, height: 400 });
    assert.equal(pos.top, undefined, 'You cannot give top at the same time when turning it up.');
    assert.equal(pos.bottom, 400 - 352 + 4, 'Bottom = viewport height - trigger top + 4 px');
    assert.equal(pos.maxHeight, Math.min(360, 352 - 12), 'The height is limited by the remaining space above');
  });

  test('The lower part is insufficient but the upper part is smaller: still expanded downward, but the height is compressed', () => {
    // The trigger is near the top: 88 above, 250 below; 250 below >= 240 threshold, no turning.
    const pos = computePanelPlacement({ left: 100, top: 100, bottom: 128, width: 340 }, { width: 1280, height: 400 });
    assert.equal(pos.top, 132);
    assert.equal(pos.maxHeight, 400 - 128 - 12);
  });

  test('Width lower limit 240: Narrow triggers are also rendered at 240', () => {
    const pos = computePanelPlacement({ left: 10, top: 300, bottom: 320, width: 60 }, { width: 1280, height: 900 });
    assert.equal(pos.width, 240);
  });

  test('Maximum width: the viewport is not wider than 420', () => {
    const pos = computePanelPlacement({ left: 10, top: 300, bottom: 320, width: 900 }, { width: 2000, height: 900 });
    assert.equal(pos.width, 420);
  });

  test('The viewport is very narrow: the width gives way to the viewport (no margin other than 16 px is left), and the left and right do not cross the boundary.', () => {
    const pos = computePanelPlacement({ left: 200, top: 300, bottom: 320, width: 340 }, { width: 300, height: 900 });
    assert.equal(pos.width, 284, 'Viewport 300 - 16');
    assert.equal(pos.left, 8, 'If the right side cannot fit, stick to the left border 8 px');
  });

  test('Left border clamping: When the trigger is attached to the left side of the viewport, the floating layer does not go beyond the left side.', () => {
    const pos = computePanelPlacement({ left: 0, top: 300, bottom: 320, width: 340 }, { width: 1280, height: 900 });
    assert.equal(pos.left, 8);
  });

  test('The lower limit of coverage is 0: the single-line pull-down is the same width as the trigger and is not supported to 240', () => {
    const pos = computePanelPlacement(
      { left: 100, top: 300, bottom: 328, width: 120 },
      { width: 1280, height: 900 },
      { minWidthPx: 0 },
    );
    assert.equal(pos.width, 120);
  });

  test('Upper limit of coverage height and flip threshold: small lists cannot reach 360 just because there is enough space.', () => {
    const pos = computePanelPlacement(anchor, { width: 1280, height: 900 }, { maxHeightPx: 200, flipThresholdPx: 100 });
    assert.equal(pos.maxHeight, 200);
    assert.equal(pos.top, 332);
  });
});
