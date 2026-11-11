/**
 * Multi-monitor geometry unit testing - verify boundary behavior with measured irregular layouts.
 *
 * Layout: T type dual screen with right side (the secondary screen is placed vertically on the right, and the top and
 * bottom are beyond the main screen), the two screens DIP are perfectly spaced (gap 0): Main screen DELL P2721Q
 * workArea 0,0 2560×1392 scaleFactor 1.5 Secondary screen DELL P2721Q workArea 2560,-532 1235×2147 scaleFactor 1.75
 * rotation 90 Key properties: 23.7% of the area in the external rectangle 0,-532 3795×2147 does not belong to any
 * display - directly above the main screen y ∈[-532,0) and y ∈[1392,1615) directly below. If the bounding rectangle is
 * used as the boundary, the pet will walk/fly into these two areas and stop there, and the user will not be able to
 * see it at all.
 *
 * Coordinate system: This document directly uses screen coordinates (including negative y) to verify that these
 * functions do not assume that the origin is 0.
 *
 * Running method: node --experimental-strip-types --test src/shared/displays.test.ts
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  boundingRect,
  clampPointToRegion,
  indexAtPoint,
  nearestIndex,
  rebaseCenter,
  rectAtPoint,
  regionHoleRatio,
  translateRects,
} from './displays.ts';
import { anchorPixel, planMove } from './motion.ts';
import { DEFAULT_PHYSICS, throwBounds, throwStep, throwStepRegion, throwSpace, screenOfBox } from './physics.ts';
import { HIT_BOX } from './constants.ts';
import type { PhysicsParams, Rect } from './types.ts';

const MAIN: Rect = { x: 0, y: 0, width: 2560, height: 1392 };
const SIDE: Rect = { x: 2560, y: -532, width: 1235, height: 2147 };
const AREAS = [MAIN, SIDE];

/** Measured pet geometry: Baseline pet of size 462 */
const SIZE = 462;
const PET_H = (SIZE * 9) / 16; // 259.875
const SIDE_ALLOW = (HIT_BOX.x0 / 640) * SIZE; // 144.375

const SPACE = throwSpace({ areas: AREAS, size: SIZE, sideAllow: SIDE_ALLOW });

/**
 * The throwing step goes to rest (or reaches the upper limit of the number of steps) and returns to the final state.
 * dt fixed 1/60. space uses dual-screen layout by default and can be overwritten. lockScreen ≥ 0 = Lock this screen
 * (configure the desktop behavior when the root field confineToScreen is turned on).
 */
function settle(
  start: { x: number; y: number; vx: number; vy: number },
  physics: PhysicsParams = DEFAULT_PHYSICS,
  maxSteps = 4000,
  space: ReturnType<typeof throwSpace> = SPACE,
  lockScreen = -1,
): { x: number; y: number; vx: number; vy: number; screen: number; steps: number } {
  let s = { ...start };
  let screen = screenOfBox(space, start.x, start.y);
  for (let i = 0; i < maxSteps; i++) {
    const r = throwStepRegion(s, 1 / 60, space, physics, lockScreen);
    s = { x: r.x, y: r.y, vx: r.vx, vy: r.vy };
    screen = r.screen;
    if (r.atRest) return { ...s, screen, steps: i + 1 };
  }
  return { ...s, screen, steps: maxSteps };
}

/** Is the body (bounding box indented sideAllow) completely covered by a screen = visible to the user */
function bodyVisible(x: number, y: number): boolean {
  const cy = y + PET_H / 2;
  return rectAtPoint(AREAS, x + SIDE_ALLOW, cy) !== null && rectAtPoint(AREAS, x + SIZE - SIDE_ALLOW - 1, cy) !== null;
}

