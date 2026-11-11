/**
 * Dialog panel actions: memory delete, send, attach pictures, confirm distribution and "load earlier".
 *
 * It is assembled with the current state by ./state; no state is held here, and only a user action is translated into
 * "Debug interface → patch". Each action handles the exception by itself and hands it to the fail port. What the
 * caller gets is always a synchronous empty return.
 * @module dsh-pet/src/client/chat/actions
 */
import { encodeImageFile } from '../../shared/chat/encode.ts';
import {
  clearHistory,
  clearOrphans as clearOrphansApi,
  deleteRounds,
  fetchChatConfig,
  fetchOrphans,
  sendMessage,
  type DeleteResult,
} from './api.ts';
import type { ConfirmKind, PanelData } from './types.ts';

/** The minimum port required for the action. */
export interface ActionPorts {
  /** Read and write the current state snapshot (each time rendering and reconstruction, the latest value is obtained). */
  readonly read: () => PanelData;
  /** Merge status patch once. */
  readonly patch: (next: Partial<PanelData>) => void;
  /** Convert any exceptions into displayable copy. */
  readonly fail: (error: unknown) => void;
  /** Retrieve the history of a certain pet. */
  readonly reload: (petId: string) => Promise<void>;
}

/** Memory action: press wheel to delete and clear the whole thing. */
export function createHistoryActions(ports: ActionPorts): {
  deleteSelected: () => void;
  clearAll: () => void;
} {
  /** Run once to delete: only error will be reported if failed; clear the check box after success and re-read based on the server. */
  const apply = async (run: () => Promise<DeleteResult>): Promise<void> => {
    try {
      const result = await run();
      if (!result.ok) {
        ports.fail(result.message);
        return;
      }
      ports.patch({ selected: [], error: '' });
      await ports.reload(ports.read().petId);
    } catch (error) {
      ports.fail(error);
    }
  };

  return {
    deleteSelected: (): void => {
      const { petId, selected } = ports.read();
      if (petId === '' || selected.length === 0) return;
      void apply(() => deleteRounds(petId, selected));
    },
    clearAll: (): void => {
      const { petId } = ports.read();
      if (petId === '') return;
      void apply(() => clearHistory(petId));
    },
  };
}

/** Send action: compress the image, send it, and reread it after success. */
export function createSendActions(ports: ActionPorts): {
  send: () => void;
  pickFile: (file: File) => void;
} {
  return {
    send: (): void => {
      const data = ports.read();
      const text = data.draft.trim();
      if (text === '' || data.busy || data.petId === '') return;
      ports.patch({ busy: true, error: '' });
      void (async () => {
        try {
          const attachment =
            data.attachment === undefined
              ? undefined
              : { mediaType: data.attachment.mediaType, data: data.attachment.base64 };
          const result = await sendMessage(data.petId, text, attachment);
          if (!result.ok) {
            ports.fail(result.message);
            return;
          }
          ports.patch({ draft: '', attachment: undefined });
          await ports.reload(data.petId);
        } catch (error) {
          ports.fail(error);
        } finally {
          ports.patch({ busy: false });
        }
      })();
    },
    pickFile: (file: File): void => {
      void (async () => {
        try {
          ports.patch({ attachment: await encodeImageFile(file), error: '' });
        } catch (error) {
          ports.fail(error);
        }
      })();
    },
  };
}

/** Additional handle required for shell actions. */
export interface ShellDeps {
  readonly ports: ActionPorts;
  /** Amnestic action (to be distributed to them after confirmation). */
  readonly history: { deleteSelected: () => void; clearAll: () => void };
  /** Message List Container: Compensate scrolling by height difference when expanding earlier wheels. */
  readonly listRef: { current: HTMLDivElement | null };
  /** The number of rounds released each time "load earlier". */
  readonly pageRounds: number;
}

/** Shell actions: orphan cleanup, confirmation bar distribution, refresh and "load earlier". */
export function createShellActions(deps: ShellDeps): {
  clearOrphans: () => void;
  ask: (kind: ConfirmKind) => void;
  cancelAsk: () => void;
  confirmAsk: () => void;
  refresh: () => void;
  showOlder: () => void;
} {
  const { ports, history, listRef, pageRounds } = deps;

  /** Clear the remaining history of deleted pets. */
  const clearOrphans = (): void => {
    void (async () => {
      try {
        const result = await clearOrphansApi();
        if (!result.ok) {
          ports.fail(result.message);
          return;
        }
        ports.patch({ orphans: [], error: '' });
      } catch (error) {
        ports.fail(error);
      }
    })();
  };

  /** Distribute according to to-do type after confirming "OK"; clear pending first to avoid repeated triggering. */
  const confirmAsk = (): void => {
    const kind = ports.read().pending;
    ports.patch({ pending: null });
    if (kind === 'delete-selected') history.deleteSelected();
    else if (kind === 'clear-all') history.clearAll();
    else if (kind === 'clear-orphans') clearOrphans();
  };

  /** Put in a batch of earlier wheels; compensate the rolling position according to the height difference, and the line of sight does not jump. */
  const showOlder = (): void => {
    const el = listRef.current;
    const before = el?.scrollHeight ?? 0;
    ports.patch({ visibleRounds: ports.read().visibleRounds + pageRounds });
    if (el === null) return;
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight - before;
    });
  };

  /**
   * Reread configuration, orphan prompts, and current pet history: There is no need to refresh the entire page after
   * changing the conversation configuration. The current pet may have been deleted (the configuration was re-pulled) →
   * fallback to the first pet, otherwise the panel will stop on a non-existent pet.
   */
  const refresh = (): void => {
    void (async () => {
      try {
        const [config, orphans] = await Promise.all([fetchChatConfig(), fetchOrphans().catch(() => [])]);
        const { petId } = ports.read();
        const nextPetId = config.pets.some((one) => one.id === petId) ? petId : (config.pets[0]?.id ?? '');
        ports.patch({
          pets: config.pets,
          roundsByEntry: config.roundsByEntry,
          personas: config.personaByPet,
          orphans,
          petId: nextPetId,
          // Reload from disk and advance the avatar version so a recently uploaded image bypasses the browser cache.
          avatarVersion: Date.now(),
          error: '',
        });
        await ports.reload(nextPetId);
      } catch (error) {
        ports.fail(error);
      }
    })();
  };

  return {
    clearOrphans,
    ask: (kind: ConfirmKind) => ports.patch({ pending: kind }),
    cancelAsk: () => ports.patch({ pending: null }),
    confirmAsk,
    refresh,
    showOlder,
  };
}
