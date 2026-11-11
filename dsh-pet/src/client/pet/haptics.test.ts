/**
 * Unit testing for haptic feedback: verify speed threshold, duration mapping and cool down window.
 *
 * Only pure logic is tested: `vibrate` and clock are injected, without touching the real hardware (Node does not
 * contain Vibration API).
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { createHaptics, HAPTIC_COOLDOWN_MS, HAPTIC_MIN_SPEED, pulseMsFor } from './haptics.ts';

describe('pulseMsFor——Speed to single duration', () => {
  test('Lower than the lower limit, not a number → no shock', () => {
    for (const speed of [0, HAPTIC_MIN_SPEED - 1, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.equal(pulseMsFor(speed), null, `Speed ${speed} must not trigger vibration`);
    }
  });

  test('The vibration at the lower limit is the shortest, and the relationship between soft impact and hard impact increases monotonically.', () => {
    assert.equal(pulseMsFor(HAPTIC_MIN_SPEED), 10);
    assert.equal(pulseMsFor(300), 10);
    const mid = pulseMsFor(900);
    assert.ok(mid !== null && mid > 10 && mid < 28, `The medium speed should fall within the range, actual ${mid}`);
    assert.ok((pulseMsFor(2000) ?? 0) > (pulseMsFor(400) ?? 0), 'The faster, the longer');
  });

  test('Exceeded hard anchor point cap 28 ms', () => {
    assert.equal(pulseMsFor(1500), 28);
    assert.equal(pulseMsFor(9000), 28);
  });
});

describe('createHaptics - one pulse per collision', () => {
  /** Fake hardware: record the duration of each call. */
  const fake = () => {
    const calls: number[] = [];
    let clock = 0;
    const haptics = createHaptics({
      vibrate: (ms) => calls.push(ms),
      now: () => clock,
      enabled: () => true,
    });
    return {
      calls,
      haptics,
      advance: (ms: number) => {
        clock += ms;
      },
    };
  };

  test('The same type of impact will only shock once within the cooling window (bounces against the ground will be reported in multiple frames)', () => {
    const f = fake();
    f.haptics.hit('floor', 900);
    f.advance(HAPTIC_COOLDOWN_MS - 1);
    f.haptics.hit('floor', 900);
    assert.deepEqual(f.calls, [pulseMsFor(900)], 'The second time should be swallowed');
    f.advance(2);
    f.haptics.hit('floor', 900);
    assert.equal(f.calls.length, 2, 'After passing the window, you should re-vibrate.');
  });

  test('Different types of impacts have their own cooldowns: hitting a wall will not swallow the ground', () => {
    const f = fake();
    f.haptics.hit('floor', 900);
    f.haptics.hit('left', 900);
    assert.equal(f.calls.length, 2);
  });

  test('The speed is not enough for vibration', () => {
    const f = fake();
    f.haptics.hit('pet', 50);
    assert.deepEqual(f.calls, []);
  });

  test('Completely silent when switch is off', () => {
    const calls: number[] = [];
    const haptics = createHaptics({ vibrate: (ms) => calls.push(ms), now: () => 0, enabled: () => false });
    haptics.hit('floor', 2000);
    assert.deepEqual(calls, []);
  });
});
