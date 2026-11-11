/**
 * Query and clean up the remaining history of deleted pets.
 *
 * After the pet is deleted from the configuration, the buckets in `memory.json` are still there, but `GET /chat`
 * requires the pet to exist - this kind of history can only be seen and cleared from here. The read-write lock and
 * file handle are still owned by ./chat-memory (it holds the serial queue).
 * @module dsh-pet/src/host/plugin/memory-orphans
 */
import type { ChatMemoryMessage } from '../chat.ts';
import { findPetInstance, readAllConfig, type ConfigPaths } from '../config.ts';

/** Memory file shape (consistent with chat-memory reading and writing). */
type MemoryFile = Record<string, Record<string, { messages: ChatMemoryMessage[] }>>;

/** Summary of a residual bucket (without text). */
export interface OrphanBucket {
  readonly entry: string;
  readonly petId: string;
  readonly messages: number;
  readonly lastTs: number;
}

/** Depends on: configuration path, memory reading and writing, serial queue and log export. */
export interface OrphanDeps {
  readonly configPaths: ConfigPaths;
  readonly readMemory: () => Promise<MemoryFile>;
  readonly writeMemory: (mem: MemoryFile) => Promise<void>;
  readonly withLock: <T>(fn: () => Promise<T>) => Promise<T>;
  /** Only the quantity is recorded, not the text. */
  readonly log: { info(message: string): void };
}

/**
 * Query and clean up residual history.
 *
 * @param deps - Configure paths, memory reads and writes, and serial queues.
 * @returns query (read-only) and cleanup (read, modify and write within the lock).
 */
export function createMemoryOrphans(deps: OrphanDeps) {
  const { configPaths, readMemory, writeMemory, withLock } = deps;
  /** Read the pet buckets that no longer exist in the configuration; only read the number and last time, without the text. */
  const orphanHistory = async (): Promise<OrphanBucket[]> => {
    const cfg = readAllConfig(configPaths);
    const mem = await readMemory();
    const out: OrphanBucket[] = [];
    for (const [entry, byPet] of Object.entries(mem)) {
      if (!byPet || typeof byPet !== 'object') continue;
      for (const [petId, leaf] of Object.entries(byPet)) {
        if (findPetInstance(cfg, petId)) continue;
        const list = Array.isArray(leaf?.messages) ? leaf.messages : [];
        out.push({ entry, petId, messages: list.length, lastTs: Number(list[list.length - 1]?.ts ?? 0) });
      }
    }
    return out;
  };

  /** Clear all remaining buckets; remove empty entries as well. */
  const deleteOrphans = async (): Promise<{ ok: true; pets: number; messages: number }> =>
    withLock(async () => {
      const cfg = readAllConfig(configPaths);
      const mem = await readMemory();
      let pets = 0;
      let messages = 0;
      for (const [entry, byPet] of Object.entries(mem)) {
        if (!byPet || typeof byPet !== 'object') continue;
        for (const [petId, leaf] of Object.entries(byPet)) {
          if (findPetInstance(cfg, petId)) continue;
          messages += Array.isArray(leaf?.messages) ? leaf.messages.length : 0;
          pets += 1;
          delete byPet[petId];
        }
        if (Object.keys(byPet).length === 0) delete mem[entry];
      }
      if (pets > 0) await writeMemory(mem);
      deps.log.info(`[dsh-pet] Removed history for deleted pets: pets=${pets}, messages=${messages}`);
      return { ok: true as const, pets, messages };
    });

  return { orphanHistory, deleteOrphans };
}
