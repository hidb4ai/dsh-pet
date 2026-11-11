/**
 * Stateful assembly of dialog panels (factory injected with react).
 *
 * Only assembly: see ./types for shape, ./actions for action, ./effects for side effect, and ./api for number. Use one
 * state object to hold all fields - to switch pets, you need to clear the message and check at the same time.
 * Splitting into multiple useState will reveal the intermediate state.
 * @module dsh-pet/src/client/chat/state
 */
import { speakText } from '../../shared/voice.ts';
import { createCompositionWatch, decideEnter } from '../../shared/chat/enter.ts';
import type { CompositionWatch } from '../../shared/chat/enter.ts';
import {
  fetchHistory,
  groupRounds,
  memoryBoundaryIndex,
  MEMORY_LINE_ATTR,
  playAction as requestPlayAction,
  roundsToRevealMemory,
} from './api.ts';
import { createHistoryActions, createSendActions, createShellActions } from './actions.ts';
import { createChatEffects } from './effects.ts';
import type { ChatPanelRuntime } from './runtime.ts';
import type { ChatPanelState, DraftKeyEvent, PanelData } from './types.ts';

/** The first screen and the number of rounds released each time "load earlier". */
const PAGE_ROUNDS = 10;

/** Initial state: empty list + loading. */
const INITIAL: PanelData = {
  pets: [],
  petId: '',
  messages: [],
  draft: '',
  attachment: undefined,
  busy: false,
  loading: true,
  error: '',
  selected: [],
  selecting: false,
  orphans: [],
  pending: null,
  visibleRounds: PAGE_ROUNDS,
  previewUrl: undefined,
  roundsByEntry: {},
  personas: {},
  personaOpen: false,
  speaking: null,
  avatarVersion: 0,
};

/**
 * Create status hook.
 *
 * @param rt - Injected react capabilities.
 * @returns No parameters hook: Each rendering returns the current state, derived values and actions.
 */
export function createPetChatState(rt: ChatPanelRuntime): () => ChatPanelState {
  const { useRef, useState } = rt;
  const useChatEffects = createChatEffects(rt);

  return function usePetChatState(): ChatPanelState {
    // The version number is generated when the panel is mounted: it must be remounted every time the panel is opened. If you change the avatar and reopen it, you will definitely get the new picture.
    const [data, setData] = useState<PanelData>({ ...INITIAL, avatarVersion: Date.now() });
    const listRef = useRef<HTMLDivElement | null>(null);
    const draftRef = useRef<HTMLTextAreaElement | null>(null);
    /** Input method combination state: must survive across renderings. Rebuilding once will forget "composing". */
    const imeRef = useRef<CompositionWatch | null>(null);
    const ime = (imeRef.current ??= createCompositionWatch());
    /** The message that has been posted to the bottom (`ts`): it will automatically scroll to the bottom only when it changes. */
    const newestTs = useRef(0);

    const patch = (next: Partial<PanelData>): void => setData((prev) => ({ ...prev, ...next }));
    const fail = (error: unknown): void => patch({ error: error instanceof Error ? error.message : String(error) });

    /** Reread the history of a certain pet; the failure only falls on error, and there is no silent clear message. */
    const reload = async (petId: string): Promise<void> => {
      if (petId === '') return;
      try {
        const snapshot = await fetchHistory(petId);
        setData((prev) => (prev.petId === petId ? { ...prev, ...snapshot } : prev));
      } catch (error) {
        fail(error);
      }
    };

    useChatEffects({ data, patch, fail, reload, listRef, draftRef, newestTs });

    const ports = { read: () => data, patch, fail, reload };
    const history = createHistoryActions(ports);
    const shell = createShellActions({ ports, history, listRef, pageRounds: PAGE_ROUNDS });
    const sendActions = createSendActions(ports);
    const pet = data.pets.find((one) => one.id === data.petId);
    const allRounds = groupRounds(data.messages);
    const rounds = allRounds.slice(-data.visibleRounds);
    const memoryRounds = data.contextRounds;

    /** The dividing line element: exists only if it falls within the current window. */
    const findMemoryLine = (el: HTMLElement): Element | null => el.querySelector('[' + MEMORY_LINE_ATTR + ']');

    return {
      ...data,
      ...sendActions,
      ...history,
      ...shell,
      rounds,
      hasOlder: allRounds.length > rounds.length,
      petName: pet?.name || '宠',
      assetRoot: pet?.assetRoot ?? '',
      memoryRounds,
      hasMemoryLine: memoryBoundaryIndex(allRounds.length, memoryRounds) !== null,
      jumpToMemory: () => {
        const el = listRef.current;
        if (el === null) return;
        const line = findMemoryLine(el);
        if (line !== null) {
          line.scrollIntoView({ block: 'center', behavior: 'smooth' });
          return;
        }
        // The line is still in the "loaded earlier" section that has not been released: first expand the window until you can see it, and then scroll to the next frame.
        if (memoryRounds === undefined || memoryBoundaryIndex(allRounds.length, memoryRounds) === null) return;
        patch({ visibleRounds: Math.max(data.visibleRounds, roundsToRevealMemory(memoryRounds)) });
        requestAnimationFrame(() => {
          findMemoryLine(el)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        });
      },
      persona: data.personas[data.petId] ?? '',
      togglePersona: () => patch({ personaOpen: !data.personaOpen }),
      closePersona: () => patch({ personaOpen: false }),
      listRef,
      draftRef,
      pickPet: (petId: string) => {
        patch({
          petId,
          messages: [],
          contextRounds: undefined,
          selected: [],
          selecting: false,
          pending: null,
          visibleRounds: PAGE_ROUNDS,
          error: '',
        });
        void reload(petId);
      },
      toggleSelecting: () => patch({ selecting: !data.selecting, selected: [] }),
      toggleRound: (ts: number) =>
        patch({
          selected: data.selected.includes(ts) ? data.selected.filter((one) => one !== ts) : [...data.selected, ts],
        }),
      setDraft: (draft: string) => patch({ draft }),
      onDraftKeyDown: (event: DraftKeyEvent) => {
        // The React synthesis event does not carry isComposing and is only hung on nativeEvent; the native event directly has
        const isComposing = event.isComposing === true || event.nativeEvent?.isComposing === true;
        const sendKey = {
          key: event.key,
          shiftKey: event.shiftKey,
          isComposing,
          keyCode: event.keyCode,
          repeat: event.repeat,
        };
        const action = decideEnter(sendKey, ime, performance.now());
        if (action === 'ignore') return;
        event.preventDefault();
        if (action === 'send') sendActions.send();
      },
      onDraftCompositionStart: ime.start,
      onDraftCompositionEnd: () => ime.end(performance.now()),
      speakRound: (ts: number, text: string) => {
        // Phase callback write-only "still this round" state: when it is pushed out by another one, the old requested idle cannot clear the new state
        speakText(text, (phase) => {
          setData((prev) => {
            if (phase === 'idle') return prev.speaking?.ts === ts ? { ...prev, speaking: null } : prev;
            return { ...prev, speaking: { ts, phase } };
          });
        });
      },
      playAction: (name: string) => {
        // No request is sent when no pet is selected: empty id will be rejected by the host pressing bad-request
        if (data.petId !== '') void requestPlayAction(data.petId, name);
      },
      clearAttachment: () => patch({ attachment: undefined }),
      showImage: (previewUrl: string) => patch({ previewUrl }),
      closeImage: () => patch({ previewUrl: undefined }),
    };
  };
}
