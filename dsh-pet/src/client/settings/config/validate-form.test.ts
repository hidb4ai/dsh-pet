/**
 * Contract testing for form validation.
 *
 * Three contracts:
 * 1. The rules correspond to the host one-to-one: pet width and height, physical interval, model pairing, non-negative
 * dialogue limit, font whitelist - the host will block combinations of 400 here first;
 * 2. The order is the prompt priority: only the first item is reported at a time, and the entire form of questions is
 * not piled on the user;
 * 3. Valid input must be allowed (especially valid boundaries such as 0 that "look like null values").
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { validateForm, type FormValues } from './validate-form.ts';
import { DEFAULT_FONT, FONT_SIZE_MAX } from '../../../shared/fonts.ts';
import { DEFAULT_PHYSICS } from '../../../shared/physics.ts';
import type { Pet } from '../../../shared/types.ts';

const pet = (extra: Record<string, unknown> = {}): Pet =>
  ({
    id: 'pet-1',
    name: 'pet-1',
    size: 200,
    position: { corner: 'bottom-right', marginX: 10, marginY: 20 },
    ...extra,
  }) as unknown as Pet;

/** A form that is valid everywhere; the use case only changes the item that it cares about. */
const valid = (overrides: Partial<FormValues> = {}): FormValues => ({
  pets: [pet()],
  physics: { ...DEFAULT_PHYSICS },
  whisperModel: { provider: '', model: '' },
  chatModel: { provider: '', model: '' },
  chatMemory: 5,
  chatImageLimit: 10,
  font: { ...DEFAULT_FONT },
  ...overrides,
});

describe('validateForm - Verify before saving', () => {
  test('Fully valid: return null', () => {
    assert.equal(validateForm(valid()), null);
  });

  test('Pet: The width must be a positive number and the offset must be a finite number.', () => {
    assert.equal(validateForm(valid({ pets: [pet({ size: 0 })] })), 'invalid');
    assert.equal(validateForm(valid({ pets: [pet({ size: Number.NaN })] })), 'invalid');
    assert.equal(
      validateForm(valid({ pets: [pet({ position: { corner: 'top-left', marginX: Number.NaN, marginY: 0 } })] })),
      'invalid',
    );
  });

  test('Pets: The default percentage or a number not less than 1 is valid (no upper limit)', () => {
    assert.equal(validateForm(valid({ pets: [pet({ sizePercent: 0 })] })), 'invalid');
    assert.equal(validateForm(valid({ pets: [pet({ sizePercent: 1 })] })), null);
    assert.equal(validateForm(valid({ pets: [pet({ sizePercent: 100 })] })), null);
    assert.equal(validateForm(valid({ pets: [pet({ sizePercent: 150 })] })), null, 'More than 100 is legal');
    assert.equal(validateForm(valid({ pets: [pet()] })), null, 'Default = only use px, legal');
  });

  test('Physical parameters: interval and positive and negative are stuck according to host rules', () => {
    assert.equal(validateForm(valid({ physics: { ...DEFAULT_PHYSICS, gravity: -1 } })), 'invalidPhysics');
    assert.equal(validateForm(valid({ physics: { ...DEFAULT_PHYSICS, restitution: 1.5 } })), 'invalidPhysics');
    assert.equal(validateForm(valid({ physics: { ...DEFAULT_PHYSICS, throwPower: 0 } })), 'invalidPhysics');
    assert.equal(
      validateForm(valid({ physics: { ...DEFAULT_PHYSICS, gravity: 0, restitution: 0, throwPower: 0.01 } })),
      null,
      '0 is the legal boundary (gravity is zero and full elasticity has no lower limit for accidental injury)',
    );
  });

  test('Model: write-only half is invalid, both sides are empty (following the current conversation) is valid', () => {
    assert.equal(validateForm(valid({ whisperModel: { provider: 'openai', model: '' } })), 'invalidModel');
    assert.equal(validateForm(valid({ chatModel: { provider: '', model: 'gpt-4o' } })), 'invalidModel');
    assert.equal(validateForm(valid({ whisperModel: { provider: 'openai', model: 'gpt-4o' } })), null);
  });

  test('Dialogue quota: Negative numbers are invalid, 0 is valid (0 = no limit)', () => {
    assert.equal(validateForm(valid({ chatMemory: -1 })), 'invalidChatMemory');
    assert.equal(validateForm(valid({ chatImageLimit: -1 })), 'invalidChatImageLimit');
    assert.equal(validateForm(valid({ chatMemory: 0, chatImageLimit: 0 })), null);
  });

  test('Font: The type must be in the white list and the font size must be in the closed range.', () => {
    assert.equal(validateForm(valid({ font: { ...DEFAULT_FONT, size: FONT_SIZE_MAX + 1 } })), 'invalidFont');
    assert.equal(validateForm(valid({ font: { ...DEFAULT_FONT, family: 'not-a-font' as never } })), 'invalidFont');
  });

  test('The order is the priority: when the pet fails, the subsequent physical parameters will no longer be reported.', () => {
    const values = valid({ pets: [pet({ size: 0 })], physics: { ...DEFAULT_PHYSICS, gravity: -1 } });
    assert.equal(validateForm(values), 'invalid');
  });
});
