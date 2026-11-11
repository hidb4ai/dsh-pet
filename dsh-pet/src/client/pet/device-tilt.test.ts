/**
 * Unit test for somatosensory conversion: verify trigonometric function mapping, dead zone, horizontal screen
 * rotation, shake strength/direction, and permission application only asks for which sensor is used.
 *
 * Only pure functions and injectable global objects - real sensors and events subscribe to devices - are tested and
 * are not covered here.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  requestMotionPermission,
  SHAKE_THRESHOLD,
  shakeImpulse,
  TILT_DEAD_ZONE_DEG,
  tiltGravity,
  type TiltSample,
} from './device-tilt.ts';

const FLAT: TiltSample = { beta: 0, gamma: 0 };

describe('tiltGravity - tilt angle to gravity vector', () => {
  test('No tilt → zero vector', () => {
    assert.deepEqual(tiltGravity(FLAT, FLAT, 1400), { gx: 0, gy: 0 });
  });

  test('In the dead zone → zero vector (trembling hands should not keep pets sliding)', () => {
    const near: TiltSample = { beta: TILT_DEAD_ZONE_DEG - 0.5, gamma: TILT_DEAD_ZONE_DEG - 0.5 };
    assert.deepEqual(tiltGravity(near, FLAT, 1400), { gx: 0, gy: 0 });
  });

  test('Tilt left and right 30° → horizontal component is half of gravity', () => {
    const out = tiltGravity({ beta: 0, gamma: 30 }, FLAT, 1400);
    assert.ok(Math.abs(out.gx - 700) < 1e-9, `Should be 700, actual ${out.gx}`);
    assert.equal(out.gy, 0);
  });

  test('Vertical 90° → Take full gravity (the configuration value is the upper limit)', () => {
    const out = tiltGravity({ beta: 90, gamma: 0 }, FLAT, 1400);
    assert.ok(Math.abs(out.gy - 1400) < 1e-9, `Should be 1400, actual ${out.gy}`);
  });

  test('Horizontal screen (screen angle 90°) → the axis needs to be changed', () => {
    const out = tiltGravity({ beta: 0, gamma: 30 }, FLAT, 1400, 90);
    assert.ok(
      Math.abs(out.gx) < 1e-9,
      `The horizontal tilt should not go to gx when the screen is in landscape orientation, but actually ${out.gx}`,
    );
    assert.ok(Math.abs(out.gy + 700) < 1e-9, `Should be -700, actual ${out.gy}`);
  });

  test('Gravity is 0 or negative → zero vector (no acceleration will be generated out of thin air)', () => {
    assert.deepEqual(tiltGravity({ beta: 30, gamma: 30 }, FLAT, 0), { gx: 0, gy: 0 });
    assert.deepEqual(tiltGravity({ beta: 30, gamma: 30 }, FLAT, -100), { gx: 0, gy: 0 });
  });

  test('When the baseline spans ±90°, the nearest angle difference is taken and does not reverse.', () => {
    const out = tiltGravity({ beta: 0, gamma: -89 }, { beta: 0, gamma: 89 }, 1400);
    assert.ok(out.gx > 0, `Across ±90 it should still point to the same side, actual ${out.gx}`);
  });
});

describe('shakeImpulse——The impulse of shaking', () => {
  test('Below threshold → null', () => {
    assert.equal(shakeImpulse(SHAKE_THRESHOLD - 1, 0, 0, 1), null);
    assert.equal(shakeImpulse(0, 0, 0, 1), null);
  });

  test('Only vertical direction (horizontal direction is zero) → null (direction is not available, no random throwing)', () => {
    assert.equal(shakeImpulse(0, 0, 100, 1), null);
  });

  test('The direction is consistent with the swing direction (along the lateral/longitudinal acceleration vector)', () => {
    const out = shakeImpulse(30, 40, 0, 1);
    assert.ok(out);
    assert.ok(out.vx > 0 && out.vy > 0);
    assert.ok(Math.abs(out.vy / out.vx - 40 / 30) < 1e-9, 'Orientation should be 3:4');
  });

  test('Velocity = Base × throwPower', () => {
    const once = shakeImpulse(30, 40, 0, 1);
    const twice = shakeImpulse(30, 40, 0, 2);
    assert.ok(once && twice);
    assert.ok(Math.abs(twice.vx - once.vx * 2) < 1e-9, 'Doubling the total force should double the impulse');
    assert.ok(Math.abs(twice.vy - once.vy * 2) < 1e-9);
  });

  test('The greater the acceleration, the greater the force, but there is an upper limit.', () => {
    const soft = shakeImpulse(20, 0, 0, 1);
    const hard = shakeImpulse(100, 0, 0, 1);
    const insane = shakeImpulse(10000, 0, 0, 1);
    assert.ok(soft && hard && insane);
    assert.ok(hard.vx > soft.vx, 'Greater acceleration should be stronger');
    assert.equal(hard.vx, insane.vx, 'No more increase after exceeding the cap');
  });
});

/** Temporarily install a fake sensor constructor (emulating iOS 13+'s requestPermission); return the undo function. */
function stubSensorGlobals(stubs: Record<string, unknown>): () => void {
  const previous = new Map<string, unknown>();
  for (const [key, value] of Object.entries(stubs)) {
    previous.set(key, Reflect.get(globalThis, key));
    Reflect.set(globalThis, key, value);
  }
  return () => {
    for (const [key, value] of previous) Reflect.set(globalThis, key, value);
  };
}

