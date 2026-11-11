/**
 * Contract test for asset address assemble (src/client/pet/animation/assets.ts).
 *
 * Three contracts:
 * 1. The playback request address takes priority: the complete url given by the third party is not allowed to be
 * overwritten by route concatenate;
 * 2. Chinese characters and spaces must be encoded: both path segments must pass `encodeURIComponent` , otherwise the
 * host route will not match;
 * 3. When the asset root is missing, it will fall back to the pet id (when multiple instances share the asset
 * directory, the asset root is the real prefix).
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { animationAssetUrl } from './assets.ts';
import { ROUTE_PATH } from '../../../shared/constants.ts';

describe('animationAssetUrl ——Animation asset address', () => {
  test('Normal situation: Press asset root + animation name + extension to spell host route', () => {
    assert.equal(
      animationAssetUrl({ assetRoot: 'duck', id: 'pet-1', anim: 'idle1', ext: '.webm' }),
      ROUTE_PATH + '/thumb/duck/idle1.webm',
    );
  });

  test('The playback request address takes precedence and route is no longer required.', () => {
    const url = 'https://example.com/a/b.webm';
    assert.equal(animationAssetUrl({ cueUrl: url, assetRoot: 'duck', id: 'pet-1', anim: 'x', ext: '.webm' }), url);
  });

  test('Both Chinese and spaces are encoded', () => {
    const url = animationAssetUrl({ assetRoot: '小 鸭', id: 'pet-1', anim: '转 身', ext: '.webm' });
    assert.equal(
      url,
      ROUTE_PATH + '/thumb/' + encodeURIComponent('小 鸭') + '/' + encodeURIComponent('转 身') + '.webm',
    );
    assert.ok(!/[\u4e00-\u9fff\s]/.test(url), 'Unencoded Chinese characters or spaces cannot be left in the address.');
  });

  test('Return to pet id when the asset root is an empty string', () => {
    assert.equal(
      animationAssetUrl({ assetRoot: '', id: 'pet-2', anim: 'idle1', ext: '.webm' }),
      ROUTE_PATH + '/thumb/pet-2/idle1.webm',
    );
  });
});
