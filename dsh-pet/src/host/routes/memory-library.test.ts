/** 记忆管理路由的写入边界：宠物绑定、字段校验和失败回执。 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handleMemoryLibraryRoutes } from './memory-library.ts';
import type { PetRouteDeps, RouteInput } from './types.ts';
import type { MemoryChange } from '../../shared/memory-library.ts';
import { MemoryServiceError } from '../powercontext.ts';

function fixture() {
  const calls: unknown[] = [];
  const deps = {
    configPaths: {},
    requirePet: () => ({ ok: true, petId: 'verified-pet', entry: 'main', conf: {}, pet: {} }),
    listMemories: async (pet: string, cursor?: string) => {
      calls.push({ pet, cursor });
      return { items: [], nextCursor: null };
    },
    inspectMemory: async (pet: string, id: string) => {
      calls.push({ pet, id });
      return { revision: 1, createdAt: null, sources: [] };
    },
    changeMemory: async (pet: string, change: MemoryChange) => {
      calls.push({ pet, change });
    },
  } as unknown as PetRouteDeps;
  const input: RouteInput = {
    rest: 'chat/powercontext/memories',
    method: 'GET',
    url: new URL('http://localhost/dsh-pet-7340/chat/powercontext/memories?pet=untrusted'),
  };
  return { calls, deps, input };
}

const change = { action: 'correct', id: 'memory-1', revision: 2, stateVersion: 0, text: '现在喝乌龙茶' };

test('management operations use the validated pet binding and distinguish an empty page', async () => {
  const { calls, deps, input } = fixture();
  const page = await handleMemoryLibraryRoutes(deps, input);
  assert.equal(page?.kind, 'json');
  assert.deepEqual((page as { obj: unknown }).obj, { ok: true, items: [], nextCursor: null });
  await handleMemoryLibraryRoutes(deps, { ...input, method: 'POST', body: JSON.stringify(change) });
  assert.deepEqual(calls, [
    { pet: 'verified-pet', cursor: undefined },
    { pet: 'verified-pet', change },
  ]);
});

test('invalid versions, injected endpoints and oversized UTF-8 corrections never reach the service', async () => {
  const { calls, deps, input } = fixture();
  for (const patch of [
    { revision: 0 },
    { stateVersion: -1 },
    { scope: 'other-pet' },
    { serverUrl: 'https://other' },
    { text: '中'.repeat(3000) },
    { text: '   ' },
  ]) {
    const result = await handleMemoryLibraryRoutes(deps, {
      ...input,
      method: 'POST',
      body: JSON.stringify({ ...change, ...patch }),
    });
    assert.equal(result?.kind, 'json');
    assert.equal((result as { obj: { ok: boolean } }).obj.ok, false);
  }
  assert.equal(calls.length, 0);
});

test('a failed remote mutation never returns success or provider details', async () => {
  const { deps, input } = fixture();
  const failed = {
    ...deps,
    changeMemory: async () => {
      throw new MemoryServiceError('http_412');
    },
  };
  const result = await handleMemoryLibraryRoutes(failed, { ...input, method: 'POST', body: JSON.stringify(change) });
  const body = (result as { obj: { ok: boolean; message: string } }).obj;
  assert.equal(body.ok, false);
  assert.equal(body.message, 'http_412');
});
