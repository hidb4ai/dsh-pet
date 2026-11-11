/**
 * Contract testing of the "Add Pet" draft structure (src/client/settings/pet-draft.ts).
 *
 * Two contracts:
 * 1. The new id will find the first empty position starting from pet-2 and will never cover the existing id;
 * 2. The new pet uses its own id as its name (it does not inherit the template name, otherwise the two have the same
 * name), and the position is copied deeply. Changing the new pet will not pollute the template.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { draftPet, nextPetId } from './pet-draft.ts';
import type { Pet } from '../../shared/types.ts';

const pet = (id: string): Pet =>
  ({ id, name: id, size: 200, position: { corner: 'bottom-right', marginX: 10, marginY: 20 } }) as unknown as Pet;

const template = {
  id: 'pet-1',
  name: '小桌宠',
  size: 260,
  balanceEnabled: true,
  whisperEnabled: false,
  workStatusEnabled: true,
  fixedEnabled: false,
  display: 'front',
  position: { corner: 'bottom-left', marginX: 40, marginY: 60 },
} as unknown as Pet;

describe('nextPetId - New id allocation', () => {
  test('Empty list starts at pet-2', () => {
    assert.equal(nextPetId([]), 'pet-2');
  });

  test('Skip the occupied id and take the first empty position', () => {
    assert.equal(nextPetId([pet('pet-2'), pet('pet-3')]), 'pet-4');
    assert.equal(nextPetId([pet('pet-1'), pet('pet-3')]), 'pet-2');
  });

  test('Don’t crash because there are other prefixes in the list', () => {
    assert.equal(nextPetId([pet('cat'), pet('pet-2')]), 'pet-3');
  });

  test('Category prefix for file pets: the number is incremented within the category', () => {
    assert.equal(nextPetId([], 'daily'), 'daily-2');
    assert.equal(nextPetId([pet('daily-2')], 'daily'), 'daily-3');
    assert.equal(nextPetId([pet('daily-2'), pet('daily-3')], 'daily'), 'daily-4');
  });

  test('The same number id of other types is not considered occupied, but the same number of this type must be skipped', () => {
    assert.equal(nextPetId([pet('festival-2')], 'daily'), 'daily-2');
    assert.equal(nextPetId([pet('daily-2'), pet('festival-2')], 'daily'), 'daily-3');
  });

  test('main remains pet - prefix: existing behavior unchanged', () => {
    assert.equal(nextPetId([], 'main'), 'pet-2');
  });
});

describe('draftPet - New pet draft', () => {
  test('Use your own id for the name and do not inherit the template name.', () => {
    const draft = draftPet(template, 'pet-2');
    assert.equal(draft.id, 'pet-2');
    assert.equal(draft.name, 'pet-2');
  });

  test('Copy the instance fields and positions of the template. The position is a deep copy.', () => {
    const draft = draftPet(template, 'pet-2');
    assert.equal(draft.size, 260);
    assert.equal(draft.balanceEnabled, true);
    assert.equal(draft.display, 'front');
    assert.deepEqual(draft.position, { corner: 'bottom-left', marginX: 40, marginY: 60 });

    draft.position.marginX = 1;
    assert.equal(template.position.marginX, 40, 'Changing a new pet cannot move the template');
  });
});
