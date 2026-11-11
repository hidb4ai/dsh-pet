/**
 * Pet avatar access (`pet-avatar.ts`): Read and write `pet/<asset-root>-avatar.<ext>` according to the asset root.
 *
 * Verify four things: it cannot be read if it has not been uploaded, the same name is overwritten, the latest is
 * obtained after changing the format (mtime), and non-image bytes are not persisted to disk. The checksum of the
 * endpoint layer is routes/avatar.test.ts and routes/assets.test.ts. Running method: node --experimental-strip-types
 * --test src/host/pet-avatar.test.ts
 */
import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { petAvatarFile, savePetAvatar } from './pet-avatar.ts';

/** The minimum file header of each format: sufficient for magic number determination and does not constitute a complete picture. */
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(8)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(8)]);
const GIF = Buffer.concat([Buffer.from('GIF89a', 'latin1'), Buffer.alloc(8)]);

let dir = '';

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'dsh-pet-avatar-'));
});

beforeEach(() => {
  // Each use case starts from an empty directory: the avatar file left by the previous use case will affect the determination of "not uploaded".
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
});

after(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('petAvatarFile —— Read', () => {
  test('Not uploaded → undefined (the caller falls back to the default logo)', () => {
    assert.equal(petAvatarFile(dir, 'cat'), undefined);
  });

  test('The written avatar can be read back according to the asset root, and the type comes from the extension.', () => {
    assert.deepEqual(savePetAvatar(dir, 'cat', PNG), { ok: true });
    const found = petAvatarFile(dir, 'cat');
    assert.equal(found?.contentType, 'image/png');
    assert.equal(readFileSync(found.file).equals(PNG), true);
  });

  test('Same name coverage: the content and extension will follow the new picture', () => {
    savePetAvatar(dir, 'cat', PNG);
    savePetAvatar(dir, 'cat', JPEG);
    const found = petAvatarFile(dir, 'cat');
    assert.equal(found?.contentType, 'image/jpeg');
    assert.equal(readFileSync(found.file).equals(JPEG), true);
  });

  test('When multiple copies coexist (residues of format change), the one with the latest modification time is used.', () => {
    const older = join(dir, 'cat-avatar.png');
    const newer = join(dir, 'cat-avatar.jpg');
    writeFileSync(older, PNG);
    writeFileSync(newer, JPEG);
    utimesSync(older, new Date(1_000), new Date(1_000));
    utimesSync(newer, new Date(2_000), new Date(2_000));
    assert.equal(petAvatarFile(dir, 'cat')?.contentType, 'image/jpeg');
    // In reverse: png reads back png when updating - the order does not depend on the extension, only the time
    utimesSync(older, new Date(3_000), new Date(3_000));
    assert.equal(petAvatarFile(dir, 'cat')?.contentType, 'image/png');
  });

  test('The invalid asset does not exit the pet directory.', () => {
    assert.equal(savePetAvatar(dir, '../evil', PNG).ok, false);
    assert.equal(petAvatarFile(dir, '../evil'), undefined);
  });
});

describe('savePetAvatar —— Verification', () => {
  test('Non-image bytes → not-image, and does not persist to disk', () => {
    assert.deepEqual(savePetAvatar(dir, 'cat', Buffer.from('not an image at all', 'utf8')), {
      ok: false,
      reason: 'not-image',
    });
    assert.equal(petAvatarFile(dir, 'cat'), undefined);
  });

  test('GIF can also be saved (png/jpg is not limited)', () => {
    assert.deepEqual(savePetAvatar(dir, 'cat', GIF), { ok: true });
    assert.equal(petAvatarFile(dir, 'cat')?.contentType, 'image/gif');
  });
});
