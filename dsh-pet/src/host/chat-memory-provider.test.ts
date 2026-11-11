/**
 * Contract test of memory provider register table: single slot, post-register coverage, disposer only clears itself,
 * native identifier cannot be occupied, there must be at least one recall/capture.
 */
import { beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  activeChatMemoryProvider,
  listChatMemoryProviders,
  NATIVE_MEMORY_ID,
  registerChatMemoryProvider,
  resetChatMemoryProviders,
  type ChatMemoryProvider,
} from './chat-memory-provider.ts';

describe('registerChatMemoryProvider', () => {
  beforeEach(() => resetChatMemoryProviders());

  test('Register becomes the current implementation; disposer clear', () => {
    const def: ChatMemoryProvider = { id: 'a', recall: async () => undefined };
    const dispose = registerChatMemoryProvider(def);
    assert.equal(activeChatMemoryProvider(), def);
    dispose();
    assert.equal(activeChatMemoryProvider(), null);
  });

  test('The last register overwrites the first register; the old disposer will not clear the new implementation', () => {
    const first: ChatMemoryProvider = { id: 'first', capture: () => {} };
    const second: ChatMemoryProvider = { id: 'second', capture: () => {} };
    const disposeFirst = registerChatMemoryProvider(first);
    registerChatMemoryProvider(second);
    disposeFirst();
    assert.equal(activeChatMemoryProvider(), second, 'Late cancellations shall not displace latecomers.');
  });

  test('Rejected native identifier, empty id, non-object and both methods missing', () => {
    assert.throws(() => registerChatMemoryProvider({ id: NATIVE_MEMORY_ID, recall: async () => undefined }), TypeError);
    assert.throws(() => registerChatMemoryProvider(null as never), TypeError);
    assert.throws(() => registerChatMemoryProvider({ id: '' } as never), TypeError);
    assert.throws(
      () => registerChatMemoryProvider({ id: 'x' } as never),
      TypeError,
      'Both methods are missing and must be rejected',
    );
    assert.throws(() => registerChatMemoryProvider({ id: 'x', recall: 1 } as never), TypeError);
  });

  test('list reports native identification and current third-party id', () => {
    assert.deepEqual(listChatMemoryProviders(), { builtin: [NATIVE_MEMORY_ID], external: [] });
    registerChatMemoryProvider({ id: 'pc', recall: async () => undefined });
    assert.deepEqual(listChatMemoryProviders(), { builtin: [NATIVE_MEMORY_ID], external: ['pc'] });
  });
});
