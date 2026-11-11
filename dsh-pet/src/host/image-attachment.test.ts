/**
 * Single test of dialogue picture input parameter parsing: three boundaries of shape, media type whitelist, and base64
 * normalization.
 *
 * Why standardize base64 separately: Buffer decoding will silently discard invalid characters. When the re-encoding
 * results are not compared, `"abc!!!"` will be decoded into another string of bytes - the caller thinks A is sent, and
 * the model sees B, and no error is reported throughout the process.
 *
 * Use Node to build test runner (node:test) without introducing any npm dependencies.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { parseImageAttachment } from './image-attachment.ts';

/** Minimum PNG header (8 bytes signature): enough to verify round-trip consistency, no real picture is required. */
const PNG_HEAD = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** PNG header canonicalizing base64 encoding */
const PNG_BASE64 = PNG_HEAD.toString('base64');

describe('parseImageAttachment', () => {
  test('Valid PNG: bytes is consistent with the original image byte by byte → passed', () => {
    const parsed = parseImageAttachment({ mediaType: 'image/png', data: PNG_BASE64 });
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.mediaType, 'image/png');
    assert.deepEqual(parsed.bytes, new Uint8Array(PNG_HEAD));
  });

  test('Other formats in the whitelist (JPEG/WebP/GIF) are also accepted', () => {
    for (const mediaType of ['image/jpeg', 'image/webp', 'image/gif'] as const) {
      const parsed = parseImageAttachment({ mediaType, data: PNG_BASE64 });
      assert.equal(parsed.ok, true, mediaType);
    }
  });

  test('non-object / null / array → reject', () => {
    for (const raw of [undefined, null, [], 'abc', 1, true]) {
      assert.equal(parseImageAttachment(raw).ok, false, JSON.stringify(raw));
    }
  });

  test('mediaType is missing, is not a character string, or is not in the whitelist → reject', () => {
    for (const mediaType of [undefined, 1, 'image/bmp', 'IMAGE/PNG', '']) {
      const parsed = parseImageAttachment({ mediaType, data: PNG_BASE64 });
      assert.equal(parsed.ok, false, String(mediaType));
    }
  });

  test('data is missing, empty or not a character string → reject', () => {
    for (const data of [undefined, '', 123, null]) {
      const parsed = parseImageAttachment({ mediaType: 'image/png', data });
      assert.equal(parsed.ok, false, String(data));
    }
  });

  test('base64 containing invalid character → rejected (cannot be silently discarded)', () => {
    const parsed = parseImageAttachment({ mediaType: 'image/png', data: PNG_BASE64 + '!!!' });
    assert.equal(parsed.ok, false);
    assert.match(parsed.ok ? '' : parsed.message, /不是合法的 base64/);
  });

  test('Missing padding (non-standard base64) → Reject', () => {
    // Most decoders can still decode the same string of bytes after removing the trailing '=', which is why the re-encoding results must be compared.
    const unpadded = PNG_BASE64.replace(/=+$/, '');
    assert.notEqual(unpadded, PNG_BASE64, 'The sample itself must be filled, otherwise this use case is meaningless');
    assert.equal(parseImageAttachment({ mediaType: 'image/png', data: unpadded }).ok, false);
  });

  test('Empty string after decoding → Reject', () => {
    assert.equal(parseImageAttachment({ mediaType: 'image/png', data: '====' }).ok, false);
  });

  test('exceeds character upper limit → reject and prompt for compression', () => {
    const parsed = parseImageAttachment({ mediaType: 'image/png', data: 'A'.repeat(900_001) });
    assert.equal(parsed.ok, false);
    assert.match(parsed.ok ? '' : parsed.message, /过长/);
  });
});
