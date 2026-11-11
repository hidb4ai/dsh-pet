/**
 * Contract test of `DELETE /chat` : parameter parsing, method whitelist and "surface verification without deletion".
 *
 * Directly test the exported route processing function without starting the HTTP service: the deleted memory read and
 * write behavior is covered by chat-memory.test.ts. Here we only specify "what route handed over to the service layer"
 * - what the parameters are parsed into, and it should not be called under any circumstances.
 *
 * Running method: node --experimental-strip-types --test src/host/routes/chat-delete.test.ts
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import type { PetRouteDeps, RouteInput } from './types.ts';
import { handleChatRoutes } from './chat.ts';

/** A deleteHistory call (what is used to transparently transmit assertion route) */
type DeleteCall = { petId: string; ts?: readonly number[] };

/** Create the minimum route dependency; requirePet is fixed back to main, deleteHistory records the input parameters and returns successfully. */
function makeDeps(): { deps: PetRouteDeps; calls: DeleteCall[] } {
  const calls: DeleteCall[] = [];
  const deps = {
    configPaths: {},
    log: { error: () => {}, info: () => {}, warn: () => {} },
    memoryPath: '/tmp/dsh-pet-memory.json',
    memoryRounds: () => 5,
    readMemory: async () => ({}),
    requirePet: () => ({ ok: true, petId: 'main', entry: 'main', conf: {} }),
    deleteHistory: async (petId: string, ts?: readonly number[]) => {
      calls.push({ petId, ...(ts === undefined ? {} : { ts }) });
      return { ok: true as const, removed: 2 };
    },
    orphanHistory: async () => [{ entry: 'main', petId: 'gone', messages: 4, lastTs: 1000 }],
    deleteOrphans: async () => ({ ok: true as const, pets: 1, messages: 4 }),
  } as unknown as PetRouteDeps;
  return { deps, calls };
}

/** DELETE /chat once; `query` is directly spelled after `?pet=main` (such as `&ts=1&ts=2`). */
function del(query = '', surface = 'web'): RouteInput {
  return {
    url: new URL(`http://127.0.0.1/dsh-pet-7340/chat?pet=main&surface=${surface}${query}`),
    rest: 'chat',
    method: 'DELETE',
  };
}

/** Get the JSON body of the response. */
function body(result: Awaited<ReturnType<typeof handleChatRoutes>>): Record<string, unknown> {
  assert.equal(result?.kind, 'json');
  return (result as { obj: Record<string, unknown> }).obj;
}

describe('DELETE /chat - Delete conversation memory', () => {
  test('Without ts → clear the whole one (the service receives undefined)', async () => {
    const { deps, calls } = makeDeps();
    const b = body(await handleChatRoutes(deps, del()));
    assert.equal(b.ok, true);
    assert.equal(b.removed, 2, 'The quantity given by the service should be brought back as is');
    assert.deepEqual(calls, [{ petId: 'main' }]);
  });

  test('With multiple ts → deduplicate and then download', async () => {
    const { deps, calls } = makeDeps();
    body(await handleChatRoutes(deps, del('&ts=1000&ts=2000&ts=1000')));
    assert.deepEqual(calls, [{ petId: 'main', ts: [1000, 2000] }]);
  });

  test('ts is invalid (negative number / decimal / non-digit / empty string) → bad-request, and the service is not called once', async () => {
    for (const bad of ['-1', '1.5', 'abc', '', '%20']) {
      const { deps, calls } = makeDeps();
      const b = body(await handleChatRoutes(deps, del(`&ts=${bad}`)));
      assert.equal(b.ok, false, bad);
      assert.equal(b.reason, 'bad-request', bad);
      assert.deepEqual(calls, [], `Illegal ts must be rejected before calling deleteHistory: ${bad}`);
    }
  });

  test('PUT and other methods are still 405 (the whitelist will not be relaxed just because DELETE is added)', async () => {
    const { deps } = makeDeps();
    const result = await handleChatRoutes(deps, { ...del(), method: 'PUT' });
    assert.equal((result as { status: number }).status, 405);
  });

  test('No verification surface: Deletion is storage management and has nothing to do with which end the pet is displayed on.', async () => {
    const { deps, calls } = makeDeps();
    const b = body(await handleChatRoutes(deps, del('', 'nope')));
    assert.equal(b.ok, true, 'Illegal surface should not be blocked from deletion');
    assert.equal(calls.length, 1);
  });

  test('Pet does not exist → unknown-pet of the service layer is transparently transmitted as is', async () => {
    const { deps } = makeDeps();
    const failing = {
      ...deps,
      deleteHistory: async () => ({ ok: false as const, reason: 'unknown-pet' as const, message: '没有这只桌宠' }),
    };
    const b = body(await handleChatRoutes(failing, del()));
    assert.equal(b.ok, false);
    assert.equal(b.reason, 'unknown-pet');
  });
});

