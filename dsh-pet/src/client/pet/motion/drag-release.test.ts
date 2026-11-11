/**
 * Contract test for release settlement (src/client/pet/motion/drag-release.ts): the slingshot is given strength
 * according to the pulling distance, and the direction is opposite to the pulling direction; when it is not a
 * slingshot, throw it if the trajectory is fast enough, and put it down when the trajectory is empty or too slow.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_PHYSICS } from '../../../shared/physics/constants.ts';
import { decideRelease, type ReleaseInput } from './drag-release.ts';

/** Reference input: box 200×112.5, pressed in the center, neither pulled nor moved. */
function input(overrides: Partial<ReleaseInput> = {}): ReleaseInput {
  return {
    box: { x: 400, y: 300 },
    anchor: { x: 500, y: 356.25 },
    half: { w: 100, h: 56.25 },
    size: 200,
    sling: false,
    trail: [],
    now: 1000,
    physics: DEFAULT_PHYSICS,
    ...overrides,
  };
}

describe('decideRelease——Put it down in place', () => {
  test('No trajectory or slingshot: put it down in place', () => {
    assert.deepEqual(decideRelease(input()), { kind: 'place' });
  });

  test('The trajectory is too slow: put it down in place', () => {
    const trail = [
      { t: 800, x: 500, y: 356 },
      { t: 900, x: 502, y: 356 },
    ];
    assert.deepEqual(decideRelease(input({ trail })), { kind: 'place' });
  });

  test('The trajectory is too old: treat it as a stop and put it down where it is.', () => {
    const trail = [
      { t: 500, x: 500, y: 356 },
      { t: 520, x: 700, y: 356 },
    ];
    assert.deepEqual(decideRelease(input({ trail, now: 1000 })), { kind: 'place' });
  });
});

describe('decideRelease —— Throw Throw', () => {
  test('Swipe quickly to the right: Take off in the direction of displacement', () => {
    const trail = [
      { t: 950, x: 500, y: 356 },
      { t: 970, x: 600, y: 356 },
      { t: 990, x: 700, y: 356 },
    ];
    const decision = decideRelease(input({ trail }));
    assert.equal(decision.kind, 'throw');
    if (decision.kind !== 'throw') return;
    assert.ok(decision.velocity.vx > 0, `Should fly right: ${decision.velocity.vx}`);
    assert.equal(Math.round(decision.velocity.vy), 0);
  });
});

describe('decideRelease——Slingshot', () => {
  test('The farther you pull, the greater the force, and the direction is opposite to the pulling direction.', () => {
    const near = decideRelease(input({ sling: true, box: { x: 480, y: 340 } }));
    const far = decideRelease(input({ sling: true, box: { x: 300, y: 250 } }));
    assert.equal(near.kind, 'sling');
    assert.equal(far.kind, 'sling');
    if (near.kind !== 'sling' || far.kind !== 'sling') return;
    assert.ok(far.power > near.power, `The force should be greater to pull farther: ${far.power} vs ${near.power}`);
    // Pull to the upper left → fly down to the right.
    assert.ok(far.velocity.vx > 0, `Should fly right: ${far.velocity.vx}`);
    assert.ok(far.velocity.vy > 0, `Should fly downward: ${far.velocity.vy}`);
  });

  test('Let go without pulling away: the strength is 0 and the speed is also 0', () => {
    const decision = decideRelease(input({ sling: true, box: { x: 400, y: 300 } }));
    assert.equal(decision.kind, 'sling');
    if (decision.kind !== 'sling') return;
    assert.equal(decision.dist, 0);
    assert.equal(decision.power, 0);
    assert.deepEqual(decision.velocity, { vx: 0, vy: 0 });
  });

  test('The slingshot does not depend on hand speed: slowly pull it into place and then let go, the speed is still the same', () => {
    const decision = decideRelease(
      input({
        sling: true,
        box: { x: 300, y: 300 },
        trail: [
          { t: 700, x: 300, y: 300 },
          { t: 990, x: 300, y: 300 },
        ],
      }),
    );
    assert.equal(decision.kind, 'sling');
    if (decision.kind !== 'sling') return;
    assert.ok(Math.hypot(decision.velocity.vx, decision.velocity.vy) > 0, 'Slingshot should generate speed');
  });
});
