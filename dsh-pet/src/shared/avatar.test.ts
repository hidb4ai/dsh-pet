/**
 * Contract test of avatar address assemble: both consumers (chat panel, settings page) rely on it to obtain images
 * based on the asset root.
 *
 * Verify three points: the default image does not have a query string; the asset root must be compiled into `root=`
 * (not `pet=` , that is the pet instance id); the version number is always there, and the new URL will be available
 * after changing the avatar. Running method: node --experimental-strip-types --test src/shared/avatar.test.ts
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { avatarUrl, LOGO_URL } from './avatar.ts';
import { ROUTE_PATH } from './constants.ts';

describe('avatarUrl', () => {
  test('With asset root → root = and version number are present', () => {
    assert.equal(avatarUrl('cat', 7), ROUTE_PATH + '/logo?root=cat&v=7');
  });

  test('Empty asset root → without root, only the version number is left', () => {
    assert.equal(avatarUrl('', 7), ROUTE_PATH + '/logo?v=7');
    assert.equal(avatarUrl('   ', 7), ROUTE_PATH + '/logo?v=7');
  });

  test('The Chinese characters and spaces in the asset root must be encoded before entering the query string.', () => {
    assert.equal(avatarUrl('小猫 pack', 1), ROUTE_PATH + '/logo?root=' + encodeURIComponent('小猫 pack') + '&v=1');
  });

  test('The parameter name is root instead of pet (the latter is the pet instance id)', () => {
    assert.equal(avatarUrl('cat', 1).includes('pet='), false);
  });

  test('The version number is different → URL is different (this is how to break the cache)', () => {
    assert.notEqual(avatarUrl('cat', 1), avatarUrl('cat', 2));
  });

  test('The default image address is without query string / logo', () => {
    assert.equal(LOGO_URL, ROUTE_PATH + '/logo');
  });
});
