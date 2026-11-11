/**
 * Contract test for POST /pet-config (whole entry writeback).
 *
 * Four contracts:
 * 1. Write-only files of this type, none of the bytes of `main-config.jsonc` will be touched;
 * 2. Entry-level fields (persona, animation pool, custom keys) are retained as they are and will not be erased by
 * whitelist reconstruction;
 * 3. Business failure always has 200 + failed entities, and reason can distinguish between "wrong parameter writing"
 * and "type not installed";
 * 4. The instance id with the same name as other types is blocked before writing to disk - otherwise it will be
 * silently skipped when reading.
 *
 * Use explicit ConfigPaths + minimal dependency stub: only handler is tested, and there is no need to start the
 * service (that is a matter of end-to-end scripting).
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { savePetLayer } from './entry.ts';
import type { PetRouteDeps, RouteInput } from '../types.ts';
import type { RouteResult } from '../../http.ts';

/** The default configuration built into the package: real file, required base for `readAllConfig`. */
const DEFAULT_FILE = fileURLToPath(new URL('../../../../assets/config.jsonc', import.meta.url));

/** A valid instance: the fields are complete, and the test only changes the required ones. */
const pet = (id: string) => ({
  id,
  name: id,
  size: 300,
  balanceEnabled: false,
  whisperEnabled: false,
  workStatusEnabled: false,
  fixedEnabled: false,
  display: 'web',
  position: { corner: 'top-right', marginX: 10, marginY: 10 },
});

interface Harness {
  readonly deps: PetRouteDeps;
  readonly userFile: string;
  readonly packFile: string;
  readonly releases: string[];
  readonly restarts: number;
}

let root = '';
let savedHome: string | undefined;

/** Create a set of temporary configuration directories and minimal dependency stubs. */
function makeHarness(): Harness {
  const userFile = join(root, 'main-config.jsonc');
  const petDir = join(root, 'pet');
  const packFile = join(petDir, 'glm-config.json');
  const releases: string[] = [];
  let restarts = 0;
  const deps = {
    configPaths: { defaultFile: DEFAULT_FILE, userFile, petDir },
    userConfigPath: userFile,
    userRoot: root,
    petConfigDir: petDir,
    state: { writeSection: () => {} },
    lock: {
      release: ({ petId }: { petId: string }) => {
        releases.push(petId);
      },
    },
    requestRestart: async () => {
      restarts += 1;
    },
  } as unknown as PetRouteDeps;
  return {
    deps,
    userFile,
    packFile,
    releases,
    get restarts() {
      return restarts;
    },
  };
}

/** Make a request; `body` sends the character string as it is (used for bad JSON). */
const input = (body: unknown, method = 'POST'): RouteInput => ({
  url: new URL('http://localhost/dsh-pet-7340/pet-config'),
  rest: 'pet-config',
  method,
  body: typeof body === 'string' ? body : JSON.stringify(body),
});

/** Get the status code and entity of the JSON response. */
function jsonOf(res: RouteResult): { status: number; obj: Record<string, unknown> } {
  if (res.kind !== 'json') throw new Error('期望 JSON 应答，实际是 ' + res.kind);
  return { status: res.status, obj: res.obj as Record<string, unknown> };
}

/** Write a category file with custom fields. */
function writePack(file: string): void {
  mkdirSync(join(root, 'pet'), { recursive: true });
  writeFileSync(
    file,
    JSON.stringify({
      whisperPrompt: 'GLM 的人设',
      note: '手写的自定义键',
      pets: [pet('glm1')],
    }),
    'utf8',
  );
}

before(() => {
  root = mkdtempSync(join(tmpdir(), 'dsh-pet-config-entry-'));
  savedHome = process.env.DSH_HOME;
  // The warning log falls under this temporary home. Do not pollute the real user directory.
  process.env.DSH_HOME = join(root, 'home');
});

after(() => {
  if (savedHome === undefined) delete process.env.DSH_HOME;
  else process.env.DSH_HOME = savedHome;
  if (root) rmSync(root, { recursive: true, force: true });
});

