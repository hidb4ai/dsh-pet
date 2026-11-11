/** Configuration transaction of local memory: only change the memory field of the default entry, and retain other settings. */
import { DEFAULT_CHAT_MEMORY } from '../../shared/chat-memory-config.ts';

/** Configuration writing is performed serially by the host queue, and the latest configuration before persist to disk is read. */
export interface MemoryConfigStore {
  read(): Promise<Record<string, unknown>>;
  update(change: (main: Record<string, unknown>) => Record<string, unknown> | undefined): Promise<void>;
}

/** Bind native services to default pet entries; deactivation only unbinds the same service. */
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