describe('/ chat/memory - The remaining history of deleted pets', () => {
  /** One time / chat/memory request; no pet parameter required. */
  const memory = (method = 'GET'): RouteInput => ({
    url: new URL('http://127.0.0.1/dsh-pet-7340/chat/memory'),
    rest: 'chat/memory',
    method,
  });

  test('GET List residuals: only the number and last time are given, but the text is not given', async () => {
    const { deps } = makeDeps();
    const b = body(await handleChatRoutes(deps, memory()));
    assert.equal(b.ok, true);
    assert.deepEqual(b.orphans, [{ entry: 'main', petId: 'gone', messages: 4, lastTs: 1000 }]);
  });

  test('DELETE clears once and all remains, and the number of deleted pets and messages will be restored.', async () => {
    const { deps } = makeDeps();
    const b = body(await handleChatRoutes(deps, memory('DELETE')));
    assert.deepEqual(b, { ok: true, pets: 1, messages: 4 });
  });

  test('Other methods → 405 (the pair of endpoints read-only list and clear )', async () => {
    const { deps } = makeDeps();
    const result = await handleChatRoutes(deps, memory('POST'));
    assert.equal((result as { status: number }).status, 405);
  });
});

test('PowerContext status and sync leave orphan-history routes intact', async () => {
  const { deps: base } = makeDeps();
  let synced = false;
  const deps: PetRouteDeps = {
    ...base,
    memoryStatus: async () => ({
      ok: true,
      backend: 'powercontext',
      pending: synced ? 0 : 1,
      captured: synced ? 1 : 0,
      skipped: 0,
      scopeId: 'scope-test',
      recall: 'empty',
      error: null,
      processing: 'Source capture does not establish Memory extraction.',
    }),
    syncMemory: async () => {
      synced = true;
    },
  };
  const input: RouteInput = {
    rest: 'chat/powercontext',
    method: 'GET',
    url: new URL('http://127.0.0.1/dsh-pet-7340/chat/powercontext?pet=main'),
  };
  assert.equal(body(await handleChatRoutes(deps, input)).pending, 1);
  assert.equal(body(await handleChatRoutes(deps, { ...input, method: 'POST' })).pending, 0);
  assert.equal(((await handleChatRoutes(deps, { ...input, method: 'DELETE' })) as { status: number }).status, 405);
  assert.ok(Array.isArray(body(await handleChatRoutes(deps, { ...input, rest: 'chat/memory' })).orphans));
});

test('GET history reports the actual byte-bounded context separately from the display window', async () => {
  const { deps } = makeDeps();
  const { DEFAULT_CHAT_MEMORY } = await import('../../shared/chat-memory-config.ts');
  const messages = [1, 2, 3, 4].flatMap((ts) => [
    { role: 'user' as const, content: '甲'.repeat(700), ts },
    { role: 'assistant' as const, content: '乙'.repeat(700), ts },
  ]);
  const bounded = {
    ...deps,
    requirePet: () => ({
      ok: true as const,
      petId: 'main',
      entry: 'main',
      pet: {},
      conf: {
        chatMemory: { ...DEFAULT_CHAT_MEMORY, backend: 'powercontext', maxHistoryBytes: 6000 },
      },
    }),
    readMemory: async () => ({ main: { main: { messages } } }),
    memoryRounds: () => 4,
  };
  const result = body(await handleChatRoutes(bounded, { ...del('&rounds=200'), method: 'GET' }));
  assert.equal(result.rounds, 200);
  assert.equal((result.messages as unknown[]).length, 8);
  assert.equal(result.contextRounds, 1);
});
