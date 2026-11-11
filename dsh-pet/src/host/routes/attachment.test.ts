/**
 * Contract testing for `GET /attachment` : id shape check, attachment service degradation, header sniffing and 405.
 *
 * Directly test the exported route processing function without starting the HTTP service; the attachment object is
 * replaced with a real file in the temporary directory - the responsibility of route is only to "get the path given by
 * the service + determine whether it can be displayed", you should not spell the path yourself.
 *
 * Running method: node --experimental-strip-types --test src/host/routes/attachment.test.ts
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import type { PetImageSink } from '../image-attachment.ts';
import type { PetRouteDeps, RouteInput } from './types.ts';
import { handleAttachmentRoutes } from './attachment.ts';

/** Valid id: sha256 + 64-bit lowercase hex. */
const ID = 'sha256:' + 'a'.repeat(64);

/** File headers in four displayable formats (zero padding for less than 16 bytes, just look at the header like the real object). */
const HEADERS: Record<string, Buffer> = {
  png: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0]),
  jpeg: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
  gif: Buffer.concat([Buffer.from('GIF89a', 'latin1'), Buffer.alloc(10)]),
  webp: Buffer.concat([Buffer.from('RIFF', 'latin1'), Buffer.alloc(4), Buffer.from('WEBP', 'latin1'), Buffer.alloc(4)]),
};

/** Create the simplest dependency: only optionalService is true. */
function makeDeps(sink?: PetImageSink): PetRouteDeps {
  return {
    optionalService: (name: string) => (name === 'attachments' ? sink : undefined),
  } as unknown as PetRouteDeps;
}

/** A picture retrieval request; id does not even have query parameters by default. */
function request(id: string | undefined, method = 'GET'): RouteInput {
  const url = new URL('http://127.0.0.1/dsh-pet-7340/attachment');
  if (id !== undefined) url.searchParams.set('id', id);
  return { url, rest: 'attachment', method };
}

/** Write bytes into a temporary object file and return its path and service stub (imageHostPath returns this path). */
function objectFile(bytes: Buffer): { file: string; sink: PetImageSink; clean: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-pet-attachment-test-'));
  const file = join(dir, 'object');
  writeFileSync(file, bytes);
  const sink: PetImageSink = {
    saveImages: async () => [],
    imageHostPath: () => file,
  };
  return { file, sink, clean: () => rmSync(dir, { recursive: true, force: true }) };
}

describe('handleAttachmentRoutes——Picture endpoint', () => {
  test('Not / attachment path → not claimed (return to distributor)', async () => {
    const input = { ...request(ID), rest: 'chat' };
    assert.equal(await handleAttachmentRoutes(makeDeps(), input), undefined);
  });

  test('Not GET → 405 (the image is read from the endpoint, and the action method should not be accepted)', async () => {
    const res = await handleAttachmentRoutes(makeDeps(), request(ID, 'POST'));
    assert.equal(res?.kind, 'text');
    assert.equal((res as { status: number }).status, 405);
  });

  test('id is missing or has the wrong shape → 400, and does not touch the accessory service', async () => {
    let touched = false;
    const sink = { saveImages: async () => [], imageHostPath: () => ((touched = true), undefined) } as PetImageSink;
    for (const bad of [undefined, '', 'abc', 'sha256:', 'sha256:' + 'A'.repeat(64), 'sha256:' + 'a'.repeat(63)]) {
      const res = await handleAttachmentRoutes(makeDeps(sink), request(bad));
      assert.equal((res as { status: number }).status, 400, String(bad));
    }
    assert.equal(touched, false, 'Illegal id must be blocked before calling the service');
  });

  test("Standalone mode: no attachment service → 404 (same downgrade conventions as POST /chat's image capabilities)", async () => {
    const res = await handleAttachmentRoutes(makeDeps(), request(ID));
    assert.equal((res as { status: number }).status, 404);
  });

  test('The backend is not file-based/reference rejected (error thrown) → 404, internal text is not leaked to the client', async () => {
    const noPath = { saveImages: async () => [] } as PetImageSink;
    assert.equal(((await handleAttachmentRoutes(makeDeps(noPath), request(ID))) as { status: number }).status, 404);
    const throwing = {
      saveImages: async () => [],
      imageHostPath: () => {
        throw new Error('INVALID_ATTACHMENT_REF');
      },
    } as PetImageSink;
    const res = await handleAttachmentRoutes(makeDeps(throwing), request(ID));
    assert.equal((res as { kind: 'text'; body: string }).body, 'dsh-pet: attachment not found');
  });

  test('The object has been cleared (the path exists but the file does not) → 404', async () => {
    const sink: PetImageSink = { saveImages: async () => [], imageHostPath: () => '/nonexistent/dsh-pet/object' };
    const res = await handleAttachmentRoutes(makeDeps(sink), request(ID));
    assert.equal((res as { status: number }).status, 404);
  });

  for (const [label, bytes, expected] of [
    ['PNG', HEADERS.png!, 'image/png'],
    ['JPEG', HEADERS.jpeg!, 'image/jpeg'],
    ['GIF', HEADERS.gif!, 'image/gif'],
    ['WebP', HEADERS.webp!, 'image/webp'],
  ] as const) {
    test(`${label} signature returns a file response with Content-Type ${expected}`, async () => {
      const obj = objectFile(bytes);
      try {
        const res = await handleAttachmentRoutes(makeDeps(obj.sink), request(ID));
        assert.equal(res?.kind, 'file');
        assert.equal((res as { file: string }).file, obj.file);
        assert.equal((res as { contentType: string }).contentType, expected);
      } finally {
        obj.clean();
      }
    });
  }

  test('Not the bytes of the picture → 404 (do not press octet-stream to send it out hard)', async () => {
    const obj = objectFile(Buffer.from('{"not":"an image"}'));
    try {
      const res = await handleAttachmentRoutes(makeDeps(obj.sink), request(ID));
      assert.equal((res as { status: number }).status, 404);
    } finally {
      obj.clean();
    }
  });
});