describe('savePetLayer ——Write back the entire entry', () => {
  test('Write back successfully: only this type of file is modified, persona and custom keys are retained, main is unchanged', async () => {
    const h = makeHarness();
    writeFileSync(h.userFile, JSON.stringify({ pets: [pet('main1')] }), 'utf8');
    writePack(h.packFile);
    const res = jsonOf(
      await savePetLayer(h.deps, input({ entry: 'glm', pets: [{ ...pet('glm1'), size: 360, display: 'both' }] })),
    );
    assert.equal(res.status, 200);
    const saved = JSON.parse(readFileSync(h.packFile, 'utf8')) as Record<string, unknown>;
    assert.equal((saved.pets as Array<{ size: number }>)[0].size, 360, 'Instance fields should be written back');
    assert.equal(saved.whisperPrompt, 'GLM 的人设', 'Entry persona must not be erased by whitelist rebuild');
    assert.equal(
      saved.note,
      '手写的自定义键',
      'Non-whitelist top-level fields should be retained through transparent transmission',
    );
    const main = JSON.parse(readFileSync(h.userFile, 'utf8')) as { pets: Array<{ id: string }> };
    assert.deepEqual(
      main.pets.map((p) => p.id),
      ['main1'],
      'Layer main should not be touched by this endpoint',
    );
  });

  test('The response body is the resolved configuration: main and the modified types are all in it', async () => {
    const h = makeHarness();
    writeFileSync(h.userFile, JSON.stringify({ pets: [pet('main1')] }), 'utf8');
    writePack(h.packFile);
    const res = jsonOf(await savePetLayer(h.deps, input({ entry: 'glm', pets: [{ ...pet('glm1'), size: 420 }] })));
    const merged = res.obj as { main?: { pets: unknown[] }; glm?: { pets: Array<{ size: number }> } };
    assert.ok(merged.main?.pets.length, 'Response must have main entry');
    assert.equal(merged.glm?.pets[0].size, 420, 'The response must reflect the value just written back');
  });

  test('Type not installed: unknown-entry; main entry: bad-request', async () => {
    const h = makeHarness();
    writeFileSync(h.userFile, JSON.stringify({ pets: [pet('main1')] }), 'utf8');
    const missing = jsonOf(await savePetLayer(h.deps, input({ entry: 'nope', pets: [pet('x1')] })));
    assert.equal(missing.obj.reason, 'unknown-entry');
    const main = jsonOf(await savePetLayer(h.deps, input({ entry: 'main', pets: [pet('main1')] })));
    assert.equal(
      main.obj.reason,
      'bad-request',
      'If the main layer needs to have global fields, it must go to PUT / config',
    );
  });

  test('Invalid parameters: missing entry / empty pets / invalid entry are all bad-request', async () => {
    const h = makeHarness();
    writeFileSync(h.userFile, JSON.stringify({ pets: [pet('main1')] }), 'utf8');
    for (const body of [{}, { entry: 'glm' }, { entry: 'glm', pets: [] }, { entry: '../x', pets: [pet('a1')] }]) {
      const res = jsonOf(await savePetLayer(h.deps, input(body)));
      assert.equal(res.obj.reason, 'bad-request', JSON.stringify(body) + ' 应被拒绝');
    }
  });

  test('Cross-entry id conflict: Block before writing to disk, the file remains intact', async () => {
    const h = makeHarness();
    writeFileSync(h.userFile, JSON.stringify({ pets: [pet('main1')] }), 'utf8');
    writePack(h.packFile);
    const before = readFileSync(h.packFile, 'utf8');
    const res = jsonOf(await savePetLayer(h.deps, input({ entry: 'glm', pets: [pet('main1')] })));
    assert.equal(res.obj.reason, 'bad-request');
    assert.match(String(res.obj.message), /main1/, 'The copywriter should point out the conflict id');
    assert.equal(readFileSync(h.packFile, 'utf8'), before, 'Disk writing is not allowed in case of conflict');
  });

  test('The protocol layer fails to retain the true status code: non-POST 405, bad JSON 400', async () => {
    const h = makeHarness();
    writeFileSync(h.userFile, JSON.stringify({ pets: [pet('main1')] }), 'utf8');
    const wrongMethod = jsonOf(await savePetLayer(h.deps, input({}, 'GET')));
    assert.equal(wrongMethod.status, 405);
    const badJson = jsonOf(await savePetLayer(h.deps, input('{')));
    assert.equal(badJson.status, 400);
    assert.equal(badJson.obj.reason, 'invalid-json');
  });

  test('Changing the instance to none will cancel the occupied lock (same conventions as / pet-display)', async () => {
    const h = makeHarness();
    writeFileSync(h.userFile, JSON.stringify({ pets: [pet('main1')] }), 'utf8');
    writePack(h.packFile);
    await savePetLayer(h.deps, input({ entry: 'glm', pets: [{ ...pet('glm1'), display: 'none' }] }));
    assert.deepEqual(h.releases, ['glm1']);
  });
});
