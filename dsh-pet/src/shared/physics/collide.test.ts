/**
 * Pure decision-making test for pet collision: bounding box conversion, overlap determination, and one elastic
 * separation.
 *
 * Invariants of verify:
 * - Only one separation is counted, no iterative solution is performed; both center coincidence and "separating"
 * return null (otherwise the overlapping frames will bounce repeatedly);
 * - The normal direction is redistributed according to the one-dimensional momentum formula, momentum is conserved,
 * and the mass is ∝ size²; the tangential components are each retained (no tangential friction).
 *
 * Running method: node --experimental-strip-types --test src/shared/physics/collide.test.ts
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { bodyPixelBox, collidePet, overlapPush, rectsOverlap, type PetCollider } from './collide.ts';
import { PET_BOUNCE_E } from './constants.ts';
import { HIT_BOX } from '../constants.ts';

/** Create a pet (top left corner of bounding box + speed + width). */
const pet = (x: number, y: number, vx: number, vy: number, size = 462): PetCollider => ({ x, y, vx, vy, size });

describe('bodyPixelBox - Convert hit box ratio to pixels', () => {
  test('Convert to integer boundary when size =640 (hit box 200/50 → 440/335, converted according to 640×360)', () => {
    const box = bodyPixelBox({ x: 100, y: 200, size: 640, bottomPad: 30 });
    assert.deepEqual(box, {
      left: 100 + HIT_BOX.x0,
      top: 230 + HIT_BOX.y0,
      right: 100 + HIT_BOX.x1,
      bottom: 230 + HIT_BOX.y1,
    });
  });

  test('bottomPad only works in the vertical direction: the horizontal boundary does not move with it', () => {
    const a = bodyPixelBox({ x: 0, y: 0, size: 462, bottomPad: 0 });
    const b = bodyPixelBox({ x: 0, y: 0, size: 462, bottomPad: 40 });
    assert.equal(a.left, b.left);
    assert.equal(a.right, b.right);
    assert.equal(b.top - a.top, 40);
    assert.equal(b.bottom - a.bottom, 40);
  });
});

describe('overlapPush - Geometry rollout when overlapping', () => {
  const r = (left: number, top: number, right: number, bottom: number) => ({ left, top, right, bottom });

  test('No overlap/just on edge → null', () => {
    assert.equal(overlapPush(r(0, 0, 10, 10), r(20, 0, 30, 10)), null);
    assert.equal(overlapPush(r(0, 0, 10, 10), r(10, 0, 20, 10)), null);
  });

  test('When the horizontal overlap is shallower, push it horizontally and give half of each side', () => {
    // Horizontal overlap 4, vertical overlap 8 → Push 2 along x
    assert.deepEqual(overlapPush(r(0, 0, 10, 10), r(6, 2, 16, 12)), { dx: -2, dy: 0 });
  });

  test('Push vertically when vertical overlap is shallower', () => {
    assert.deepEqual(overlapPush(r(0, 0, 10, 10), r(2, 8, 12, 18)), { dx: 0, dy: -1 });
  });
});

describe('rectsOverlap——Intersection determination', () => {
  const r = (left: number, top: number, right: number, bottom: number) => ({ left, top, right, bottom });

  test('Normal intersection → true', () => {
    assert.equal(rectsOverlap(r(0, 0, 10, 10), r(5, 5, 15, 15)), true);
  });

  test('Edges touching each other do not intersect (strictly less than): sharing an edge means they are exactly separated.', () => {
    assert.equal(rectsOverlap(r(0, 0, 10, 10), r(10, 0, 20, 10)), false);
  });

  test('Complete inclusion and complete separation', () => {
    assert.equal(rectsOverlap(r(0, 0, 100, 100), r(10, 10, 20, 20)), true);
    assert.equal(rectsOverlap(r(0, 0, 10, 10), r(20, 20, 30, 30)), false);
  });
});

