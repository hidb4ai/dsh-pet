/**
 * Avatar upload endpoint (`POST /pet-avatar?root=<asset-root>`): Inbound and outbound participation failed.
 *
 * Only the endpoint's own judgment - how the file is dropped and which copy is read are covered by pet-avatar.test.ts
 * and assets.test.ts. Running method: node --experimental-strip-types --test src/host/routes/avatar.test.ts
 */
import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { handleAvatarRoutes } from './avatar.ts';
import { petAvatarFile } from '../pet-avatar.ts';
import type { RouteResult } from '../http.ts';
import type { PetRouteDeps } from './types.ts';

/** Minimum PNG file header: sufficient for magic number determination and does not constitute a complete picture. */
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(8)]);

let dir = '';

/** route only uses petConfigDir (the rest of the fields are not readable by this field) and are not constructed in the test. */
const deps = (): PetRouteDeps => ({ petConfigDir: dir }) as unknown as PetRouteDeps;

/** Adjust upload once; `rest` defaults to clean `pet-avatar`. */
function upload(query: string, method: string, body?: string, rest = 'pet-avatar'): Promise<RouteResult | undefined> {
  return handleAvatarRoutes(deps(), {
    url: new URL('http://localhost/pet-avatar' + query),
    rest,
    method,
    body,
  });
}

/** The assertion is JSON response and the status code and response body are taken out. */
function asJson(result: RouteResult | undefined): { status: number; obj: Record<string, unknown> } {
  assert.ok(result !== undefined, 'The processor should respond');
  assert.equal(result.kind, 'json');
  return { status: result.status, obj: result.obj as Record<string, unknown> };
}

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'dsh-pet-avatar-route-'));
});

beforeEach(() => {
  // Each use case starts from an empty directory: the persist to disk avatar of the previous use case affects the "not persist to disk" type assertion.
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
});

after(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('handleAvatarRoutes —— Path and method', () => {
  test('Non-pet-avatar path → undefined (passed to next processor)', async () => {
    assert.equal(await upload('', 'POST', '{}', 'other'), undefined);
  });

  test('Not POST → 405', async () => {
    const { status } = asJson(await upload('?root=cat', 'GET'));
    assert.equal(status, 405);
  });
});

describe('handleAvatarRoutes —— Parameter verification', () => {
  test('Missing root → Business failure bad-request (200 + ok:false)', async () => {
    const { status, obj } = asJson(await upload('', 'POST', '{}'));
    assert.equal(status, 200);
    assert.equal(obj.reason, 'bad-request');
  });

  test('root contains path separator → bad-request, without spelling the path', async () => {
    const { obj } = asJson(await upload('?root=' + encodeURIComponent('../evil'), 'POST', '{}'));
    assert.equal(obj.reason, 'bad-request');
  });

  test('root = main (built-in entry) → bad-request, no file is written', async () => {
    const { status, obj } = asJson(
      await upload('?root=main', 'POST', JSON.stringify({ base64: PNG.toString('base64') })),
    );
    assert.equal(status, 200);
    assert.equal(obj.reason, 'bad-request');
    assert.equal(petAvatarFile(dir, 'main'), undefined, 'main is not allowed to leave avatar files in pet /');
  });

  test('Bad JSON → 400 invalid-json', async () => {
    const { status, obj } = asJson(await upload('?root=cat', 'POST', '{'));
    assert.equal(status, 400);
    assert.equal(obj.reason, 'invalid-json');
  });

  test('base64 non-standard → business failure bad-request, garbage bytes cannot be decoded', async () => {
    // The same conventions as the attachment verification of / chat: non-compliance of the content is a business conclusion (200 + ok:false), not protocol 4 xx
    const { status, obj } = asJson(await upload('?root=cat', 'POST', JSON.stringify({ base64: 'abc!!!' })));
    assert.equal(status, 200);
    assert.equal(obj.reason, 'bad-request');
  });
});

describe('handleAvatarRoutes - Content verification and persist to disk', () => {
  test('Not a picture → unsupported, and does not persist to disk', async () => {
    const base64 = Buffer.from('definitely not an image', 'utf8').toString('base64');
    const { obj } = asJson(await upload('?root=cat', 'POST', JSON.stringify({ base64 })));
    assert.equal(obj.reason, 'unsupported');
    assert.equal(petAvatarFile(dir, 'cat'), undefined);
  });

  test('Exceeded bytes upper limit → 413', async () => {
    // The head is right and the length is too long: pass the magic number first and then look at the budget.
    const huge = Buffer.concat([PNG, Buffer.alloc(800 * 1024)]);
    const { status, obj } = asJson(
      await upload('?root=cat', 'POST', JSON.stringify({ base64: huge.toString('base64') })),
    );
    assert.equal(status, 413);
    assert.equal(obj.reason, 'payload-too-large');
  });

  test('Valid PNG → ok:true and persist to disk', async () => {
    const { status, obj } = asJson(
      await upload('?root=cat', 'POST', JSON.stringify({ base64: PNG.toString('base64') })),
    );
    assert.equal(status, 200);
    assert.deepEqual(obj, { ok: true });
    assert.equal(petAvatarFile(dir, 'cat')?.contentType, 'image/png');
  });
});
