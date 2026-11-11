/**
 * Boundary collision reporting and four-way contact of projectile single step: verify "which side it hits", "speed
 * before collision", and the wall/top also has friction.
 *
 * hit only serves touch and intensity conversion; contacts and atRest determine when to freeze the frame. New use
 * cases uniformly turn off gravity or take integer values to avoid floating point noise interfering with assertions.
 *
 * Running method: node --experimental-strip-types --test src/shared/physics/throw.test.ts
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { throwBounds, throwStep } from './throw.ts';
import { DEFAULT_PHYSICS } from './constants.ts';

/** 800×600 viewport, 100 px wide pet: maxX = 700, maxY = 600 - 56.25. */
const BOUNDS = throwBounds({ W: 800, H: 600, size: 100, sideAllow: 0 });

/** No gravity: Only the contact solution itself is tested, and the gravity increment is not allowed to be mixed into the expected value. */
const NO_GRAVITY = { gx: 0, gy: 0 };

/** Floating point approximation assertion: Bitwise equality turns a binary error of 0.78 into false red. */
const near = (actual: number, expected: number, message: string): void => {
  assert.ok(Math.abs(actual - expected) < 1e-6, `${message} (expected ${expected}, actual ${actual})`);
};

describe('throwStep —— hit reported', () => {
  test('No edge collision: hit is null', () => {
    const res = throwStep({ x: 300, y: 300, vx: 0, vy: 0 }, 1 / 60, BOUNDS, DEFAULT_PHYSICS);
    assert.equal(res.hit, null);
  });

  test('Hitting the left wall: edge = left, speed = horizontal velocity before impact', () => {
    const res = throwStep({ x: 1, y: 100, vx: -500, vy: 0 }, 0.01, BOUNDS, DEFAULT_PHYSICS);
    assert.deepEqual(res.hit, { edge: 'left', speed: 500 });
  });

  test('Hitting the right wall: edge = right', () => {
    const res = throwStep({ x: 699, y: 100, vx: 500, vy: 0 }, 0.01, BOUNDS, DEFAULT_PHYSICS);
    assert.deepEqual(res.hit, { edge: 'right', speed: 500 });
  });

  test('Landing: edge = floor, speed is the vertical speed before hitting the ground (including the gravity of this step)', () => {
    const res = throwStep({ x: 100, y: 540, vx: 0, vy: 600 }, 0.02, BOUNDS, DEFAULT_PHYSICS);
    assert.equal(res.hit?.edge, 'floor');
    assert.ok((res.hit?.speed ?? 0) > 600, `Gravity increment should be included, actual ${res.hit?.speed}`);
  });

  test('Ceiling collision: report ceiling when ceilingBounce is enabled, including gravity from this step', () => {
    const res = throwStep({ x: 100, y: 1, vx: 0, vy: -500 }, 0.01, BOUNDS, DEFAULT_PHYSICS);
    // Integrate gravity first and then determine the boundary: -500 + 1400×0.01 = -486
    assert.deepEqual(res.hit, { edge: 'ceiling', speed: 486 });
  });

  test('Top hit: ceilingBounce has no boundary when closed and will not be reported.', () => {
    const physics = { ...DEFAULT_PHYSICS, ceilingBounce: false };
    const res = throwStep({ x: 100, y: 1, vx: 0, vy: -500 }, 0.01, BOUNDS, physics);
    assert.equal(res.hit, null);
  });

  test('A corner hits two sides at the same time: take the one with greater speed', () => {
    const res = throwStep({ x: 1, y: 540, vx: -5000, vy: 600 }, 0.01, BOUNDS, DEFAULT_PHYSICS);
    assert.equal(res.hit?.edge, 'left');
    assert.equal(res.hit?.speed, 5000);
  });
});

describe('throwStep —— Four-way friction and veneer stationary', () => {
  test('Hitting the left wall: vertical velocity is attenuated by tangential friction', () => {
    const res = throwStep({ x: 1, y: 100, vx: -500, vy: 300 }, 0.01, BOUNDS, DEFAULT_PHYSICS, NO_GRAVITY);
    near(res.vx, 390, '水平速度应只按恢复系数反弹');
    near(res.vy, 292.5, '竖直速度应按摩擦衰减');
  });

  test('Hitting the ceiling: Horizontal velocity is attenuated by tangential friction', () => {
    const res = throwStep({ x: 100, y: 1, vx: 300, vy: -500 }, 0.01, BOUNDS, DEFAULT_PHYSICS, NO_GRAVITY);
    near(res.vx, 292.5, '水平速度应按摩擦衰减');
    near(res.vy, 390, '竖直速度应只按恢复系数反弹');
  });

  test('Gravity points upward against the ceiling: atRest is established after the normal direction returns to zero.', () => {
    const res = throwStep({ x: 100, y: 0, vx: 0, vy: 0 }, 1 / 60, BOUNDS, DEFAULT_PHYSICS, { gx: 0, gy: -1400 });
    assert.deepEqual(res.contacts, ['ceiling']);
    assert.equal(res.atRest, true);
  });

  test('Sticking to the wall but still having speed along the wall: atRest is not true', () => {
    const res = throwStep({ x: 0, y: 100, vx: -500, vy: 300 }, 0.01, BOUNDS, DEFAULT_PHYSICS, NO_GRAVITY);
    assert.deepEqual(res.contacts, ['left']);
    assert.equal(res.atRest, false);
  });

  test('Corner touches two sides at the same time: contacts retains all touching edges', () => {
    const res = throwStep({ x: 1, y: 540, vx: -5000, vy: 600 }, 0.01, BOUNDS, DEFAULT_PHYSICS, NO_GRAVITY);
    assert.deepEqual(res.contacts, ['left', 'floor']);
  });

  test('Low speed close to the ground: atRest is consistent with the ground static state before the change', () => {
    const res = throwStep({ x: 300, y: 543.75, vx: 10, vy: 0 }, 1 / 60, BOUNDS, DEFAULT_PHYSICS);
    assert.deepEqual(res.contacts, ['floor']);
    assert.equal(res.atRest, true);
  });
});
