/**
 * Pure decision-level unit testing of position/throw instructions - the most easily deformed areas in the verify
 * contract:
 *
 * - Coordinate clamping: If it crosses the boundary and clamps to `0~1` , the caller can just get the actual value in
 * the response, and there is no need to calculate the boundary by yourself;
 * - The pattern is required: only the three literals `instant` / `spring` / `line` are recognized. If they are
 * missing, misspelled, or have incorrect capitalization, they will be rejected;
 * - duration is only required in line mode: line is required (non-negative finite number, `0` is valid), and the other
 * two modes will not be viewed;
 * - Pet parsing conventions: `?pet=` is required and must actually exist (not given → `pet-required` , does not exist
 * → `unknown-pet` - never guess, never return to the first one in the list);
 * - No dead zone: No matter how small `power` is, it will be accepted (the dead zone is drag and drop semantics, and
 * the interface is a clear command);
 * - Parameter shape verification: character string / `NaN` / `Infinity` are always rejected, and an error is reported
 * before pet parsing.
 *
 * Running method: node --experimental-strip-types --test src/host/motion-cue.test.ts
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { decidePosition, decideThrow, positionLeafData } from './motion-cue.ts';

/** Minimum available resolved configuration: two entries with one pet each (same shape as ./anim.test.ts) */
const cfg = {
  main: { pets: [{ id: 'main', name: 'A' }] },
  pack1: { pets: [{ id: 'pack1', name: 'B' }] },
};

/** Decision conclusion → Reason for failure (give null when passing, to facilitate assertion) */
const reasonOf = (d: { ok: boolean } & Record<string, unknown>): unknown => (d.ok ? null : d.reason);

describe('decidePosition - Parameter verification, mode and clamping', () => {
  test('Valid coordinates and modes are passed as they are (duration in non-line mode returns to null)', () => {
    const d = decidePosition({ cfg, requested: 'main', x: 0.5, y: 0.35, mode: 'spring' });
    assert.deepEqual(d, { ok: true, petId: 'main', x: 0.5, y: 0.35, mode: 'spring', duration: null });
  });

  test('Out of bounds clamping to 0~1 (clamping instead of rejecting)', () => {
    const hi = decidePosition({ cfg, requested: 'main', x: 1.8, y: 99, mode: 'instant' });
    assert.deepEqual(hi, { ok: true, petId: 'main', x: 1, y: 1, mode: 'instant', duration: null });
    const lo = decidePosition({ cfg, requested: 'main', x: -3, y: -0.01, mode: 'instant' });
    assert.deepEqual(lo, { ok: true, petId: 'main', x: 0, y: 0, mode: 'instant', duration: null });
  });

  test('Boundary values 0 and 1 are retained as they are (the center can reach the edge of the screen, allowing half of the body to appear on the screen)', () => {
    const d = decidePosition({ cfg, requested: 'main', x: 0, y: 1, mode: 'spring' });
    assert.equal(d.ok && d.x, 0);
    assert.equal(d.ok && d.y, 1);
  });

  test('mode is required, and only three literals are recognized (incorrect case will be counted as an error)', () => {
    for (const bad of [undefined, null, '', 'SPRING', 'LINE', 'smooth', 'ease', 'linear', 1, true, {}]) {
      const d = decidePosition({ cfg, requested: 'main', x: 0.5, y: 0.5, mode: bad });
      assert.equal(reasonOf(d), 'bad-request', `mode=${String(bad)}`);
    }
  });

  test('line mode duration required: only non-negative finite numbers will be accepted, `0` is valid (= available immediately)', () => {
    const ok = decidePosition({ cfg, requested: 'main', x: 0.5, y: 0.5, mode: 'line', duration: 1200 });
    assert.deepEqual(ok, { ok: true, petId: 'main', x: 0.5, y: 0.5, mode: 'line', duration: 1200 });
    const zero = decidePosition({ cfg, requested: 'main', x: 0.5, y: 0.5, mode: 'line', duration: 0 });
    assert.equal(zero.ok && zero.duration, 0, '0 = Immediately, it is a legal value rather than "not given"');
    for (const bad of [undefined, null, -1, -0.5, NaN, Infinity, -Infinity, '1200', true, {}]) {
      const d = decidePosition({ cfg, requested: 'main', x: 0.5, y: 0.5, mode: 'line', duration: bad });
      assert.equal(reasonOf(d), 'bad-request', `duration=${String(bad)}`);
    }
  });

  test('instant / spring will not be read even if it is given to duration (there is no need to delete the field when caller reuses the body template)', () => {
    for (const mode of ['instant', 'spring'] as const) {
      const d = decidePosition({ cfg, requested: 'main', x: 0.5, y: 0.5, mode, duration: 9999 });
      assert.deepEqual(d, { ok: true, petId: 'main', x: 0.5, y: 0.5, mode, duration: null });
    }
    // Don’t even look at invalid values: these two modes take no time at all
    const junk = decidePosition({ cfg, requested: 'main', x: 0.5, y: 0.5, mode: 'spring', duration: -1 });
    assert.equal(junk.ok, true);
  });

  test('Non-finite number → bad-request (character string / NaN / Infinity / missing are rejected)', () => {
    for (const bad of ['0.5', NaN, Infinity, -Infinity, null, undefined, {}]) {
      const d = decidePosition({ cfg, requested: 'main', x: bad, y: 0.5, mode: 'spring' });
      assert.equal(reasonOf(d), 'bad-request', `x=${String(bad)}`);
    }
    const dy = decidePosition({ cfg, requested: 'main', x: 0.5, y: NaN, mode: 'spring' });
    assert.equal(reasonOf(dy), 'bad-request');
  });
});

