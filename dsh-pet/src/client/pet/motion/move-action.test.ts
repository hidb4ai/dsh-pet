/**
 * Contract test of autonomous position planning (src/client/pet/motion/move-action.ts).
 *
 * Three contracts:
 * 1. There is no movement action, or the name of the playback request is not in the pool → `null` (the caller returns
 * to the original place action);
 * 2. The distance scales proportionally with the size of the pet, and the direction only depends on the direction
 * (right → +1, left → -1);
 * 3. The target crosses the boundary → `null` and will never return to an out-of-bounds landing point.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { planMoveAction, type MoveActionInput } from './move-action.ts';
import { PET_REF_WIDTH } from '../../../shared/constants.ts';
import type { MovesConfig } from '../../../shared/types.ts';

const moves: MovesConfig = {
  default: { minDist: 80, maxDist: 120, margin: 16, leadSec: 0.2, tailSec: 0.3 },
  actions: [{ name: 'walk1' }, { name: 'walk2', params: { maxDist: 200 } }],
} as unknown as MovesConfig;

const base: MoveActionInput = {
  moves,
  facing: 'right',
  size: PET_REF_WIDTH,
  center: { x: 640, y: 400 },
  viewport: { width: 1280, height: 800 },
  halfW: 130,
  sideAllow: 20,
  // Fixed taking the 0th action to avoid random use case drift.
  random: () => 0,
};

describe('planMoveAction——Autonomous position planning', () => {
  test('No movement action: return null', () => {
    assert.equal(planMoveAction({ ...base, moves: { default: {}, actions: [] } as unknown as MovesConfig }), null);
  });

  test('playback request name is not in the pool: return null', () => {
    assert.equal(planMoveAction({ ...base, preferredName: 'nope' }), null);
  });

  test('playback request hit: Use the parameters of that action in the pool (maxDist override takes effect)', () => {
    const action = planMoveAction({ ...base, preferredName: 'walk2' });
    assert.ok(action);
    assert.equal(action.anim, 'walk2');
    // Maximum 200 at base size px: The target scale will not exceed the starting point + 200/viewport width
    assert.ok(action.pending.totalRatio <= 200 / base.viewport.width + 1e-9);
  });

  test('Direction only looks at the direction: right → +1, left → -1', () => {
    const right = planMoveAction({ ...base, preferredName: 'walk1' });
    const left = planMoveAction({ ...base, facing: 'left', preferredName: 'walk1' });
    assert.equal(right?.pending.dir, 1);
    assert.equal(left?.pending.dir, -1);
    assert.ok((left?.pending.targetRatio ?? 0) < (right?.pending.targetRatio ?? 0));
  });

  test('Distance scales proportionally with size: you go further when the size doubles', () => {
    const normal = planMoveAction({ ...base, preferredName: 'walk1', size: PET_REF_WIDTH });
    const big = planMoveAction({ ...base, preferredName: 'walk1', size: PET_REF_WIDTH * 2 });
    assert.ok((big?.pending.totalRatio ?? 0) > (normal?.pending.totalRatio ?? 0));
  });

  test('The target is out of bounds: null is returned, and the out-of-bounds landing point is not returned.', () => {
    // When it is close to the right boundary and there is only 1 px left, the minimum movement of 80 px must cross the boundary.
    const nearEdge = { ...base, center: { x: base.viewport.width - base.halfW - 18, y: 400 } };
    assert.equal(planMoveAction({ ...nearEdge, preferredName: 'walk1' }), null);
  });

  test('The first and last blank spaces are brought out along with the action parameters (required for rAF driver)', () => {
    const action = planMoveAction({ ...base, preferredName: 'walk1' });
    assert.equal(action?.pending.leadSec, 0.2);
    assert.equal(action?.pending.tailSec, 0.3);
  });
});