describe('displays ——Union geometry', () => {
  test('The circumscribed rectangle is consistent with the actual measurement and contains 23.7% voids', () => {
    assert.deepEqual(boundingRect(AREAS), { x: 0, y: -532, width: 3795, height: 2147 });
    const ratio = regionHoleRatio(AREAS);
    assert.ok(Math.abs(ratio - 0.237) < 0.001, `hole ratio ${ratio}`);
  });

  test('The holes above/below the home screen do not belong to any monitor', () => {
    assert.equal(rectAtPoint(AREAS, 1000, -100), null); // Right above the home screen
    assert.equal(rectAtPoint(AREAS, 1000, 1500), null); // Right below the home screen
    assert.equal(rectAtPoint(AREAS, 3000, -100), SIDE); // Same height but within the range of secondary screen x: there is a screen
    assert.equal(rectAtPoint(AREAS, 1000, 700), MAIN);
  });

  test('Gap is 0: The next pixel on the right edge of the main screen is the secondary screen', () => {
    assert.equal(indexAtPoint(AREAS, 2559, 700), 0);
    assert.equal(indexAtPoint(AREAS, 2560, 700), 1);
  });

  test('The point in the hole is pulled back to the nearest screen', () => {
    assert.equal(nearestIndex(AREAS, 1000, -100), 0);
    const p = clampPointToRegion(AREAS, 1000, -100);
    assert.ok(rectAtPoint(AREAS, p.x, p.y), 'The clamping result must fall on a certain screen');
    assert.deepEqual(p, { x: 1000, y: 0 });
    // Points already in the union are returned as they are
    assert.deepEqual(clampPointToRegion(AREAS, 3000, -400), { x: 3000, y: -400 });
  });

  test('translateRects moves the screen coordinates to the viewport relative coordinates', () => {
    const hull = boundingRect(AREAS);
    const local = translateRects(AREAS, -hull.x, -hull.y);
    assert.deepEqual(local[0], { x: 0, y: 532, width: 2560, height: 1392 });
    assert.deepEqual(local[1], { x: 2560, y: 0, width: 1235, height: 2147 });
  });
});

