/**
 * Side effects of the panel: first installation, bottom scrolling, input box automatically growing taller, refreshing
 * with desktop pet's voice.
 *
 * The four things are tied to DOM / external data source and lifecycle, and are separated from state reduction; data
 * is passed in from ./state, and no state is maintained here.
 * @module dsh-pet/src/client/chat/effects
 */
import { getStateSnapshot, subscribeStateSnapshot } from '../state-service.ts';
import { fetchChatConfig, fetchOrphans } from './api.ts';
import { INPUT_MAX_HEIGHT } from './metrics.ts';
import type { ChatPanelRuntime } from './runtime.ts';
import type { PanelData } from './types.ts';

/** Side effect requires state and handle. */
export interface ChatEffectsInput {
  readonly data: PanelData;
  readonly patch: (next: Partial<PanelData>) => void;
  readonly fail: (error: unknown) => void;
  readonly reload: (petId: string) => Promise<void>;
  readonly listRef: { current: HTMLDivElement | null };
  readonly draftRef: { current: HTMLTextAreaElement | null };
  /** The message `ts` that has been posted to the bottom: it will automatically scroll to the bottom only when it changes. */
  readonly newestTs: { current: number };
}

/**
 * Create side effect hook.
 *
 * @param rt - Injected react capabilities.
 * @returns receives status and handle of hook; no return value.
 */
export function createChatEffects(rt: ChatPanelRuntime): (input: ChatEffectsInput) => void {
  const { useEffect } = rt;

  return function useChatEffects(input: ChatEffectsInput): void {
    const { data, fail, listRef, draftRef, newestTs, patch, reload } = input;

    // First Assembly: Pet List + Orphan Tips + First Pet History. It only runs once, so the dependencies are left blank.
    useEffect(() => {
      void (async () => {
        try {
          // The orphan history is pulled together with the configuration: the configuration also carries the memory round number of each entry (used for memory boundary lines)
          const [config, orphans] = await Promise.all([fetchChatConfig(), fetchOrphans().catch(() => [])]);
          const first = config.pets[0]?.id ?? '';
          patch({
            pets: config.pets,
            roundsByEntry: config.roundsByEntry,
            personas: config.personaByPet,
            petId: first,
            orphans,
          });
          await reload(first);
        } catch (error) {
          fail(error);
        } finally {
          patch({ loading: false });
        }
      })();
      // reload/fail/patch are recreated during rendering; depending on them would repeatedly run this effect.
      // eslint-disable-next-line react-hooks/exhaustive-deps -- Run once on mount, as described above.
    }, []);

    // Stick to the bottom only if "there is an updated one": forward loading of earlier rounds should not drag the view away
    useEffect(() => {
      const el = listRef.current;
      if (el === null) return;
      const newest = data.messages[data.messages.length - 1]?.ts ?? 0;
      if (newest === newestTs.current) return;
      newestTs.current = newest;
      el.scrollTop = el.scrollHeight;
      // Track only the message list; all other handles are stable references.
      // eslint-disable-next-line react-hooks/exhaustive-deps -- Dependencies are explained above.
    }, [data.messages]);

    // The input box grows taller with the content: first reset it to zero and then return it to scrollHeight, otherwise the height will not shrink when you delete words.
    useEffect(() => {
      const el = draftRef.current;
      if (el === null) return;
      el.style.height = 'auto';
      el.style.height = Math.min(el.scrollHeight, INPUT_MAX_HEIGHT) + 'px';
      // eslint-disable-next-line react-hooks/exhaustive-deps -- Handles are stable references.
    }, [data.draft]);

    // Pet replies also update pets.<id>.say. Refresh history when its counter changes so an open panel sees new
    // replies without rereading storage on every poll.
    useEffect(() => {
      const petId = data.petId;
      if (petId === '') return;
      let last = getStateSnapshot()?.pets[petId]?.say?.counter ?? 0;
      return subscribeStateSnapshot((snapshot) => {
        const counter = snapshot.pets[petId]?.say?.counter ?? 0;
        if (counter === last) return;
        last = counter;
        void reload(petId);
      });
      // Resubscribe only when the pet changes; reload is recreated each render.
      // eslint-disable-next-line react-hooks/exhaustive-deps -- Dependencies are explained above.
    }, [data.petId]);
  };
}
