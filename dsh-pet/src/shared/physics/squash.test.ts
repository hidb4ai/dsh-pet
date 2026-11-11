/**
 * Pure decision test for drop crush: impact velocity → crush ratio, and both ends of the Q spring curve with
 * overshoot.
 *
 * Invariants of verify:
 * - landingSquash falls in [ SQ_MAX_SQUASH , 0.8] and does not increase with the impact speed (the greater the speed,
 * the harder the pressure);
 * - squashScale returns to 1 at both ends, the middle section pushes down to squash, and the rebound section brings
 * back about 4% overshoot but no more than 1.12.
 *
 * Running method: node --experimental-strip-types --test src/shared/physics/squash.test.ts
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { landingSquash, squashScale } from './squash.ts';
import { SQ_HARD_SPEED, SQ_MAX_SQUASH, SQ_SOFT_SPEED, SQ_SQUASH } from './constants.ts';

describe('landingSquash ——Impact speed → flattening ratio', () => {
  test('No pressure below the soft threshold: the result stops at the upper bound 0.8 (Math.min clamped)', () => {
    assert.equal(landingSquash(0), 0.8);
    assert.equal(landingSquash(SQ_SOFT_SPEED), 0.8);
    assert.equal(landingSquash(SQ_SOFT_SPEED - 1), 0.8);
  });

  test('Above the hard threshold, press to the flattest level: the result is always SQ_MAX_SQUASH', () => {
    assert.ok(Math.abs(landingSquash(SQ_HARD_SPEED) - SQ_MAX_SQUASH) < 1e-9);
    assert.equal(landingSquash(SQ_HARD_SPEED * 10), SQ_MAX_SQUASH);
  });

  test('Taking the absolute value: landing to the left will be the same as landing to the right.', () => {
    assert.equal(landingSquash(-900), landingSquash(900));
  });

  test('Non-increase with impact speed: greater speed will not cause shallower impact', () => {
    let prev = Infinity;
    for (const speed of [0, 200, 300, 600, 900, 1200, 1500, 2000]) {
      const value = landingSquash(speed);
      assert.ok(
        value <= prev + 1e-12,
        `When speed = ${speed}, ${value} should not be greater than the previous ${prev}`,
      );
      prev = value;
    }
  });

  test('The result always falls in [ SQ_MAX_SQUASH , 0.8]', () => {
    for (const speed of [-5000, -1, 0, 1, 300, 1500, 5000]) {
      const value = landingSquash(speed);
      assert.ok(value >= SQ_MAX_SQUASH && value <= 0.8, `speed = ${speed} → ${value} out of bounds`);
    }
  });
});

describe('squashScale —— Q elastic curve', () => {
  test('Both ends return to 1: no pressure on the starting hand, cleanup recovery', () => {
    assert.equal(squashScale(0), 1);
    assert.ok(Math.abs(squashScale(1) - 1) < 1e-9);
  });

  test('The end of the pressing section (u =0.45) is exactly equal to the squash parameter', () => {
    assert.ok(Math.abs(squashScale(0.45) - SQ_SQUASH) < 1e-9);
    const custom = 0.7;
    assert.ok(Math.abs(squashScale(0.45, custom) - custom) < 1e-9);
  });

  test('The rebound section has about 4% overshoot, but is clamped by 1.12', () => {
    let peak = 0;
    for (let u = 0.45; u <= 1; u += 0.01) peak = Math.max(peak, squashScale(u));
    assert.ok(peak > 1, `Rebound should be overshoot, actual peak value ${peak}`);
    assert.ok(peak <= 1.12, `Overshoot must not exceed 1.12, actual ${peak}`);
  });

  test('The closer squash is to 1, the shallower the pressing (at the same progress)', () => {
    assert.ok(squashScale(0.2, 0.9) > squashScale(0.2, 0.55));
  });
});
