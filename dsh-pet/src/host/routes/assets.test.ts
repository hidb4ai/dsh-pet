/**
 * The `/logo` branch of the asset route: logo in the package is returned by default, and the custom avatar of the pet
 * is returned when `root=<asset-root>` is included.
 *
 * Only the root branch of this module is nailed; the remaining asset endpoints (thumb / pic / font / sound) are
 * covered by the real router in routes.test.ts, so we will not repeat that set here. Running method: node --
 * experimental-strip-types --test src/host/routes/assets.test.ts
 */
import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { handleAssetsRoutes } from './assets.ts';
import { savePetAvatar } from '../pet-avatar.ts';
import type { RouteResult } from '../http.ts';
import type { PetRouteDeps } from './types.ts';

/** Minimum PNG file header: sufficient for magic number determination and does not constitute a complete picture. */
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(8)]);

let dir = '';

/** route only uses petConfigDir (the rest of the fields are not readable by this field) and are not constructed in the test. */
const deps = (): PetRouteDeps => ({ petConfigDir: dir }) as unknown as PetRouteDeps;

/** Adjust logo reading once; `rest` defaults to clean `logo`. */
function readLogo(query: string, rest = 'logo'): Promise<RouteResult | undefined> {
  return handleAssetsRoutes(deps(), { url: new URL('http://localhost/logo' + query), rest, method: 'GET' });
}

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'dsh-pet-assets-'));
});

beforeEach(() => {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
});

after(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('handleAssetsRoutes —— /logo?root=', () => {
  test('With root and the pet has an avatar → return to the file', async () => {
    savePetAvatar(dir, 'cat', PNG);
    const result = await readLogo('?root=cat');
    assert.ok(result !== undefined && result.kind === 'file');
    assert.equal(result.contentType, 'image/png');
    assert.equal(result.file, join(dir, 'cat-avatar.png'));
  });

  test('With root but not uploaded → No return image (continue to the default logo branch)', async () => {
    const result = await readLogo('?root=cat');
    // assets/logo.png in the package is not reachable in source code form, so assertion "is not a file in the pet directory" is sufficient.
    assert.ok(result === undefined || result.kind !== 'file' || !result.file.startsWith(dir));
  });

  test('Invalid asset root → 400, no path concatenate', async () => {
    const result = await readLogo('?root=' + encodeURIComponent('../evil'));
    assert.ok(result !== undefined && result.kind === 'text');
    assert.equal(result.status, 400);
  });

  test('/ logo There are paragraphs after it → 400', async () => {
    const result = await readLogo('', 'logo/x');
    assert.ok(result !== undefined && result.kind === 'text');
    assert.equal(result.status, 400);
  });

  test('root = main (built-in) Even if there are residual files, it will not be read.', async () => {
    // Write the file directly (bypassing the upload endpoint), simulating historical legacy: the reading side still has to ignore it
    writeFileSync(join(dir, 'main-avatar.png'), PNG);
    const result = await readLogo('?root=main');
    assert.ok(
      result === undefined || result.kind !== 'file' || !result.file.startsWith(dir),
      'main can only be returned to the default logo in the package',
    );
    assert.equal(readFileSync(join(dir, 'main-avatar.png')).equals(PNG), true, 'Residual files are not deleted');
  });
});
