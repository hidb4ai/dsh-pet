/**
 * Muzzle velocity conversion unit test of throw command - verify the table in the `POST /throw` document.
 *
 * Why nail it alone: There are two things written into the contract that can easily be changed silently——
 * 1. Angle direction: `0` = straight right, counterclockwise is positive (screen coordinate y is downward, so `vy`
 * takes a negative sign). If it is reversed, the third party will find that "throwing it up" turns into throwing it
 * down, and the code itself will not report any errors;
 * 2. Strength anchor point: `power = 1.0` corresponds to 1200 px/s before soft clamp speed, and the actual initial
 * velocity is about 1021 px/s. Adjust the anchor point or the speed limit formula, and the numbers in the document
 * will become lies.
 *
 * Running method: node --experimental-strip-types --test src/shared/physics.test.ts
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_STEP_DT,
  MAX_THROW_SPEED,
  SUBSTEP_MAX,
  SUBSTEP_PX,
  THROW_SPEED_ANCHOR,
  pullAngle,
  slingshotPower,
  slingshotRefDist,
  slingshotVelocity,
  softClampSpeed,
  throwSubsteps,
  throwVelocity,
} from './physics.ts';

/** Initial velocity (module length of throwVelocity) */
const speedOf = (angle: number, power: number): number => {
  const v = throwVelocity(angle, power);
  return Math.hypot(v.vx, v.vy);
};

describe('throwVelocity - Angle direction (0 = right, counterclockwise is positive)', () => {
  test('0° right: vx > 0 and vy ≈ 0', () => {
    const v = throwVelocity(0, 1);
    assert.ok(v.vx > 0, 'vx should be positive');
    assert.ok(Math.abs(v.vy) < 1e-9, 'vy should be 0');
  });

  test('90° straight up: vy < 0 (screen coordinate y is downward, so take a negative sign) and vx ≈ 0', () => {
    const v = throwVelocity(90, 1);
    assert.ok(v.vy < 0, '90° must be thrown upward——vy is negative');
    assert.ok(Math.abs(v.vx) < 1e-9, 'vx should be 0');
  });

  test('-90° Directly below: vy > 0', () => {
    assert.ok(throwVelocity(-90, 1).vy > 0);
  });

  test('180° right left: vx < 0', () => {
    assert.ok(throwVelocity(180, 1).vx < 0);
  });

  test('Any real number angle is valid (any angle beyond 0~360 is converted according to the period, the caller does not need to normalize itself)', () => {
    const a = throwVelocity(450, 1);
    const b = throwVelocity(90, 1);
    assert.ok(Math.abs(a.vx - b.vx) < 1e-9 && Math.abs(a.vy - b.vy) < 1e-9, '450° should be equivalent to 90°');
  });
});

describe('throwVelocity - Velocity anchor point and soft upper limit', () => {
  test('The actual initial velocity of power = 1.0 ≈ 1021 px/s (before soft clamp speed is 1200)', () => {
    const speed = speedOf(0, 1);
    assert.ok(Math.abs(speed - 1020.5) < 1, `Initial speed should be about 1020.5; got ${speed}`);
    assert.ok(
      speed < THROW_SPEED_ANCHOR,
      'The soft cap must really be lowered - otherwise the table in the document is wrong',
    );
  });

  test('Actual muzzle velocity of power = 3.0 ≈ 2276 px/s', () => {
    assert.ok(Math.abs(speedOf(0, 3) - 2275.6) < 1);
  });

  test('monotonically increases with power, and never exceeds MAX_THROW_SPEED', () => {
    let prev = 0;
    for (const p of [0.001, 0.1, 0.5, 1, 2, 3, 5, 10, 100, 1e6]) {
      const s = speedOf(45, p);
      assert.ok(
        s > prev,
        `The initial velocity of power = ${p} should be strictly greater than the smaller power (monotone distinguishable)`,
      );
      assert.ok(s <= MAX_THROW_SPEED, `The initial velocity of power = ${p} must not exceed the soft upper limit`);
      prev = s;
    }
    assert.ok(
      speedOf(45, 1e6) > MAX_THROW_SPEED * 0.99,
      'Extremely large power should asymptotically approach the soft upper limit',
    );
  });

  test('Decoupling of direction and force: the mold length at any angle is only determined by power', () => {
    const want = speedOf(0, 2);
    for (const angle of [0, 37, 90, -123, 271]) {
      assert.ok(Math.abs(speedOf(angle, 2) - want) < 1e-9, `angle=${angle}`);
    }
  });
});

