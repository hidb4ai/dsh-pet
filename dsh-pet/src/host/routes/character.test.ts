/**
 * Role reference graph endpoint (`GET /character?root=<asset-root>`): parameter verification, detection sequence and response
 * form.
 *
 * Only the module’s own judgment is tested. The fallback in the package is not reachable in source code form -
 * `PACKAGE_ROOT` is launched by `import.meta.url` , and the source code points to `src/` when running, so only the two
 * results of `pet/` hit and "neither" are covered here. Running method: node --experimental-strip-types --test
 * src/host/routes/character.test.ts
 */
import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { handleCharacterRoutes } from './character.ts';
import type { PetRouteDeps } from './types.ts';
import type { RouteResult } from '../http.ts';

let dir = '';

/** route only uses petConfigDir (the rest of the fields are not readable by this field) and are not constructed in the test. */
const deps = (): PetRouteDeps => ({ petConfigDir: dir }) as unknown as PetRouteDeps;

/** Adjust read once; `rest` defaults to clean `character`. */
function read(query: string, rest = 'character'): Promise<RouteResult | undefined> {
  return handleCharacterRoutes(deps(), {
    url: new URL('http://localhost/character' + query),
    rest,
    method: 'GET',
  });
}

/** The assertion is a plain text response and retrieves the status code and copy. */
function asText(result: RouteResult | undefined): { status: number; body: string } {
  assert.ok(result !== undefined, 'The processor should respond');
  assert.equal(result.kind, 'text');
  return { status: result.status, body: result.body };
}

/** Write a placeholder image under pet /; the content is irrelevant, the reading side only looks at the existence and extension. */
function putCharacter(assetRoot: string, ext: string): string {
  const file = join(dir, assetRoot + '-character' + ext);
  writeFileSync(file, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  return file;
}

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'dsh-pet-character-'));
});

beforeEach(() => {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
});

after(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('handleCharacterRoutes - Path assignment', () => {
  test('Non-character path → undefined (passed to next processor)', async () => {
    assert.equal(await read('?root=cat', 'other'), undefined);
  });
});

describe('handleCharacterRoutes —— Parameter verification', () => {
  test('Missing root → 400, indicating the expected parameter shape', async () => {
    const { status, body } = asText(await read(''));
    assert.equal(status, 400);
    assert.match(body, /character\?root=/);
  });

  test('root are all blank → 400', async () => {
    const { status } = asText(await read('?root=%20%20'));
    assert.equal(status, 400);
  });

  test('root contains path separator → 400, without any path concatenate', async () => {
    const { status, body } = asText(await read('?root=' + encodeURIComponent('../evil')));
    assert.equal(status, 400);
    assert.equal(body, 'dsh-pet: invalid asset root');
  });

  test('There is a file with a similar name in the directory → still 404, not matching by prefix', async () => {
    putCharacter('cat', '.png');
    const { status } = asText(await read('?root=ca'));
    assert.equal(status, 404);
  });
});

describe('handleCharacterRoutes —— Take the picture', () => {
  test('pet / Hit → Return file path with Content-Type specified by extension', async () => {
    const file = putCharacter('cat', '.png');
    const result = await read('?root=cat');
    assert.ok(result !== undefined && result.kind === 'file');
    assert.equal(result.file, file);
    assert.equal(result.contentType, 'image/png');
  });

  test('Extension identified by whitelist → . webp back to image/webp', async () => {
    putCharacter('cat', '.webp');
    const result = await read('?root=cat');
    assert.ok(result !== undefined && result.kind === 'file');
    assert.equal(result.contentType, 'image/webp');
  });

  test('Multiple copies coexist → take the one that is earlier in the detection order', async () => {
    const png = putCharacter('cat', '.png');
    putCharacter('cat', '.webp');
    const result = await read('?root=cat');
    assert.ok(result !== undefined && result.kind === 'file');
    assert.equal(result.file, png);
  });

  test('main is not a special case: the built-in asset root is also fetched by file.', async () => {
    const file = putCharacter('main', '.png');
    const result = await read('?root=main');
    assert.ok(result !== undefined && result.kind === 'file');
    assert.equal(result.file, file);
  });

  test('There is no such picture → 404', async () => {
    const { status, body } = asText(await read('?root=cat'));
    assert.equal(status, 404);
    assert.equal(body, 'dsh-pet: character not found');
  });
});
