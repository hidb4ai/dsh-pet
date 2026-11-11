/** 本机记忆的配置事务：只改默认条目的记忆字段，保留其它设置。 */
import { DEFAULT_CHAT_MEMORY } from '../../shared/chat-memory-config.ts';

/** 配置写入由宿主队列串行执行，变换读取的是落盘前的最新配置。 */
export interface MemoryConfigStore {
  read(): Promise<Record<string, unknown>>;
  update(change: (main: Record<string, unknown>) => Record<string, unknown> | undefined): Promise<void>;
}

/** 将本机服务绑定到默认宠物条目；停用只解除同一服务的绑定。 */
export function memoryConfigBinding(store: MemoryConfigStore) {
  return {
    async matches(url: string) {
      const memory = (await store.read()).chatMemory as { backend?: string; serverUrl?: string };
      return memory?.backend === 'powercontext' && memory.serverUrl === url;
    },
    async checkpoint() {
      const before = await store.read();
      return async () => {
        await store.update(() => ({ chatMemoryRounds: before.chatMemoryRounds, chatMemory: before.chatMemory }));
      };
    },
    async save(url: string, enabled: boolean) {
      await store.update((main) => {
        const memory = main.chatMemory as { backend?: string; serverUrl?: string };
        const matched = memory?.serverUrl === url;
        if (!enabled && (memory?.backend !== 'powercontext' || !matched)) return;
        return {
          chatMemoryRounds: enabled && !matched ? 4 : main.chatMemoryRounds,
          chatMemory: enabled
            ? matched
              ? { ...memory, backend: 'powercontext' }
              : { ...DEFAULT_CHAT_MEMORY, backend: 'powercontext', serverUrl: url, maxHistoryBytes: 6000 }
            : { ...memory, backend: 'native' },
        };
      });
    },
  };
}