/** Create a fake constructor that will record what kind of question was asked and return the specified result. */
function fakeCtor(label: string, asked: string[], answer: string): { requestPermission: () => Promise<string> } {
  return {
    requestPermission: async () => {
      asked.push(label);
      return answer;
    },
  };
}

describe('requestMotionPermission —— Just ask about the useful type', () => {
  test('Only open tilt: only apply for deviceorientation', async () => {
    const asked: string[] = [];
    const restore = stubSensorGlobals({
      DeviceOrientationEvent: fakeCtor('tilt', asked, 'granted'),
      DeviceMotionEvent: fakeCtor('shake', asked, 'granted'),
    });
    try {
      assert.equal(await requestMotionPermission({ tilt: true, shake: false }), true);
      assert.deepEqual(asked, ['tilt']);
    } finally {
      restore();
    }
  });

  test('Only open shake: only apply for devicemotion', async () => {
    const asked: string[] = [];
    const restore = stubSensorGlobals({
      DeviceOrientationEvent: fakeCtor('tilt', asked, 'granted'),
      DeviceMotionEvent: fakeCtor('shake', asked, 'granted'),
    });
    try {
      assert.equal(await requestMotionPermission({ tilt: false, shake: true }), true);
      assert.deepEqual(asked, ['shake']);
    } finally {
      restore();
    }
  });

  test('Both are off: no application for any permissions, direct success', async () => {
    const asked: string[] = [];
    const restore = stubSensorGlobals({
      DeviceOrientationEvent: fakeCtor('tilt', asked, 'denied'),
      DeviceMotionEvent: fakeCtor('shake', asked, 'denied'),
    });
    try {
      assert.equal(await requestMotionPermission({ tilt: false, shake: false }), true);
      assert.deepEqual(asked, []);
    } finally {
      restore();
    }
  });

  test('Either one is rejected → false', async () => {
    const asked: string[] = [];
    const restore = stubSensorGlobals({
      DeviceOrientationEvent: fakeCtor('tilt', asked, 'granted'),
      DeviceMotionEvent: fakeCtor('shake', asked, 'denied'),
    });
    try {
      assert.equal(await requestMotionPermission({ tilt: true, shake: true }), false);
      assert.deepEqual(asked, ['tilt', 'shake'], 'You need to ask both questions before drawing a conclusion.');
    } finally {
      restore();
    }
  });

  test('Event type does not exist (HTTP non-security context) → false', async () => {
    const restore = stubSensorGlobals({ DeviceOrientationEvent: undefined, DeviceMotionEvent: undefined });
    try {
      assert.equal(await requestMotionPermission({ tilt: true, shake: true }), false);
    } finally {
      restore();
    }
  });
});