describe('positionLeafData - write the load shape of the S leaf', () => {
  test('line carries duration, and the other modes do not (the leaf shape itself is semantic)', () => {
    assert.deepEqual(positionLeafData({ x: 0.5, y: 0.35, mode: 'line', duration: 1200 }), {
      x: 0.5,
      y: 0.35,
      mode: 'line',
      duration: 1200,
    });
    assert.deepEqual(positionLeafData({ x: 0.5, y: 0.35, mode: 'spring', duration: null }), {
      x: 0.5,
      y: 0.35,
      mode: 'spring',
    });
    assert.deepEqual(positionLeafData({ x: 0.5, y: 0.35, mode: 'instant', duration: null }), {
      x: 0.5,
      y: 0.35,
      mode: 'instant',
    });
  });

  test('Non-line mode **no** duration key (not written as undefined)', () => {
    assert.equal('duration' in positionLeafData({ x: 0, y: 0, mode: 'instant', duration: null }), false);
    assert.equal('duration' in positionLeafData({ x: 0, y: 0, mode: 'spring', duration: null }), false);
  });
});

describe('decideThrow —— Parameter verification', () => {
  test('Valid angles and strengths pass as they are (angles are not normalized)', () => {
    const d = decideThrow({ cfg, requested: 'main', angle: 135, power: 3 });
    assert.deepEqual(d, { ok: true, petId: 'main', angle: 135, power: 3 });
    const neg = decideThrow({ cfg, requested: 'main', angle: -90, power: 0.5 });
    assert.equal(
      neg.ok && neg.angle,
      -90,
      'Negative angles are "positive down" and must be retained as they are (sin/cos naturally follows a 360 cycle)',
    );
  });

  test('power must be > 0 and limited (0 / negative number / NaN / Infinity / character strings are all rejected)', () => {
    for (const bad of [0, -1, NaN, Infinity, -Infinity, '1', null, undefined]) {
      const d = decideThrow({ cfg, requested: 'main', angle: 45, power: bad });
      assert.equal(reasonOf(d), 'bad-request', `power=${String(bad)}`);
    }
  });

  test('**No dead zone**: extremely small power is still accepted (the dead zone is drag and drop semantics, the interface is an explicit command)', () => {
    const d = decideThrow({ cfg, requested: 'main', angle: 45, power: 0.001 });
    assert.equal(d.ok, true);
  });

  test('Invalid angle → bad-request', () => {
    for (const bad of ['45', NaN, Infinity, null, undefined]) {
      const d = decideThrow({ cfg, requested: 'main', angle: bad, power: 1 });
      assert.equal(reasonOf(d), 'bad-request', `angle=${String(bad)}`);
    }
  });
});

describe('Pet parsing conventions (shared by both interfaces)', () => {
  test('? pet = must be specified explicitly: default → pet-required (never fall back to the "current desktop pet"/the first one in the list)', () => {
    const explicit = decidePosition({ cfg, requested: 'pack1', x: 0, y: 0, mode: 'spring' });
    assert.equal(explicit.ok && explicit.petId, 'pack1');
    for (const empty of ['', '   ']) {
      const p = decidePosition({ cfg, requested: empty, x: 0, y: 0, mode: 'spring' });
      assert.equal(reasonOf(p), 'pet-required');
      const t = decideThrow({ cfg, requested: empty, angle: 0, power: 1 });
      assert.equal(reasonOf(t), 'pet-required');
    }
  });

  test('id does not exist → unknown-pet (never guess, never return to the first one in the list)', () => {
    const d = decidePosition({ cfg, requested: 'nope', x: 0, y: 0, mode: 'spring' });
    assert.equal(reasonOf(d), 'unknown-pet');
    const t = decideThrow({ cfg, requested: 'nope', angle: 0, power: 1 });
    assert.equal(reasonOf(t), 'unknown-pet');
  });

  test("Invalid parameters **take precedence** over pet parsing errors (the parameters are the caller's fault, correct it first)", () => {
    const d = decidePosition({ cfg, requested: 'nope', x: 'bad', y: 0, mode: 'spring' });
    assert.equal(reasonOf(d), 'bad-request');
    const m = decidePosition({ cfg, requested: 'nope', x: 0, y: 0, mode: 'nope' });
    assert.equal(reasonOf(m), 'bad-request', 'mode illegal also reports error before pet parsing');
    const t = decideThrow({ cfg, requested: 'nope', angle: 0, power: -1 });
    assert.equal(reasonOf(t), 'bad-request');
  });
});
