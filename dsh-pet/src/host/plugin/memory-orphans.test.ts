/**
 * Judgment and cleanup of orphan history (deleted pet residue buckets).
 *
 * The real file (assets/config.jsonc in the warehouse) is used for configuration, and the memory file is replaced by
 * the memory - this can not only verify the judgment of "there is/is not in the configuration", but also does not
 * require actual disk writing.
 *
 * Running method: node --experimental-strip-types --test src/host/plugin/memory-orphans.test.ts
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { createMemoryOrphans } from './memory-orphans.ts';
import type { ConfigPaths } from '../config.ts';

type Messages = { role: 'user' | 'assistant'; content: string; ts: number }[];
type MemoryFile = Record<string, Record<string, { messages: Messages }>>;

/** Temporary workspace: The default configuration points back to the warehouse, and the user layer is empty. */
function tempConfig(): { configPaths: ConfigPaths; clean: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-pet-orphans-test-'));
  const configPaths: ConfigPaths = {
    defaultFile: fileURLToPath(new URL('../../../assets/config.jsonc', import.meta.url)),
    userFile: join(dir, 'main-config.jsonc'),
    petDir: join(dir, 'pet'),
  };
  writeFileSync(configPaths.userFile, '{}');
  return { configPaths, clean: () => rmSync(dir, { recursive: true, force: true }) };
}

/** Create an orphan module with a memory double: both reading and writing fall on the same object. */
function makeOrphans(initial: MemoryFile) {
  const config = tempConfig();
  const mem = structuredClone(initial);
  const orphans = createMemoryOrphans({
    configPaths: config.configPaths,
    readMemory: async () => mem,
    writeMemory: async (next) => {
      // next and mem are the same object (the tested code is modified in place and written back): clone first and then clear, otherwise it will erase itself
      const copy = structuredClone(next);
      for (const key of Object.keys(mem)) delete mem[key];
      Object.assign(mem, copy);
    },
    withLock: async (fn) => fn(),
    log: { info: () => {} },
  });
  return { orphans, mem, clean: config.clean };
}

describe('createMemoryOrphans - The remaining history of deleted pets', () => {
  test('Pets that are no longer in the configuration → list (number + last time)', async () => {
    const suite = makeOrphans({
      main: {
        main: { messages: [{ role: 'user', content: '在吗', ts: 1 }] },
        gone: {
          messages: [
            { role: 'user', content: '旧问题', ts: 1000 },
            { role: 'assistant', content: '旧回答', ts: 1000 },
          ],
        },
      },
    });
    try {
      const list = await suite.orphans.orphanHistory();
      assert.deepEqual(list, [{ entry: 'main', petId: 'gone', messages: 2, lastTs: 1000 }]);
    } finally {
      suite.clean();
    }
  });

  test('All pets are still there → empty list (not false positive)', async () => {
    const suite = makeOrphans({ main: { main: { messages: [] } } });
    try {
      assert.deepEqual(await suite.orphans.orphanHistory(), []);
    } finally {
      suite.clean();
    }
  });

  test('Only orphans will be deleted during cleaning: existing pets will be retained as they are, and empty entries will be removed as well.', async () => {
    const suite = makeOrphans({
      main: {
        main: { messages: [{ role: 'user', content: '留着', ts: 1 }] },
        gone: { messages: [{ role: 'user', content: '删掉', ts: 2 }] },
      },
      empty: { ghost: { messages: [{ role: 'user', content: '删掉', ts: 3 }] } },
    });
    try {
      const result = await suite.orphans.deleteOrphans();
      assert.deepEqual(result, { ok: true, pets: 2, messages: 2 });
      assert.deepEqual(Object.keys(suite.mem), ['main'], 'Empty entries should be removed');
      assert.deepEqual(Object.keys(suite.mem.main ?? {}), ['main'], 'Existing pets cannot be deleted by mistake');
    } finally {
      suite.clean();
    }
  });

  test('No orphan → No file written, count all 0', async () => {
    let writes = 0;
    const config = tempConfig();
    const orphans = createMemoryOrphans({
      configPaths: config.configPaths,
      readMemory: async () => ({ main: { main: { messages: [] } } }),
      writeMemory: async () => {
        writes += 1;
      },
      withLock: async (fn) => fn(),
      log: { info: () => {} },
    });
    try {
      assert.deepEqual(await orphans.deleteOrphans(), { ok: true, pets: 0, messages: 0 });
      assert.equal(writes, 0, 'Memory files should not be overwritten when there is nothing to delete');
    } finally {
      config.clean();
    }
  });
});
