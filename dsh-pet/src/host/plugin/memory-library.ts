/** 宠物记忆管理：只使用本机保存的服务与 scope，禁止浏览器指定远端地址。 */
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
    // 暂停采集后仍能管理同一服务已保存的记忆。
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
      // 结束当前对话后再更正/遗忘，避免仍在生成中的旧召回晚于成功提示出现。
      await deps.withLock(async () => {
        const { client, scope } = await resolve(petId);
        if (!scope) throw new Error('memory_not_found');
        await client.changeMemory(scope, change);
      });
    },
  };
}
