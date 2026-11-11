/**
 * Contract test for writeback plan (diffPackWrites).
 *
 * Three contracts:
 * 1. Only include the category layers that have been "really changed" into the plan, and do not send a single request
 * for those that have not been changed;
 * 2. main will never enter the plan - it, together with the global fields, will write the entire package PUT /config
 * every time it is saved;
 * 3. The plan contains **all** instances of this type. Missing one is equivalent to deleting it.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { diffPackWrites } from './pack-writes.ts';
import type { ConfigEntry } from './read.ts';
import type { Pet } from '../../../shared/types.ts';

/** An instance with complete fields. */
const pet = (id: string, over: Partial<Pet> = {}): Pet => ({
  id,
  name: id,
  size: 300,
  balanceEnabled: false,
  whisperEnabled: false,
  workStatusEnabled: false,
  fixedEnabled: false,
  display: 'web',
  position: { corner: 'top-right', marginX: 10, marginY: 10 },
  ...over,
});

/** Loading snapshot: main one + glm one. */
const loaded = (): ConfigEntry[] => [
  { key: 'main', kind: 'main', pets: [pet('m1', { assetRoot: 'main' })] },
  { key: 'glm', kind: 'pack', pets: [pet('g1', { assetRoot: 'glm' })] },
];

describe('diffPackWrites - Edit list → Category layer to be written back', () => {
  test('No changes: The plan is empty and no request is sent.', () => {
    const current = loaded().flatMap((entry) => entry.pets);
    assert.deepEqual(diffPackWrites(loaded(), current), []);
  });

  test('A field of a certain category was changed: only this category is listed', () => {
    const current = [pet('m1', { assetRoot: 'main' }), pet('g1', { assetRoot: 'glm', size: 360 })];
    const plan = diffPackWrites(loaded(), current);
    assert.equal(plan.length, 1);
    assert.equal(plan[0].entry, 'glm');
    assert.equal(plan[0].pets[0].size, 360);
  });

  test('The change of main does not enter the plan (go to PUT /config)', () => {
    const current = [pet('m1', { assetRoot: 'main', size: 500 }), pet('g1', { assetRoot: 'glm' })];
    assert.deepEqual(diffPackWrites(loaded(), current), []);
  });

  test('Add a new one: all instances of this type are included in the plan', () => {
    const current = [
      pet('m1', { assetRoot: 'main' }),
      pet('g1', { assetRoot: 'glm' }),
      pet('g2', { assetRoot: 'glm' }),
    ];
    const plan = diffPackWrites(loaded(), current);
    assert.deepEqual(
      plan[0].pets.map((item) => item.id),
      ['g1', 'g2'],
      'Entire paragraph replacement semantics: missing instances will be deleted',
    );
  });

  test('Only changing sizePercent is considered a change (the fingerprint must cover it, otherwise the percentage change will be silent and will not persist to disk)', () => {
    const current = [pet('m1', { assetRoot: 'main' }), pet('g1', { assetRoot: 'glm', sizePercent: 40 })];
    const plan = diffPackWrites(loaded(), current);
    assert.equal(plan.length, 1);
    assert.equal(plan[0].pets[0].sizePercent, 40);
  });

  test('Just changing the order of instances is considered a change.', () => {
    const before = loaded();
    before[1].pets.push(pet('g2', { assetRoot: 'glm' }));
    const current = [
      pet('m1', { assetRoot: 'main' }),
      pet('g2', { assetRoot: 'glm' }),
      pet('g1', { assetRoot: 'glm' }),
    ];
    assert.equal(diffPackWrites(before, current).length, 1);
  });
});
