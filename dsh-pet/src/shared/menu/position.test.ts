/**
 * Geometric test of panel drop point (`pickPanelPosition`).
 *
 * verify an invariant: the new panel does not intersect with any expanded panel; when the window is too narrow, it
 * degenerates into pinching and does not cross the boundary.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { type PanelBox, pickPanelPosition } from './position.ts';

/** Clamping range in viewport coordinates (Window ∩ Workspace). */
const CLAMP = { x: 0, y: 0, w: 900, h: 520 };

/** Create a rectangle from the upper left corner and dimensions. */
const box = (left: number, top: number, w: number, h: number): PanelBox => ({
  left,
  top,
  right: left + w,
  bottom: top + h,
});

/** Whether two rectangles strictly intersect (edges are not counted). */
const overlaps = (a: PanelBox, b: PanelBox): boolean =>
  a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

describe('pickPanelPosition - Cascaded panels do not overlap', () => {
  const panel = { w: 220, h: 320 };

  test('Level 2: The right side of the parent panel can be placed → it is attached to the right side of the parent panel and does not intersect.', () => {
    const parent = box(100, 100, 220, 320);
    const p = pickPanelPosition({
      panel,
      item: { left: 100, right: 320, top: 120 },
      parent: { left: parent.left, right: parent.right, top: parent.top },
      others: [parent],
      clamp: CLAMP,
    });
    assert.ok(
      !overlaps(box(p.left, p.top, panel.w, panel.h), parent),
      'Child panels should not suppress the parent panel',
    );
    assert.equal(
      p.left,
      parent.right + 4,
      'When the right side can be placed, it should be attached to the right side of the parent panel',
    );
  });

  test('Level 2: Can’t fit on the right side → turn to the left side of the parent panel (not the left side of the trigger item)', () => {
    const parent = box(560, 100, 220, 320);
    const p = pickPanelPosition({
      panel,
      item: { left: 560, right: 780, top: 120 },
      parent: { left: parent.left, right: parent.right, top: parent.top },
      others: [parent],
      clamp: CLAMP,
    });
    assert.ok(
      !overlaps(box(p.left, p.top, panel.w, panel.h), parent),
      'The parent panel should not be pressed after turning left',
    );
    assert.equal(
      p.left,
      parent.left - 4 - panel.w,
      'Should be attached to the left side of the parent panel, not the left side of the trigger item',
    );
  });

  test('Level 3: Do not push it to Level 2 or Level 1 when the right side cannot be placed.', () => {
    const l1 = box(0, 100, 220, 320);
    const l2 = box(224, 120, 220, 320);
    const p = pickPanelPosition({
      panel,
      item: { left: 224, right: 444, top: 140 },
      parent: { left: l2.left, right: l2.right, top: l2.top },
      others: [l1, l2],
      clamp: CLAMP,
    });
    const rect = box(p.left, p.top, panel.w, panel.h);
    assert.ok(!overlaps(rect, l1), 'Level 3 should not overwhelm level 1');
    assert.ok(!overlaps(rect, l2), 'The third level should not suppress the second level');
  });

  test('When all candidates are occupied, priority is given to non-overlapping positions (even if they are separated from the parent panel)', () => {
    const l1 = box(0, 0, 220, 520);
    const l2 = box(224, 0, 220, 520);
    const p = pickPanelPosition({
      panel: { w: 220, h: 200 },
      item: { left: 224, right: 444, top: 10 },
      parent: { left: l2.left, right: l2.right, top: l2.top },
      others: [l1, l2],
      clamp: CLAMP,
    });
    const rect = box(p.left, p.top, 220, 200);
    assert.ok(!overlaps(rect, l1) && !overlaps(rect, l2), 'There is still overlap');
  });

  test('The drop point always falls completely within clamp (extreme parent panel position including four boundaries)', () => {
    const cases = [
      box(0, 0, 220, 320),
      box(680, 0, 220, 320),
      box(0, 200, 220, 320),
      box(680, 200, 220, 320),
      box(340, 100, 220, 320),
    ];
    for (const parent of cases) {
      const p = pickPanelPosition({
        panel: { w: 220, h: 200 },
        item: { left: parent.left, right: parent.right, top: parent.top + 10 },
        parent: { left: parent.left, right: parent.right, top: parent.top },
        others: [parent],
        clamp: CLAMP,
      });
      assert.ok(p.left >= 4 - 0.5, 'left 越界：' + JSON.stringify(p));
      assert.ok(p.left + 220 <= 896 + 0.5, 'right 越界：' + JSON.stringify(p));
      assert.ok(p.top >= 4 - 0.5, 'top 越界：' + JSON.stringify(p));
      assert.ok(p.top + 200 <= 516 + 0.5, 'bottom 越界：' + JSON.stringify(p));
    }
  });

  test('When the window is very narrow (any position will overlap), it degenerates into clamping instead of returning out-of-bounds coordinates.', () => {
    const narrow = { x: 0, y: 0, w: 260, h: 200 };
    const parent = box(0, 0, 220, 180);
    const p = pickPanelPosition({
      panel: { w: 220, h: 120 },
      item: { left: 0, right: 220, top: 10 },
      parent: { left: 0, right: 220, top: 0 },
      others: [parent],
      clamp: narrow,
    });
    assert.ok(p.left >= 4 - 0.5 && p.left + 220 <= 260 - 4 + 0.5, 'left out of bounds');
    assert.ok(p.top >= 4 - 0.5 && p.top + 120 <= 200 - 4 + 0.5, 'top out of bounds');
  });

  test('Consistent with the old behavior when there are no other panels (right-side expansion, top-aligned trigger items)', () => {
    const p = pickPanelPosition({
      panel: { w: 220, h: 320 },
      item: { left: 100, right: 320, top: 150 },
      parent: { left: 100, right: 320, top: 100 },
      others: [],
      clamp: CLAMP,
    });
    assert.deepEqual(p, { left: 324, top: 150 });
  });
});
