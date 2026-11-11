/**
 * The contract of pet collision settlement (src/client/pet/motion/pet-collision.ts): calculate the absolute speed
 * once, separate frames only push the position without injecting speed, and return it as it is when there is no
 * overlap. Use the fake station driver and do not touch rAF and DOM.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { createPetCollision, type CollisionMetrics } from './pet-collision.ts';
import type { PetCollisionSlot, ThrowState } from '../../../shared/physics.ts';

const metrics: CollisionMetrics = { size: 200, bottomPad: 0 };

/** Create a station slot: only remember the position, speed and written settlement speed. */
function makeSlot(at: { x: number; y: number }, vel = { vx: 0, vy: 0 }) {
  const applied: Array<{ vx: number; vy: number }> = [];
  const slot: PetCollisionSlot = {
    size: metrics.size,
    bottomPad: metrics.bottomPad,
    getBox: () => at,
    getVel: () => vel,
    applyVelocity: (vx, vy) => applied.push({ vx, vy }),
  };
  return { applied, slot };
}

/** Build a calculator and record the impact speed at the same time. */
function makeResolver(slots: Record<string, PetCollisionSlot>) {
  const impacts: number[] = [];
  const resolve = createPetCollision({
    arena: () => ({ slots }),
    petId: 'me',
    onPetImpact: (speed) => impacts.push(speed),
  });
  return { impacts, resolve };
}

describe('createPetCollision —— Calculate the absolute speed in one go', () => {
  test('Head-on collision: the speed only changes once, and the opponent gets the settlement value instead of the increment.', () => {
    const other = makeSlot({ x: 410, y: 100 }, { vx: -200, vy: 0 });
    const { impacts, resolve } = makeResolver({ other: other.slot });
    const state: ThrowState = { x: 400, y: 100, vx: 800, vy: 0 };

    const out = resolve(state, metrics);

    assert.equal(other.applied.length, 1, 'Only settled once per frame');
    // Equal mass, e = 0.995, normal direction = + x: the other party’s final value is 797.5. If superimposed in increments, 597.5 will be obtained.
    assert.ok(Math.abs(other.applied[0].vx - 797.5) < 0.01, `Absolute speed should be written: ${other.applied[0].vx}`);
    assert.ok(Math.abs(out.vx - -197.5) < 0.01, `The own final value should be reversed: ${out.vx}`);
    assert.equal(impacts.length, 1, 'Report once if hit');
  });

  test('Separating but still overlapping: only pushing position, not writing speed and not reporting impact.', () => {
    const other = makeSlot({ x: 410, y: 100 }, { vx: 100, vy: 0 });
    const { impacts, resolve } = makeResolver({ other: other.slot });

    const out = resolve({ x: 400, y: 100, vx: -100, vy: 0 }, metrics);

    assert.equal(other.applied.length, 0, 'Split frames can no longer inject velocity');
    assert.equal(impacts.length, 0);
    assert.ok(out.x < 400, `You should push yourself away: ${out.x}`);
    assert.equal(out.vx, -100, 'Speed does not change');
  });

  test('No overlap: return the same status as is', () => {
    const other = makeSlot({ x: 1200, y: 100 });
    const { resolve } = makeResolver({ other: other.slot });
    const state: ThrowState = { x: 400, y: 100, vx: 800, vy: 0 };

    assert.equal(resolve(state, metrics), state);
    assert.equal(other.applied.length, 0);
  });

  test('You are the only one in the station: return to the same state as is', () => {
    const self = makeSlot({ x: 400, y: 100 });
    const { resolve } = makeResolver({ me: self.slot });
    const state: ThrowState = { x: 400, y: 100, vx: 800, vy: 0 };

    assert.equal(resolve(state, metrics), state);
    assert.equal(self.applied.length, 0);
  });
});
