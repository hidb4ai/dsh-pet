/** Pet memory management: Only use locally saved services and scope, and prohibit the browser from specifying remote addresses. */
import { findPetInstance, readAllConfig, type ConfigPaths } from '../config.ts';
import { chatMemoryConfigValid } from '../../shared/chat-memory-config.ts';
import { PowerContextClient, memoryTarget, type MemoryEntryState } from '../powercontext.ts';
import type { MemoryChange, MemoryEvidence, MemoryPage } from '../../shared/memory-library.ts';

export function createPetMemoryLibrary(deps: {
  configPaths: ConfigPaths;
  readMemory: () => Promise<Record<string, Record<string, MemoryEntryState>>>;
  withLock: <T>(fn: () => Promise<T>) => Promise<T>;
}) {
  const resolve = async (petId: string) => {
    const found = findPetInstance(readAllConfig(deps.configPaths), petId);
    if (!found || !chatMemoryConfigValid(found.conf.chatMemory)) throw new Error('memory_disabled');
    const config = found.conf.chatMemory;
    // Saved memories of the same service can still be managed after pausing collection.
    const state = (await deps.readMemory())[found.entry]?.[petId]?.powercontext?.[memoryTarget(config)];
    return { client: new PowerContextClient(config), scope: state?.scopeId };
  };
  return {
    async listMemories(petId: string, cursor?: string): Promise<MemoryPage> {
      const { client, scope } = await resolve(petId);
      return scope ? client.listMemories(scope, cursor) : { items: [], nextCursor: null };
    },
    async inspectMemory(petId: string, id: string): Promise<MemoryEvidence> {
      const { client, scope } = await resolve(petId);
      if (!scope) throw new Error('memory_not_found');
      return client.inspectMemory(scope, id);
    },
    async changeMemory(petId: string, change: MemoryChange): Promise<void> {
      // End the current conversation before correcting/forgetting to avoid the old recall that is still being generated from appearing later than the success prompt.
      await deps.withLock(async () => {
        const { client, scope } = await resolve(petId);
        if (!scope) throw new Error('memory_not_found');
        await client.changeMemory(scope, change);
      });
    },
  };
}