describe('throwStepRegion——The cavity is a wall, the screen seam is not', () => {
  test('When using a single screen, it is consistent with throwStep bit by bit.', () => {
    const only = [{ x: 0, y: 0, width: 1920, height: 1080 }];
    const space = throwSpace({ areas: only, size: SIZE, sideAllow: SIDE_ALLOW });
    const bounds = throwBounds({ W: 1920, H: 1080, size: SIZE, sideAllow: SIDE_ALLOW });
    let a = { x: 300, y: 200, vx: 1700, vy: -900 };
    let b = { ...a };
    for (let i = 0; i < 600; i++) {
      const ra = throwStep(a, 1 / 60, bounds, DEFAULT_PHYSICS);
      const rb = throwStepRegion(b, 1 / 60, space, DEFAULT_PHYSICS);
      assert.equal(rb.x, ra.x, `step ${i} x`);
      assert.equal(rb.y, ra.y, `step ${i} y`);
      assert.equal(rb.vx, ra.vx, `step ${i} vx`);
      assert.equal(rb.vy, ra.vy, `step ${i} vy`);
      assert.equal(rb.bounced, ra.bounced, `step ${i} bounced`);
      assert.equal(rb.atRest, ra.atRest, `step ${i} atRest`);
      a = { x: ra.x, y: ra.y, vx: ra.vx, vy: ra.vy };
      b = { x: rb.x, y: rb.y, vx: rb.vx, vy: rb.vy };
    }
  });

  test('Throwing upwards from the main screen: hitting the ceiling of the main screen and rebounding, but not flying into the hole above.', () => {
    let cur = { x: 1000, y: 200, vx: 0, vy: -2500 };
    let minY = Infinity;
    for (let i = 0; i < 240; i++) {
      const r = throwStepRegion(cur, 1 / 60, SPACE, DEFAULT_PHYSICS);
      cur = { x: r.x, y: r.y, vx: r.vx, vy: r.vy };
      minY = Math.min(minY, r.y);
      assert.equal(r.screen, 0, `step ${i} should not leave the home screen`);
    }
    assert.ok(minY >= MAIN.y, `Go to ${minY} and must not cross the upper edge of the main screen work area ${MAIN.y}`);
  });

  test('Swing to the right in the main screen (the height is within the range of the secondary screen): cross the screen seam and enter the secondary screen without being blocked.', () => {
    let cur = { x: 1800, y: 600, vx: 4200, vy: -900 };
    let reachedSide = false;
    for (let i = 0; i < 600 && !reachedSide; i++) {
      const r = throwStepRegion(cur, 1 / 60, SPACE, DEFAULT_PHYSICS);
      cur = { x: r.x, y: r.y, vx: r.vx, vy: r.vy };
      if (r.screen === 1) reachedSide = true;
    }
    assert.ok(reachedSide, 'Pets should be able to fly into the secondary screen (the screen gap is not the wall)');
    // You can play whatever you want after that, but the final impact point must still be visible.
    const end = settle({ x: 1800, y: 600, vx: 4200, vy: -900 });
    assert.ok(bodyVisible(end.x, end.y), `Drop point ${end.x}, ${end.y} must be visible`);
  });

  test('When sewing, the overlapping blind area of the two screens AABB does not jump frame by frame.', () => {
    // x ∈ (main screen maxX, secondary screen minX) This interval is 2× sideAllow wide, and AABB on both screens does
    // not accept it. The writing method of cutting the screen when crossing the boundary will jump back and forth
    // here; the stateless judgment must let the pet pass through at a constant speed.
    const lo = SPACE.bounds[0].maxX;
    const hi = SPACE.bounds[1].minX;
    assert.ok(hi > lo, `The blind area should exist: main screen maxX = ${lo} < secondary screen minX = ${hi}`);
    let cur = { x: lo - 20, y: 600, vx: 600, vy: 0 };
    const noGravity: PhysicsParams = { ...DEFAULT_PHYSICS, gravity: 0 };
    for (let i = 0; i < 40; i++) {
      const r = throwStepRegion(cur, 1 / 60, SPACE, noGravity);
      assert.equal(r.bounced, false, `step ${i} (x = ${r.x | 0}) should not bounce at the screen seam`);
      assert.equal(r.vx, 600, `step ${i} speed should not be changed`);
      cur = { x: r.x, y: r.y, vx: r.vx, vy: r.vy };
    }
    assert.ok(cur.x > hi, `The blind zone should have been passed after 40 frames, actual x = ${cur.x}`);
  });

  test('The secondary screen "extends the upper half of the main screen" is thrown to the left: it bounces off the wall of the cavity and does not fly into the void.', () => {
    // When y =-400, the body center ≈ -270, the main screen y range [0,1392) does not include it ⇒ No screen on the left side ⇒ Bounce
    let cur = { x: 2700, y: -400, vx: -2600, vy: 0 };
    const noGravity: PhysicsParams = { ...DEFAULT_PHYSICS, gravity: 0 };
    let minX = Infinity;
    for (let i = 0; i < 60; i++) {
      const r = throwStepRegion(cur, 1 / 60, SPACE, noGravity);
      cur = { x: r.x, y: r.y, vx: r.vx, vy: r.vy };
      minX = Math.min(minX, r.x);
      assert.ok(bodyVisible(r.x, r.y), `step ${i}: ${r.x | 0}, ${r.y | 0} flew into the void`);
    }
    assert.ok(
      minX >= SPACE.bounds[1].minX,
      `The far left is ${minX}, and must not cross the left boundary of the secondary screen ${SPACE.bounds[1].minX}`,
    );
  });

  test('Throw it randomly 200 times in any direction, and the landing point is always visible (the old implementation will fall into the hole)', () => {
    let rng = 20260910;
    const rand = (): number => (rng = (rng * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let i = 0; i < 200; i++) {
      const fromSide = rand() < 0.5;
      const a = fromSide ? SIDE : MAIN;
      const x = a.x + rand() * (a.width - SIZE);
      const y = a.y + rand() * (a.height - PET_H);
      const end = settle({ x, y, vx: (rand() - 0.5) * 7000, vy: (rand() - 0.5) * 7000 });
      assert.ok(
        bodyVisible(end.x, end.y),
        `The ${i}th time: starting point ${x | 0}, ${y | 0} → landing point ${end.x | 0}, ${end.y | 0} invisible`,
      );
    }
  });

  test('When ceilingBounce = false the top can still fly out, but only on the side with the screen', () => {
    const noCeil: PhysicsParams = { ...DEFAULT_PHYSICS, ceilingBounce: false };
    const end = settle({ x: 1000, y: 100, vx: 0, vy: -3000 }, noCeil);
    assert.ok(bodyVisible(end.x, end.y), `The landing point ${end.x}, ${end.y} must return to the visible area`);
  });
});

describe('throwStepRegion - The taskbar strip is not a wall, the hole is still a wall (panel detection)', () => {
  // Dual screens are stacked up and down, and the taskbar is at the bottom of the upper screen (height 48): the upper
  // screen workArea bottom 1392 ≠ the lower screen top 1440, and there is a 48 px strip between the two work areas -
  // it belongs to the upper screen panel and does not belong to any work area.
  const A = { x: 0, y: 0, width: 2560, height: 1392 };
  const B = { x: 0, y: 1440, width: 2560, height: 1392 };
  const AREAS_TB = [A, B];
  const PANELS_TB = [
    { x: 0, y: 0, width: 2560, height: 1440 },
    { x: 0, y: 1440, width: 2560, height: 1440 },
  ];
  const SPACE_TB = throwSpace({ areas: AREAS_TB, panels: PANELS_TB, size: SIZE, sideAllow: SIDE_ALLOW });

  test('Swinging down can pass through the taskbar strip and fall to the lower screen', () => {
    let cur = { x: 1000, y: 800, vx: 0, vy: 1300 };
    let reachedBottom = false;
    for (let i = 0; i < 900 && !reachedBottom; i++) {
      const r = throwStepRegion(cur, 1 / 60, SPACE_TB, DEFAULT_PHYSICS);
      cur = { x: r.x, y: r.y, vx: r.vx, vy: r.vy };
      if (r.screen === 1) reachedBottom = true;
    }
    assert.ok(reachedBottom, 'Should drop through the taskbar strip to the lower screen');
    const end = settle({ x: 1000, y: 800, vx: 0, vy: 1300 }, DEFAULT_PHYSICS, 2400, SPACE_TB);
    assert.equal(end.screen, 1, 'Finally, it should rest on the lower screen');
    assert.ok(
      end.y <= B.y + B.height - PET_H + 0.001 && end.y >= B.y,
      `The drop point ${end.y} should be in the lower screen (attached to the bottom of the lower screen work area)`,
    );
  });

  test('Swinging upward can fly through the taskbar strip and into the upper screen', () => {
    let cur = { x: 1000, y: 2100, vx: 0, vy: -2300 };
    let reachedTop = false;
    for (let i = 0; i < 900 && !reachedTop; i++) {
      const r = throwStepRegion(cur, 1 / 60, SPACE_TB, DEFAULT_PHYSICS);
      cur = { x: r.x, y: r.y, vx: r.vx, vy: r.vy };
      if (r.screen === 0) reachedTop = true;
    }
    assert.ok(reachedTop, 'Should fly through the taskbar strip into the upper screen');
  });

  test('Same layout but not passing panels (degraded): taskbar strip is still a wall (old behavior)', () => {
    const spaceNoPanels = throwSpace({ areas: AREAS_TB, size: SIZE, sideAllow: SIDE_ALLOW });
    let cur = { x: 1000, y: 800, vx: 0, vy: 1300 };
    let reachedBottom = false;
    for (let i = 0; i < 400 && !reachedBottom; i++) {
      const r = throwStepRegion(cur, 1 / 60, spaceNoPanels, DEFAULT_PHYSICS);
      cur = { x: r.x, y: r.y, vx: r.vx, vy: r.vy };
      if (r.screen === 1) reachedBottom = true;
    }
    assert.equal(
      reachedBottom,
      false,
      'Taskbar strip should be treated as wall when there is no panels (old behavior)',
    );
    assert.ok(cur.y <= A.y + A.height - PET_H + 1, `Should stop above the taskbar, actual ${cur.y}`);
  });

  test('Single screen + bottom taskbar: Panel detection does not cause infinite fall, but still rebounds at the bottom of the work area', () => {
    const onlyPanel = [{ x: 0, y: 0, width: 2560, height: 1440 }];
    const onlyArea = [{ x: 0, y: 0, width: 2560, height: 1392 }];
    const sp = throwSpace({ areas: onlyArea, panels: onlyPanel, size: SIZE, sideAllow: SIDE_ALLOW });
    const end = settle({ x: 1000, y: 500, vx: 0, vy: 900 }, DEFAULT_PHYSICS, 2400, sp);
    assert.equal(end.screen, 0);
    assert.ok(
      end.y <= onlyArea[0].height - PET_H + 1,
      `It should stop above the taskbar (bottom of the work area), actual y = ${end.y}`,
    );
  });

  test('T shaped layout (with panels but still the same shape as the work area): the void is still a wall', () => {
    // Home screen (no taskbar) panel == workspace: The detection results are consistent with the old behavior, and there is no screen in the empty areas.
    const sp = throwSpace({ areas: AREAS, panels: AREAS, size: SIZE, sideAllow: SIDE_ALLOW });
    let cur = { x: 2700, y: -400, vx: -2600, vy: 0 };
    const noGravity: PhysicsParams = { ...DEFAULT_PHYSICS, gravity: 0 };
    let minX = Infinity;
    for (let i = 0; i < 60; i++) {
      const r = throwStepRegion(cur, 1 / 60, sp, noGravity);
      cur = { x: r.x, y: r.y, vx: r.vx, vy: r.vy };
      minX = Math.min(minX, r.x);
    }
    assert.ok(minX >= sp.bounds[1].minX, `The side of the cavity must still be a wall, the far left ${minX}`);
  });
});

describe('anchorPixel / planMove - Corners and roaming do not enter holes', () => {
  test('The corner will fall into the hole when calculated by the enclosing rectangle (old behavior), and it will fall into the main screen when calculated by the main screen.', () => {
    const hull = boundingRect(AREAS);
    const common = { corner: 'top-left' as const, marginX: 24, marginY: 24, size: SIZE, W: hull.width, H: hull.height };
    // Old behavior: based on the bounding rectangle (starting at viewport coordinates 0,0) - converted back to screen coordinates is y = -532 + 24
    const old = anchorPixel(common);
    assert.deepEqual(old, { x: 24, y: 24 });
    assert.equal(
      rectAtPoint(AREAS, old.x + hull.x + SIDE_ALLOW, old.y + hull.y + PET_H / 2),
      null,
      'The old corner is in the cavity',
    );
    // New behavior: transfer home screen workspace
    const fixed = anchorPixel({ ...common, area: MAIN });
    assert.deepEqual(fixed, { x: 24, y: 24 });
    assert.ok(bodyVisible(fixed.x, fixed.y), 'New corners must be visible');
  });

  test('After the four corners are uploaded to the main screen, they all fall within the main screen.', () => {
    for (const corner of ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const) {
      const p = anchorPixel({ corner, marginX: 24, marginY: 24, size: SIZE, W: 0, H: 0, area: MAIN });
      assert.ok(bodyVisible(p.x, p.y), `${corner} → ${p.x}, ${p.y} is not visible`);
    }
  });

  test('Return to null when the roaming landing point falls in a hole', () => {
    const common = {
      cy: -300, // Height above the main screen: only the secondary screen has pixels on this line
      W: 3795,
      H: 2147,
      minDist: 600,
      maxDist: 600,
      margin: 24,
      halfW: SIZE / 2,
      sideAllow: SIDE_ALLOW,
      areas: AREAS,
    };
    // Go left 600 from the secondary screen: you will go out of the left edge of the secondary screen and enter the hole ⇒ Unreachable
    assert.equal(planMove({ ...common, cx: 2900, dir: -1 }), null);
    // Go right 600 and still in the secondary screen ⇒ Reachable
    assert.ok(planMove({ ...common, cx: 2900, dir: 1 }));
  });

  test('Cross-screen roaming at the same height is allowed (there are screens on both sides of the screen gap, so you can walk across it)', () => {
    const plan = planMove({
      cx: 2300,
      cy: 700, // Both the main screen and the secondary screen cover this line
      W: 3795,
      H: 2147,
      dir: 1,
      minDist: 500,
      maxDist: 500,
      margin: 24,
      halfW: SIZE / 2,
      sideAllow: SIDE_ALLOW,
      areas: AREAS,
    });
    assert.ok(plan, 'Cross-screen roaming should not be blocked by screen gaps');
    assert.ok(Math.abs(plan.targetRatio * 3795 - 2800) < 1);
  });

  test('Locking semantics: areas is only given to the current screen ⇒ The step across screens with the same height is rejected', () => {
    // The same starting point/distance/direction as the previous one: it will span to the secondary screen under union, and it must be rejected when it is only given to the main screen.
    const common = {
      cx: 2300,
      cy: 700, // Both the main screen and the secondary screen cover this line
      W: 3795,
      H: 2147,
      minDist: 500,
      maxDist: 500,
      margin: 24,
      halfW: SIZE / 2,
      sideAllow: SIDE_ALLOW,
    };
    assert.ok(planMove({ ...common, dir: 1, areas: AREAS }), 'Union: Which step can be reached across screens?');
    assert.equal(
      planMove({ ...common, dir: 1, areas: [MAIN] }),
      null,
      'Lock the home screen: the cross-screen step must be rejected',
    );
    // Locked ≠ Movement prohibited: small steps within the same screen can still be reached
    assert.ok(
      planMove({ ...common, cx: 800, dir: 1, areas: [MAIN] }),
      'Lock the home screen: movements within the screen are not affected',
    );
    // The "current screen" is locked instead of the main screen: the drop point falls on the secondary screen ⇒ It can be reached in the same step when locking the secondary screen
    assert.ok(
      planMove({ ...common, dir: 1, areas: [SIDE] }),
      'Lock the secondary screen: the landing point is within the secondary screen ⇒ Reachable',
    );
  });

  test('When areas is not passed, it degrades to the old single rectangle judgment.', () => {
    const base = {
      cx: 500,
      cy: 500,
      W: 1920,
      H: 1080,
      minDist: 300,
      maxDist: 300,
      margin: 24,
      halfW: SIZE / 2,
      sideAllow: SIDE_ALLOW,
    };
    assert.ok(planMove({ ...base, dir: 1 }));
    assert.equal(planMove({ ...base, cx: 100, dir: -1 }), null);
  });
});

describe('throwStepRegion —— confineToScreen: After locking the screen, the screen seam also acts as a wall', () => {
  // The starting point is "1 px within the edge of the screen + initial velocity towards the seam": one step will cross the boundary, and the bifurcation of release/rebound can be clearly seen.
  const overMainEdge = { x: SPACE.bounds[0].maxX - 1, y: 300, vx: 900, vy: 0 };
  const overSideEdge = { x: SPACE.bounds[1].minX + 1, y: 300, vx: -900, vy: 0 };

  test('Unlocked: There is a screen outside the seam ⇒ Release as is (status quo remains unchanged)', () => {
    const right = throwStepRegion(overMainEdge, 1 / 60, SPACE, DEFAULT_PHYSICS);
    assert.ok(right.x > SPACE.bounds[0].maxX, `Should cross the right edge of the main screen: x = ${right.x}`);
    assert.ok(right.vx > 0, `The lateral speed must not be reversed: vx = ${right.vx}`);
    const left = throwStepRegion(overSideEdge, 1 / 60, SPACE, DEFAULT_PHYSICS);
    assert.ok(left.x < SPACE.bounds[1].minX, `Should cross the left edge of the secondary screen: x = ${left.x}`);
    assert.ok(left.vx < 0, `The lateral speed must not be reversed: vx = ${left.vx}`);
  });

  test('Lock the main screen: The same initial velocity is bounced from the right edge of the main screen, and the screen ownership remains unchanged.', () => {
    const r = throwStepRegion(overMainEdge, 1 / 60, SPACE, DEFAULT_PHYSICS, 0);
    assert.equal(r.x, SPACE.bounds[0].maxX);
    assert.ok(r.vx < 0, `The lateral speed should be reversed: vx = ${r.vx}`);
    assert.equal(r.screen, 0);
    assert.equal(r.bounced, true);
  });

  test('Lock the secondary screen: the left edge of the secondary screen also acts as a wall (cannot fly back to the main screen)', () => {
    const r = throwStepRegion(overSideEdge, 1 / 60, SPACE, DEFAULT_PHYSICS, 1);
    assert.equal(r.x, SPACE.bounds[1].minX);
    assert.ok(r.vx > 0, `The lateral speed should be reversed: vx = ${r.vx}`);
    assert.equal(r.screen, 1);
  });

  test('Lock index out of bounds (unplug the monitor during flight) → return without locking', () => {
    const r = throwStepRegion(overMainEdge, 1 / 60, SPACE, DEFAULT_PHYSICS, 2);
    assert.ok(r.x > SPACE.bounds[0].maxX, `Out-of-bounds index cannot be used as a wall: x = ${r.x}`);
    assert.ok(r.vx > 0);
  });

  test('Single screen: locked and unlocked are consistent bit by bit (locking has no side effect on a single screen)', () => {
    const only = [{ x: 0, y: 0, width: 1920, height: 1080 }];
    const space = throwSpace({ areas: only, size: SIZE, sideAllow: SIDE_ALLOW });
    let a = { x: 300, y: 200, vx: 1700, vy: -900 };
    let b = { ...a };
    for (let i = 0; i < 600; i++) {
      const ra = throwStepRegion(a, 1 / 60, space, DEFAULT_PHYSICS);
      const rb = throwStepRegion(b, 1 / 60, space, DEFAULT_PHYSICS, 0);
      assert.equal(rb.x, ra.x, `step ${i} x`);
      assert.equal(rb.y, ra.y, `step ${i} y`);
      assert.equal(rb.vx, ra.vx, `step ${i} vx`);
      assert.equal(rb.vy, ra.vy, `step ${i} vy`);
      a = { x: ra.x, y: ra.y, vx: ra.vx, vy: ra.vy };
      b = { x: rb.x, y: rb.y, vx: rb.vx, vy: rb.vy };
      if (ra.atRest) break;
    }
  });

  test('Lock the home screen: Swing it to the right with all your strength, without crossing the screen gap and the landing point is visible', () => {
    const end = settle({ x: 2000, y: 300, vx: 3000, vy: 0 }, DEFAULT_PHYSICS, 4000, SPACE, 0);
    assert.ok(end.x <= SPACE.bounds[0].maxX + 1e-6, `Do not cross the right edge of the main screen: x = ${end.x}`);
    assert.equal(end.screen, 0);
    assert.ok(bodyVisible(end.x, end.y), `The drop point must be visible: ${end.x}, ${end.y}`);
  });
});

// #193: Mac pet position is disordered after locking/closing the screen (closing the cover). One of the root causes is
// that relayout() directly clamps the "relative coordinates of the old viewport" as the "relative coordinates of the
// new viewport" - after the viewport origin is translated with the display topology, the pet is misjudged to have
// crossed the boundary and is clamped to the nearest edge of the screen. The clamping result is written back to
// customPos, so it drifts every time it is opened and closed. rebaseCenter uses world coordinate conservation to fix
// it.
//
// Layout (laptop + external large screen on the left, consistent with the issue reporter): Built-in main screen
// workArea 0,0 1512×982 External secondary screen workArea −2560,0 2560×1392 (on the left side of the main screen, so
// when connected externally, the origin of hull is −2560)
describe('rebaseCenter - Maintain world coordinates after display topology changes (#193)', () => {
  const BUILTIN: Rect = { x: 0, y: 0, width: 1512, height: 982 };
  const EXTERNAL: Rect = { x: -2560, y: 0, width: 2560, height: 1392 };
  /** Before closing the cover: both screens are present (viewport origin = hull upper left corner = upper left corner of the external screen) */
  const VIEW_AB: { x: number; y: number } = { x: -2560, y: 0 };
  /** After closing the cover: only the built-in screen remains (the viewport origin returns to 0,0) */
  const VIEW_B: { x: number; y: number } = { x: 0, y: 0 };

  /** Screen coordinates → Specify the relative coordinates of the viewport (the areas parameter of rebaseCenter requires the relative coordinates of the new viewport) */
  const inView = (r: Rect, view: { x: number; y: number }): Rect => ({
    ...r,
    x: r.x - view.x,
    y: r.y - view.y,
  });
  /** Viewport relative coordinates → world coordinates (screen coordinates) */
  const toWorld = (p: { x: number; y: number }, view: { x: number; y: number }) => ({
    x: p.x + view.x,
    y: p.y + view.y,
  });
  const AREAS_AB = [inView(BUILTIN, VIEW_AB), inView(EXTERNAL, VIEW_AB)];
  const AREAS_B = [inView(BUILTIN, VIEW_B)];

  test('Close the cover (the secondary screen disappears): the pet world coordinates on the main screen remain unchanged.', () => {
    const world = { x: 756, y: 491 }; // Built-in screen center
    const local = { x: world.x - VIEW_AB.x, y: world.y - VIEW_AB.y };
    const moved = rebaseCenter(local, VIEW_AB, VIEW_B, AREAS_B);
    assert.deepEqual(moved, world, 'Topology changes must not change the true location of the pet');
  });

  test('Close and then open the cover (A → B → A): After the round trip, the center world coordinates are consistent with the starting point bit by bit.', () => {
    const world = { x: 1000, y: 600 };
    const a = { x: world.x - VIEW_AB.x, y: world.y - VIEW_AB.y };
    const b = rebaseCenter(a, VIEW_AB, VIEW_B, AREAS_B);
    const back = rebaseCenter(b, VIEW_B, VIEW_AB, AREAS_AB);
    assert.deepEqual(
      toWorld(back, VIEW_AB),
      world,
      `No drift in round trip: ${JSON.stringify(toWorld(back, VIEW_AB))}`,
    );
  });

  test('The viewport has not changed (zoom/resolution has changed but the origin is consistent with the screen set): return as is', () => {
    const world = { x: 1000, y: 600 };
    const local = { x: world.x - VIEW_AB.x, y: world.y - VIEW_AB.y };
    assert.deepEqual(rebaseCenter(local, VIEW_AB, VIEW_AB, AREAS_AB), local);
  });

  test('The secondary screen is unplugged and the pet is on the secondary screen: clip to the visible edge of the nearest screen instead of flying away', () => {
    const world = { x: -1280, y: 696 }; // Center of external screen (on the left side of main screen)
    const local = { x: world.x - VIEW_AB.x, y: world.y - VIEW_AB.y };
    const moved = rebaseCenter(local, VIEW_AB, VIEW_B, AREAS_B);
    // The nearest screen = built-in screen: world coordinate −1280 is closest to its left edge 0, so it is clamped to the left edge; y is already within [0,982)
    assert.deepEqual(moved, { x: 0, y: 696 });
  });

  test('Control group: directly treating the relative coordinates of the old viewport as new coordinates (old implementation) will misjudge out-of-bounds', () => {
    // The relative coordinates of the center of the main screen in the old viewport are x =3316, which far exceeds the new viewport width of 1512 - this is the source of misjudgment
    const stale = clampPointToRegion(AREAS_B, 3316, 491);
    assert.equal(
      stale.x,
      BUILTIN.width - 1,
      'The old implementation will inevitably clip the pet that is still in the screen to the right edge.',
    );
  });
});