describe('softClampSpeed —— Throwing command and dragging and throwing share the same speed limit', () => {
  test('Non-positive number → 0 (no reverse speed is generated)', () => {
    assert.equal(softClampSpeed(0), 0);
    assert.equal(softClampSpeed(-100), 0);
  });

  test('Asymptotically does not exceed MAX_THROW_SPEED (take the equal sign for extremely large input, not exceed)', () => {
    assert.ok(softClampSpeed(MAX_THROW_SPEED) < MAX_THROW_SPEED);
    // exp (-1000) underflows to 0 under float64, so the upper limit will be obtained exactly here - the contract is "not to exceed", and equalization is valid.
    assert.equal(softClampSpeed(MAX_THROW_SPEED * 1000), MAX_THROW_SPEED);
  });
});

describe('pullAngle ——The ejection direction is the **opposite direction** of pulling', () => {
  test('Pull to the left → Right (0°, the same set as "0 = Right" of throwVelocity)', () => {
    assert.equal(pullAngle(-100, 0), 0);
    assert.ok(slingshotVelocity(pullAngle(-100, 0), 1).vx > 0);
  });

  test('Pull up → drop down (-90°, vy is positive = screen down)', () => {
    const angle = pullAngle(0, -100);
    assert.ok(Math.abs(angle + 90) < 1e-9, `The angle should be -90°, getting ${angle}`);
    assert.ok(slingshotVelocity(angle, 1).vy > 0, 'To pull up, you must pull down (reverse direction)');
  });

  test('Pull down → bounce up (90°, vy is negative)', () => {
    const angle = pullAngle(0, 100);
    assert.ok(Math.abs(angle - 90) < 1e-9);
    assert.ok(slingshotVelocity(angle, 1).vy < 0);
  });

  test('Pull to the right → flick to the left (180°)', () => {
    assert.ok(Math.abs(Math.abs(pullAngle(100, 0)) - 180) < 1e-9);
    assert.ok(slingshotVelocity(pullAngle(100, 0), 1).vx < 0);
  });

  test('Pull down diagonally to the left → pop up right (vx > 0 and vy < 0)', () => {
    const v = slingshotVelocity(pullAngle(-100, 100), 1);
    assert.ok(v.vx > 0, 'Pull to the left and flick to the right');
    assert.ok(v.vy < 0, 'Pull down to pop up');
  });
});

describe('slingshotPower ——Distance is intensity: linear, monotonic, no upper limit', () => {
  const SIZE = 462;

  test('Draw distance = reference distance → exactly 1 times the force', () => {
    assert.equal(slingshotPower(slingshotRefDist(SIZE), SIZE), 1);
  });

  test('Linear: 2x / 10x draw length = 2x / 10x force', () => {
    const ref = slingshotRefDist(SIZE);
    assert.equal(slingshotPower(ref * 2, SIZE), 2);
    assert.equal(slingshotPower(ref * 10, SIZE), 10);
  });

  test('There is no upper bound: no matter how far the draw distance is, it will not be clamped to 1 (this is exactly the meaning of "give strength according to distance")', () => {
    let prev = 0;
    for (const dist of [1, 10, 100, 1000, 10000, 100000]) {
      const p = slingshotPower(dist, SIZE);
      assert.ok(
        p > prev,
        `The strength of the draw distance ${dist} must be strictly greater than that of the closer draw distance`,
      );
      prev = p;
    }
    assert.ok(
      slingshotPower(slingshotRefDist(SIZE) * 100, SIZE) === 100,
      '100 times the draw distance should be 100 times the strength',
    );
  });

  test('0 / negative number / non-finite / invalid size → 0 (no reverse or NaN velocity generated)', () => {
    for (const dist of [0, -50, NaN, Infinity]) {
      assert.equal(slingshotPower(dist, SIZE), 0, `dist=${dist}`);
    }
    assert.equal(slingshotPower(100, 0), 0, 'size =0 Infinity should not be removed');
  });

  test('The reference distance scales with size: the same draw distance, the small pet is stronger', () => {
    assert.ok(slingshotPower(200, 300) > slingshotPower(200, 600));
  });
});

