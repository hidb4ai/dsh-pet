/**
 * Single test of desktop live snapshot (src/host/pose.ts) - issue #122 Article 1.
 *
 * Contract:
 * 1. Input parameters are narrowed: non-limited numbers (NaN / Infinity / character string) and invalid directions are
 * all `bad-request` ;
 * 2. Out-of-bounds coordinates are still accepted: the actual situation is "whatever is reported is what is reported",
 * no clamping is performed (the center point may be slightly out of bounds when the pet is close to the edge);
 * 3. Post-snapshot write overwrite, there is only one copy of the same pet, `updatedAt` from the injectable clock.
 *
 * Use Node to build test runner without introducing any npm dependencies.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { PoseStore, normalizePoseInput } from './pose.ts';

describe('normalizePoseInput ——The original value reported has narrowed', () => {
  test('Valid → narrowed as is', () => {
    assert.deepEqual(normalizePoseInput({ x: 0.25, y: 1, facing: 'right' }), {
      ok: true,
      pose: { x: 0.25, y: 1, facing: 'right' },
    });
  });

  test('Out-of-bounds coordinates will be accepted (no clamping: the live scene must be eye-catching)', () => {
    for (const x of [-0.03, 1.02]) {
      const r = normalizePoseInput({ x, y: 0.5, facing: 'left' });
      assert.equal(r.ok, true, 'x=' + x + ' 应通过');
      assert.equal(r.ok === true && r.pose.x, x);
    }
  });

  test('Non-object/missing field/non-finite number/invalid orientation → bad-request', () => {
    const bad: unknown[] = [
      null,
      undefined,
      42,
      'x',
      [],
      { y: 0.5, facing: 'left' }, // Missing x
      { x: 0.5, facing: 'left' }, // Missing y
      { x: NaN, y: 0.5, facing: 'left' },
      { x: Infinity, y: 0.5, facing: 'left' },
      { x: '0.5', y: 0.5, facing: 'left' },
      { x: 0.5, y: 0.5 }, // Missing facing
      { x: 0.5, y: 0.5, facing: 'RIGHT' },
      { x: 0.5, y: 0.5, facing: 'up' },
    ];
    for (const raw of bad) {
      const r = normalizePoseInput(raw);
      assert.equal(r.ok, false, JSON.stringify(raw) + ' 不应通过');
      assert.equal(r.ok === false && r.reason, 'bad-request');
    }
  });
});

describe('PoseStore - Snapshot overwrite', () => {
  test('never → undefined; readable after set, updatedAt from injected clock', () => {
    let now = 1000;
    const store = new PoseStore({ now: () => now });
    assert.equal(store.get('main'), undefined);
    assert.deepEqual(store.set('main', { x: 0.4, y: 0.6, facing: 'left' }), {
      x: 0.4,
      y: 0.6,
      facing: 'left',
      updatedAt: 1000,
    });
    now = 2000;
    store.set('main', { x: 0.1, y: 0.2, facing: 'right' });
    assert.deepEqual(store.get('main'), { x: 0.1, y: 0.2, facing: 'right', updatedAt: 2000 }, 'Write-behind overwrite');
    assert.equal(store.count(), 1, 'There is only one copy of the same pet');
  });

  test('Multiple pets do not interfere with each other', () => {
    const store = new PoseStore({ now: () => 1 });
    store.set('a', { x: 0, y: 0, facing: 'left' });
    store.set('b', { x: 1, y: 1, facing: 'right' });
    assert.equal(store.count(), 2);
    assert.equal(store.get('a')?.facing, 'left');
    assert.equal(store.get('b')?.facing, 'right');
  });
});
