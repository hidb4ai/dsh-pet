/**
 * Unit test of identifier rules: pet id, emoticon asset root, petId of thumb share one isValidPetId.
 *
 * Invariants of verify:
 * - The three entry points are all used as path fragments, and the length and disabled characters must be the same (if
 * written separately, one will be blocked and the other will be allowed);
 * - '.' and '..' do not disable character, but will push the asset root to the previous level and must be blocked
 * separately;
 * - Valid names containing Chinese are as usual: use invalid character class instead of ASCII whitelist.
 *
 * Running method: node --experimental-strip-types --test src/host/config/constants.test.ts
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { isValidPetId, MAX_PET_ID_LENGTH } from './constants.ts';

describe('isValidPetId - Can the identifier be used as a path fragment?', () => {
  test('General id is valid: ASCII, underline, character and Chinese are all allowed', () => {
    for (const id of ['main', 'a_b-c', 'pet-7', '蓝鱼', 'deepseek-宠物']) {
      assert.equal(isValidPetId(id), true, `"${id}" should be legal`);
    }
  });

  test('The middle point number is valid (pet id is allowed to contain a point number, / state path cuts the leaf name according to the last point)', () => {
    assert.equal(isValidPetId('a.b'), true);
  });

  test('Empty strings and overlong strings are invalid: the upper limit is MAX_PET_ID_LENGTH, which is exactly equal to the upper limit and is still valid.', () => {
    assert.equal(isValidPetId(''), false);
    assert.equal(isValidPetId('x'.repeat(MAX_PET_ID_LENGTH)), true);
    assert.equal(isValidPetId('x'.repeat(MAX_PET_ID_LENGTH + 1)), false);
  });

  test('Invalid path separator or drive reservation character', () => {
    for (const id of ['a/b', 'a\\b', 'C:', 'a:b']) {
      assert.equal(isValidPetId(id), false, `"${id}" should be illegal`);
    }
  });

  test('Invalid control character (to prevent configuration value escape paths)', () => {
    assert.equal(isValidPetId('a\u0000b'), false);
    assert.equal(isValidPetId('a\nb'), false);
  });

  test('"." and ".." are invalid: they do not disable character, but will push the asset root to the previous level.', () => {
    assert.equal(isValidPetId('.'), false);
    assert.equal(isValidPetId('..'), false);
  });
});
