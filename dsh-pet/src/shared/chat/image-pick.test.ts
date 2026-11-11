/**
 * Single test of image selection and determination: MIME whitelist, extension fallback and clipboard image fetching.
 *
 * Why it’s worth nailing: Uploading entry point is subject to both `<input accept>` (filtering when selecting files)
 * and runtime judgment (drag and paste do not pass accept). If the latter is written incorrectly, it will only appear
 * as "no response when dragging in/pasting", without any error.
 *
 * Use Node to build test runner (node:test) without introducing any npm dependencies.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { firstImageFromClipboard, isImageFile } from './image-pick.ts';

/** Only create the two fields used for judgment: the implementation does not read other members of File. */
const file = (type: string, name: string): File => ({ type, name }) as File;

describe('isImageFile', () => {
  test('Whitelist MIME passes directly', () => {
    for (const mime of ['image/png', 'image/jpeg', 'image/webp', 'image/gif']) {
      assert.equal(isImageFile(file(mime, 'x')), true, mime);
    }
  });

  test('Press extension fallback when there is no MIME (common in drag/paste)', () => {
    for (const name of ['a.png', 'a.JPG', 'a.jpeg', 'a.webp', 'a.gif']) {
      assert.equal(isImageFile(file('', name)), true, name);
    }
  });

  test('The extension is not case sensitive', () => {
    assert.equal(isImageFile(file('', 'Shot.PNG')), true);
  });

  test('All non-pictures will be rejected', () => {
    for (const [type, name] of [
      ['video/mp4', 'a.mp4'],
      ['text/plain', 'a.txt'],
      ['', 'README'],
      ['', 'a.png.exe'],
    ]) {
      assert.equal(isImageFile(file(type, name)), false, name);
    }
  });

  test('When the declared type conflicts with the extension, the whitelist MIME shall prevail.', () => {
    // The user renamed . png to . txt, but the system still reports image/png: This is a picture, allowed
    assert.equal(isImageFile(file('image/png', 'a.txt')), true);
  });
});

/** Create a clipboard entry; `getAsFile` returns empty to indicate a non-file entry. */
const item = (f: File | null, kind = 'file') => ({ kind, getAsFile: () => f });

describe('firstImageFromClipboard', () => {
  test('There is a picture in files → fetch it directly', () => {
    const shot = file('image/png', 'shot.png');
    assert.equal(firstImageFromClipboard({ files: [shot], items: [] }), shot);
  });

  test('files only has non-images, items contains images hidden → fall back to items', () => {
    // Some sources only put pictures into items, and read-only files will appear as "sticky and no response"
    const txt = file('text/plain', 'a.txt');
    const shot = file('image/png', 'shot.png');
    assert.equal(firstImageFromClipboard({ files: [txt], items: [item(null, 'string'), item(shot)] }), shot);
  });

  test('Both files and items have pictures → files takes priority', () => {
    const first = file('image/png', 'a.png');
    const second = file('image/jpeg', 'b.jpg');
    assert.equal(firstImageFromClipboard({ files: [first], items: [item(second)] }), first);
  });

  test('Plain text paste → undefined (caller does not intercept the default behavior accordingly)', () => {
    assert.equal(firstImageFromClipboard({ files: [], items: [item(null, 'string')] }), undefined);
  });

  test('The file item in items cannot retrieve the file → skip', () => {
    assert.equal(firstImageFromClipboard({ files: [], items: [item(null)] }), undefined);
  });

  test('Empty clipboard / undefined → undefined', () => {
    assert.equal(firstImageFromClipboard(null), undefined);
    assert.equal(firstImageFromClipboard(undefined), undefined);
    assert.equal(firstImageFromClipboard({}), undefined);
  });
});
