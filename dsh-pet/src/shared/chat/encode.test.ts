/**
 * Single test of image budget conversion: bytes inversion, long-edge scaling and quality ladder.
 *
 * Why it's worth pinning: These three numbers determine "whether the screenshot can be sent out." If the conversion is
 * written incorrectly, no error will be reported. It will only appear as a 413 response from the host or the image
 * being compressed into a mosaic.
 *
 * Use Node to build test runner (node:test) without introducing any npm dependencies.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { IMAGE_MAX_BYTES, IMAGE_MAX_SIDE, IMAGE_QUALITIES, attachmentBytes, targetSize } from './encode.ts';

describe('attachmentBytes', () => {
  test('Consistent with base64 conversion of Buffer (including padding boundary)', () => {
    for (const n of [1, 2, 3, 4, 1000]) {
      const base64 = Buffer.alloc(n, 7).toString('base64');
      assert.equal(attachmentBytes(base64), n, String(n));
    }
  });
});

describe('targetSize', () => {
  test('When the long side exceeds the limit, the proportion is reduced to the upper limit.', () => {
    assert.deepEqual(targetSize(4000, 3000), { width: 2048, height: 1536 });
  });

  test('No enlargement will occur until the upper limit is exceeded.', () => {
    assert.deepEqual(targetSize(800, 600), { width: 800, height: 600 });
  });

  test('Leave at least 1 px for extreme bar charts', () => {
    const size = targetSize(1, 4000);
    assert.equal(size.height, IMAGE_MAX_SIDE);
    assert.equal(size.width, 1);
  });
});

describe('Budget invariant', () => {
  test('The quality ladder is from high to low without repetition.', () => {
    for (let i = 1; i < IMAGE_QUALITIES.length; i += 1) {
      assert.ok(IMAGE_QUALITIES[i] < IMAGE_QUALITIES[i - 1], `The ${i} gear should be lower`);
    }
  });

  test('640 KiB is still within the upper limit of host 900000 character after changing to base64', () => {
    // Host side MAX_BASE64_CHARS = 900 _000. Here, 4/3 is used for comparison after expansion, leaving a JSON structural margin.
    const base64Chars = Math.ceil(IMAGE_MAX_BYTES / 3) * 4;
    assert.ok(base64Chars < 900_000, String(base64Chars));
  });
});