describe('collidePet - one elastic separation', () => {
  /** One-dimensional momentum conservation check for mass ∝ size ². */
  const momentum = (c: PetCollider, vn: number): number => c.size * c.size * vn;

  test('Center coincidence → null (normal direction cannot be determined, skip this frame)', () => {
    assert.equal(collidePet(pet(0, 0, 100, 0), pet(0, 0, -100, 0)), null);
  });

  test('Separating (relative velocity is negative along the normal direction) → null to avoid repeated triggering of overlapping frames', () => {
    // fly is on the left, hit is on the right, but fly is flying to the left: they are moving away
    assert.equal(collidePet(pet(0, 0, -100, 0), pet(500, 0, 100, 0)), null);
  });

  test('Forward collision: normal velocity is redistributed according to momentum conservation, and the total momentum remains unchanged.', () => {
    const fly = pet(0, 0, 200, 0);
    const hit = pet(500, 0, 0, 0);
    const out = collidePet(fly, hit);
    assert.ok(out, 'Should be judged as a collision');
    // Normal = fly → Direction of hit = + x
    const before = momentum(fly, fly.vx) + momentum(hit, hit.vx);
    const after = momentum(fly, out.fvx) + momentum(hit, out.hvx);
    assert.ok(Math.abs(before - after) < 1e-6, `Momentum should be conserved: ${before} vs ${after}`);
  });

  test('Equal-mass forward collision: close to exchange speed (recovery coefficient 0.995 instead of 1, so slightly smaller than complete exchange)', () => {
    const fly = pet(0, 0, 100, 0);
    const hit = pet(500, 0, 0, 0);
    const out = collidePet(fly, hit);
    assert.ok(out);
    assert.ok(out.fvx >= 0 && out.fvx < 5, `The flying pet should almost stop, but actually ${out.fvx}`);
    assert.ok(
      out.hvx > 95 && out.hvx <= 100,
      `The hit pet should be close to the original speed, but the actual speed is ${out.hvx}`,
    );
  });

  test('Poor quality: the pet’s speed increases even more after being hit (quality ∝ size ²)', () => {
    const out = collidePet(pet(0, 0, 200, 0, 640), pet(500, 0, 0, 0, 320));
    assert.ok(out);
    assert.ok(out.hvx > 200, `The pet should obtain a component exceeding the incident velocity, actual ${out.hvx}`);
  });

  test('Tangential component retained: longitudinal velocity does not change due to transverse collision', () => {
    const fly = pet(0, 0, 200, 37);
    const hit = pet(500, 0, 0, -11);
    const out = collidePet(fly, hit);
    assert.ok(out);
    assert.ok(
      Math.abs(out.fvy - 37) < 1e-9,
      `The flying pet tangential direction should remain 37, the actual value is ${out.fvy}`,
    );
    assert.ok(
      Math.abs(out.hvy - -11) < 1e-9,
      `The tangential direction of the hit pet should remain -11, actual ${out.hvy}`,
    );
  });

  test('impactSpeed is the normal approach speed (tactile intensity is converted according to it)', () => {
    const out = collidePet(pet(0, 0, 120, 0), pet(500, 0, 20, 0));
    assert.ok(out);
    assert.ok(Math.abs(out.impactSpeed - 100) < 1e-9, `Should be 120-20=100, actual ${out.impactSpeed}`);
  });

  test('The recovery coefficient is less than 1: the absolute value of the relative normal velocity is reduced by e', () => {
    const fly = pet(0, 0, 100, 0);
    const hit = pet(500, 0, -100, 0);
    const out = collidePet(fly, hit);
    assert.ok(out);
    const before = Math.abs(fly.vx - hit.vx);
    const after = Math.abs(out.hvx - out.fvx);
    // Separation speed = e × Approach speed
    assert.ok(
      Math.abs(after - e_ratio(before)) < 1e-6,
      `The separation speed should be e × approach speed: ${after} vs ${e_ratio(before)}`,
    );
  });
});

/** Separation velocity for elastic collision: restitution coefficient × approach velocity. */
const e_ratio = (approach: number): number => PET_BOUNCE_E * approach;
