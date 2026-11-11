/**
 * The local state shape and external state contract of the dialog panel.
 *
 * Only declare the type: the value acquisition process belongs to ./state, and the action implementation belongs to
 * ./actions.
 * @module dsh-pet/src/client/chat/types
 */
import type { EncodedImage } from '../../shared/chat/encode.ts';
import type { Pet } from '../../shared/types.ts';
import type { ChatMessageView, ChatRound, OrphanHistory } from './api.ts';

/** All renderable fields of the panel; replaced at one time to avoid submitting half of multiple useState. */
export interface PanelData {
  readonly pets: Pet[];
  readonly petId: string;
  readonly messages: ChatMessageView[];
  /** Host actually selects the number of recent historical rounds for the next conversation by rounds and bytes budget. */
  readonly contextRounds?: number;
  readonly draft: string;
  /** Picture to be sent; undefined = This item is pure text. */
  readonly attachment: EncodedImage | undefined;
  readonly busy: boolean;
  readonly loading: boolean;
  readonly error: string;
  /** Checked wheel (`ts`), delete according to this set. */
  readonly selected: number[];
  /** Multi-select mode: off by default, the check box only appears after it is turned on. */
  readonly selecting: boolean;
  /** The remaining history of deleted pets (pets that are no longer in the configuration) is used for top prompts and one-click cleanup. */
  readonly orphans: OrphanHistory[];
  /** Destructive operation awaiting confirmation; null = None. */
  readonly pending: ConfirmKind | null;
  /** How many rounds are currently displayed (default 10): The earlier ones are left in the memory, click "Load Earlier" and then release them. */
  readonly visibleRounds: number;
  /** The image address being enlarged; undefined = No preview. */
  readonly previewUrl: string | undefined;
  /** entry (asset root) → the number of dialogue turns retained by this entry; from the same `/config`. */
  readonly roundsByEntry: Readonly<Record<string, number>>;
  /** Pet id → The actual persona text in use; comes from the same `/config` as the round number. */
  readonly personas: Readonly<Record<string, string>>;
  /** Whether the "persona" roller blind is expanded: When it is retracted, the content remains in DOM and the height is returned to zero. Only after the expansion transition can it be played. */
  readonly personaOpen: boolean;
  /** The round and stage of the playback request; null = Not playing. Only one message is broadcast at the same time. */
  readonly speaking: { readonly ts: number; readonly phase: 'loading' | 'playing' | 'failed' } | null;
  /** The cache-breaking version number of the avatar address: change it when opening the panel and refreshing it, and the browser will re-fetch the image (especially necessary after changing the avatar). */
  readonly avatarVersion: number;
}

/** Destructive operations that require secondary confirmation: use the confirmation bar in the panel instead of the browser's native `confirm`. */
export type ConfirmKind = 'delete-selected' | 'clear-all' | 'clear-orphans';

/** The minimum shape of the input box button: both native KeyboardEvent and React synthesis events can be transmitted directly. */
export interface DraftKeyEvent {
  readonly key: string;
  readonly shiftKey: boolean;
  /** The old flag when the input method swallows keys (the React synthesis event also retains it). */
  readonly keyCode?: number;
  /** Automatic repeat: reissued by the system when long pressed. */
  readonly repeat?: boolean;
  /** Native events are directly attached; React synthesis events are only attached to {@link DraftKeyEvent.nativeEvent}. */
  readonly isComposing?: boolean;
  /** The original event of the React synthesis event. */
  readonly nativeEvent?: { readonly isComposing?: boolean };
  readonly preventDefault: () => void;
}

/** hook Returns: status, derived values, actions, and list references. */
export interface ChatPanelState extends PanelData {
  /** The current round to be rendered (has been intercepted by {@link PanelData.visibleRounds}). */
  readonly rounds: readonly ChatRound[];
  /** There are earlier rounds in the memory that are not displayed. */
  readonly hasOlder: boolean;
  /** Put in an extra batch to come out earlier. */
  readonly showOlder: () => void;
  readonly petName: string;
  readonly assetRoot: string;
  /** The number of recent rounds actually selected by host; no line is drawn before loading. Long-term memory independent recall. */
  readonly memoryRounds: number | undefined;
  /** The history is indeed more than the number of memory rounds, which line can be drawn; when it is false, the "Memory Line" button will be grayed out. */
  readonly hasMemoryLine: boolean;
  /** Scroll to the memory dividing line; release it first while the line is still in the earlier page that has not been released. */
  readonly jumpToMemory: () => void;
  /** Reread the configuration and history (there is no need to refresh the entire page after changing the dialog configuration). */
  readonly refresh: () => void;
  /** The persona text currently used by this pet; empty string = neither instance nor entry is written. */
  readonly persona: string;
  /** Expand/collapse persona roller blind. */
  readonly togglePersona: () => void;
  /** Close the persona roller blind (Esc). */
  readonly closePersona: () => void;
  /** Message list container: Used when scrolling to the bottom. */
  readonly listRef: { current: HTMLDivElement | null };
  /** Input box: When the content becomes high, change it directly to height. */
  readonly draftRef: { current: HTMLTextAreaElement | null };
  readonly pickPet: (petId: string) => void;
  readonly toggleRound: (ts: number) => void;
  /** Enter/exit multi-select mode; clear is checked when exiting. */
  readonly toggleSelecting: () => void;
  readonly deleteSelected: () => void;
  readonly clearAll: () => void;
  /** Clear the remaining history of deleted pets ("Clear" on the top prompt bar). */
  readonly clearOrphans: () => void;
  /** Requesting confirmation of a destructive operation (only the confirmation bar pops up and is not executed). */
  readonly ask: (kind: ConfirmKind) => void;
  /** Cancel confirmation bar. */
  readonly cancelAsk: () => void;
  /** Confirm and execute; do nothing if there are no items to confirm. */
  readonly confirmAsk: () => void;
  /** Enlarge a conversation picture. */
  readonly showImage: (url: string) => void;
  /** Turn off image enlargement. */
  readonly closeImage: () => void;
  readonly setDraft: (text: string) => void;
  /** Input box button: press Enter and the input method is not sent during combination, and the rest is left to the input box as it is. */
  readonly onDraftKeyDown: (event: DraftKeyEvent) => void;
  /** Input method starts combining (compositionstart corresponding to textarea). */
  readonly onDraftCompositionStart: () => void;
  /** Input method end combination (corresponding to compositionend of textarea). */
  readonly onDraftCompositionEnd: () => void;
  /** playback request The answer for a certain round: request synthesis → play → return, and the stage is written into {@link PanelData.speaking}. */
  readonly speakRound: (ts: number, text: string) => void;
  /** Let the pet replay the action performed in a certain round of answering (the name comes from `action` in memory). */
  readonly playAction: (name: string) => void;
  readonly pickFile: (file: File) => void;
  readonly clearAttachment: () => void;
  readonly send: () => void;
}
