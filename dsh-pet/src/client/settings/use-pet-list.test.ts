/**
 * Contract test for type induction (petKinds).
 *
 * Two contracts:
 * 1. Deduplicate in order of first appearance, and count how many instances of each type there are (brackets on the
 * label);
 * 2. An instance without `assetRoot` is counted as main - old data/containers cannot create a category out of thin air
 * when flattening missing fields.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { mainPetsOf, petKinds } from './use-pet-list.ts';
import type { Pet } from '../../shared/types.ts';

/** A minimal instance; when `assetRoot` is omitted, "unmarked instance" is simulated. */
const pet = (id: string, assetRoot?: string): Pet => ({
  id,
  name: id,
  size: 300,
  balanceEnabled: false,
  whisperEnabled: false,
  workStatusEnabled: false,
  fixedEnabled: false,
  display: 'web',
  position: { corner: 'top-right', marginX: 0, marginY: 0 },
  ...(assetRoot === undefined ? {} : { assetRoot }),
});

describe('petKinds ——Instance list → Category bar', () => {
  test('Deduplicate in the order of first appearance, and count the number of instances of each type', () => {
    assert.deepEqual(petKinds([pet('m1', 'main'), pet('d1', 'daily'), pet('d2', 'daily'), pet('f1', 'festival')]), [
      { entry: 'main', kind: 'main', count: 1 },
      { entry: 'daily', kind: 'pack', count: 2 },
      { entry: 'festival', kind: 'pack', count: 1 },
    ]);
  });

  test('No instance of assetRoot is assigned to main', () => {
    assert.deepEqual(petKinds([pet('x1')]), [{ entry: 'main', kind: 'main', count: 1 }]);
  });

  test('Empty list: no category', () => {
    assert.deepEqual(petKinds([]), []);
  });
});

describe('mainPetsOf —— Submission content of PUT /config', () => {
  test('Only main layer instances are left: pack instances are not allowed to enter the user main configuration', () => {
    const pets = [pet('m1', 'main'), pet('d1', 'daily'), pet('f1', 'festival'), pet('x1')];
    assert.deepEqual(
      mainPetsOf(pets).map((item) => item.id),
      ['m1', 'x1'],
      'Old instances without assetRoot are counted as main, and pack instances must be excluded.',
    );
  });
});
