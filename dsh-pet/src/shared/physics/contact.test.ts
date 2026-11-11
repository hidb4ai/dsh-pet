/**
 * Contact surface solution: verify that the four surfaces share the same set of normal/tangential formulas, as well as
 * the sticking threshold and friction direction.
 *
 * The values are all integers that can be verified by hand calculation: dt = 0.5 s, friction 1/ s ⇒ The tangential
 * attenuation is exactly half; the recovery coefficient 0.5 ⇒ The normal direction is also halved.
 *
 * Running method: node --experimental-strip-types --test src/shared/physics/contact.test.ts
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { CONTACT_NORMALS, isRestingOnContacts, resolveContact } from './contact.ts';
import { DEFAULT_PHYSICS } from './constants.ts';

/** Both recovery and friction are taken in half: the outgoing value is exactly half of the incoming value, which is convenient for hand-calculated assertions. */
const PHYSICS = { ...DEFAULT_PHYSICS, restitution: 0.5, groundFriction: 1 };

describe('CONTACT_NORMALS - Normal direction facing away from the contact surface', () => {
  test('Four normal directions: left (+ x ), right (− x ), ceiling (+ y ), ground (− y )', () => {
    assert.deepEqual(CONTACT_NORMALS.left, { nx: 1, ny: 0 });
    assert.deepEqual(CONTACT_NORMALS.right, { nx: -1, ny: 0 });
    assert.deepEqual(CONTACT_NORMALS.ceiling, { nx: 0, ny: 1 });
    assert.deepEqual(CONTACT_NORMALS.floor, { nx: 0, ny: -1 });
  });
});

describe('resolveContact ——Normal rebound, tangential friction', () => {
  test('Landing: The normal direction rebounds according to the recovery coefficient, and the horizontal speed attenuates according to friction.', () => {
    const out = resolveContact({ vx: 60, vy: 200 }, 'floor', PHYSICS, 0.5);
    assert.equal(out.vx, 30);
    assert.equal(out.vy, -100);
    assert.equal(out.normalSpeed, 100);
    assert.equal(out.tangentSpeed, 30);
  });

  test('Hitting the left wall: the vertical speed attenuates according to friction, and the horizontal speed rebounds according to the recovery coefficient', () => {
    const out = resolveContact({ vx: -200, vy: 60 }, 'left', PHYSICS, 0.5);
    assert.equal(out.vx, 100);
    assert.equal(out.vy, 30);
  });

  test('Hitting the right wall: the normal direction is reversed, and the tangential direction maintains the original symbol', () => {
    const out = resolveContact({ vx: 200, vy: 60 }, 'right', PHYSICS, 0.5);
    assert.equal(out.vx, -100);
    assert.equal(out.vy, 30);
  });

  test('Hitting the ceiling: the horizontal speed is attenuated by friction, and the vertical speed rebounds downward.', () => {
    const out = resolveContact({ vx: 60, vy: -200 }, 'ceiling', PHYSICS, 0.5);
    assert.equal(out.vx, 30);
    assert.equal(out.vy, 100);
  });

  test('Normal velocity below sticking threshold: normal returns to zero instead of rebounding', () => {
    const out = resolveContact({ vx: 0, vy: 30 }, 'floor', PHYSICS, 0.5);
    assert.equal(out.normalSpeed, 0);
    assert.equal(out.vy, 0);
  });

  test('Friction is 0: tangential velocity remains unchanged', () => {
    const out = resolveContact({ vx: 60, vy: 200 }, 'floor', { ...PHYSICS, groundFriction: 0 }, 0.5);
    assert.equal(out.vx, 60);
  });
});

describe('isRestingOnContacts - All contact surfaces must be pressed against each other to be considered stationary.', () => {
  test('No contact: false', () => {
    assert.equal(isRestingOnContacts([], { vx: 0, vy: 0 }), false);
  });

  test('Close to the ground and tangentially low speed: true', () => {
    assert.equal(isRestingOnContacts(['floor'], { vx: 10, vy: 0 }), true);
  });

  test('Sticking to the wall but still having speed along the wall: false', () => {
    assert.equal(isRestingOnContacts(['left'], { vx: 0, vy: 30 }), false);
  });

  test('Close to the ground but tangentially exceeds the static threshold: false', () => {
    assert.equal(isRestingOnContacts(['floor'], { vx: 20, vy: 0 }), false);
  });

  test('Two contact surfaces at the corner: if any normal direction is not in contact, it is not considered stationary.', () => {
    assert.equal(isRestingOnContacts(['floor', 'left'], { vx: 10, vy: 0 }), false);
    assert.equal(isRestingOnContacts(['floor', 'left'], { vx: 0.5, vy: 0 }), true);
  });
});