describe('slingshotVelocity - the same strength anchor point, but does not take the soft upper limit', () => {
  test('power = 1 is 1200 px/s (THROW_SPEED_ANCHOR, not pressed to 1021 by the soft clamp)', () => {
    const v = slingshotVelocity(0, 1);
    assert.ok(Math.abs(Math.hypot(v.vx, v.vy) - THROW_SPEED_ANCHOR) < 1e-9);
    assert.ok(Math.abs(v.vx - THROW_SPEED_ANCHOR) < 1e-9);
  });

  test('power = 5 → 6000 px/s, which can exceed MAX_THROW_SPEED (no upper limit for slingshot)', () => {
    const speed = Math.hypot(slingshotVelocity(0, 5).vx, slingshotVelocity(0, 5).vy);
    assert.equal(speed, THROW_SPEED_ANCHOR * 5);
    assert.ok(
      speed > MAX_THROW_SPEED,
      'The soft clamp speed must really be exceeded - otherwise "no upper limit" is false',
    );
  });

  test('Under the same power, throwVelocity is suppressed, but slingshotVelocity is not suppressed.', () => {
    const clamped = Math.hypot(throwVelocity(0, 10).vx, throwVelocity(0, 10).vy);
    const raw = Math.hypot(slingshotVelocity(0, 10).vx, slingshotVelocity(0, 10).vy);
    assert.ok(clamped < raw);
    assert.ok(Math.abs(raw - THROW_SPEED_ANCHOR * 10) < 1e-9);
  });

  test('physics.throwPower (total strength) linear effect: shares the same configuration with drag and throw', () => {
    const base = Math.hypot(slingshotVelocity(30, 2).vx, slingshotVelocity(30, 2).vy);
    const strong = Math.hypot(slingshotVelocity(30, 2, 2).vx, slingshotVelocity(30, 2, 2).vy);
    assert.equal(strong, base * 2);
  });

  test('Negative power / throwPower are always treated as 0 and are not reversed.', () => {
    assert.deepEqual(slingshotVelocity(45, -3), { vx: 0, vy: 0 });
    assert.deepEqual(slingshotVelocity(45, 1, -2), { vx: 0, vy: 0 });
  });

  test('Decoupling of direction and force: the mold length at any angle is only determined by power', () => {
    const want = Math.hypot(slingshotVelocity(0, 3).vx, slingshotVelocity(0, 3).vy);
    for (const angle of [0, 37, 90, -123, 271]) {
      const v = slingshotVelocity(angle, 3);
      assert.ok(Math.abs(Math.hypot(v.vx, v.vy) - want) < 1e-9, `angle=${angle}`);
    }
  });
});

describe('throwSubsteps ——The subdivision is the integration accuracy, not the upper limit of the intensity.', () => {
  test('Ordinary throwing (displacement per frame ≤ 8 px) → 1 step, bit by bit the same as the old single-step integration', () => {
    assert.equal(throwSubsteps(300, 0, 1 / 60), 1); // 5 px/frame
    assert.equal(throwSubsteps(0, 0, 1 / 60), 1); // Stationary is also 1 step (cannot divide by 0)
  });

  test('High-speed ejection is divided into steps according to the upper limit of single-step displacement.', () => {
    const dt = 1 / 60;
    const speed = 8000;
    assert.equal(throwSubsteps(speed, 0, dt), Math.ceil((speed * dt) / SUBSTEP_PX));
    // Each step of dismantling does not exceed the upper limit.
    const n = throwSubsteps(speed, 0, dt);
    assert.ok((speed * dt) / n <= SUBSTEP_PX);
  });

  test('Upper limit of steps SUBSTEP_MAX fallback (extreme speed will not drag one frame into hundreds of points)', () => {
    assert.equal(throwSubsteps(1e6, 0, 1 / 60), SUBSTEP_MAX);
  });

  test('dt press MAX_STEP_DT to pinch: giant frame and upper limit frame calculate the same number of steps', () => {
    assert.equal(throwSubsteps(1000, 0, 10), throwSubsteps(1000, 0, MAX_STEP_DT));
  });
});
