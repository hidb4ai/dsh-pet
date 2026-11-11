/**
 * Third-party implementation of dialogue memory register table: single slot, the latter register overwrites the first
 * register.
 *
 * One slot instead of Map: The memory backend is a choice of two (native/third-party). If two recall change the
 * content at the same time, they will conflict with each other. If two capture are uploaded at the same time, they
 * will be written repeatedly. Module singleton: register returns disposer and is reset with resetChatMemoryProviders
 * for testing. Only registration and search, no calling, no patch verification, no persist to disk.
 * @module dsh-pet/src/host/chat-memory-provider
 */

/** Identification of the native implementation; third parties cannot occupy it (the slot is empty, which means the native path). */
export const NATIVE_MEMORY_ID = 'native';

/** Historical messages passed to recall hook: only the three fields required for the conversation are given, without image references and action names. */
export interface ChatTurn {
  readonly role: 'user' | 'assistant';
  readonly content: string;
  readonly ts: number;
}

/** The content that will be sent to the model this round; recall hook uses it to modify it. */
export interface ChatContent {
  readonly system: string;
  readonly history: readonly ChatTurn[];
  readonly userText: string;
}

/** The return of recall hook: only the returned fields are overwritten, and the original values that are not returned are kept. */
export interface ChatContentPatch {
  readonly system?: string;
  readonly history?: readonly ChatTurn[];
  readonly userText?: string;
}

/**
 * Third-party memory implementation: modify content before dialogue and receive after persist to disk, both are
 * optional.
 *
 * Only implement recall = read-only memory; implement only capture = only remember but not check; implement both =
 * complete backend.
 */
export interface ChatMemoryProvider {
  /** Unique identifier; participating in the log, the implementation will not hit the old state. */
  readonly id: string;
  /**
   * Modify content before dialogue: Return the fields to be covered, merge the core and then hand it to the model.
   *
   * If an error is thrown or timeout occurs, the core downgrades it to "no modification", which does not affect the
   * reply; returning undefined is equivalent to no modification.
   * @param input - Current round of questions, persona and screenshots of recent history.
   * @returns Fields to be overwritten; undefined is returned when no fields are changed.
   */
  recall?(
    input: ChatContent & { readonly petId: string },
  ): Promise<ChatContentPatch | undefined> | ChatContentPatch | undefined;
  /**
   * persist to disk and then receive this round of questions and answers.
   *
   * The core does not wait: the return value is ignored, and errors are only logged and do not affect the reply.
   * @param input - This round of Q&A and meta-information; action/image is just the name and does not contain the
   * asset itself.
   */
  capture?(input: {
    readonly petId: string;
    readonly userText: string;
    readonly replyText: string;
    readonly action?: string;
    readonly image?: string;
    readonly ts: number;
  }): void | Promise<void>;
}

/** The currently effective third-party implementation; null = no register, take the native path. */
let current: ChatMemoryProvider | null = null;

/**
 * Register a third-party memory implementation, overriding the one currently in effect.
 *
 * @param def - Implementation definition; at least one of `recall` and `capture` must be a function.
 * @returns logout function; it is only cleared when "this is still the current share". Late logout will not overthrow
 * latecomers.
 * When @throws { TypeError } is invalidly defined, id is empty, id occupies a native identifier, or both methods are
 * missing.
 */
export function registerChatMemoryProvider(def: ChatMemoryProvider): () => void {
  if (!def || typeof def !== 'object') throw new TypeError('Memory provider definition must be an object');
  if (typeof def.id !== 'string' || def.id.length === 0) throw new TypeError('id must be a nonempty string');
  if (def.id === NATIVE_MEMORY_ID) throw new TypeError('Cannot use the native implementation ID: ' + NATIVE_MEMORY_ID);
  if (typeof def.recall !== 'function' && typeof def.capture !== 'function') {
    throw new TypeError('At least one of recall or capture must be a function');
  }
  current = def;
  return () => {
    if (current === def) current = null;
  };
}

/** Which third-party implementation should be used currently? If there is no register, null will be returned, and the caller will take the native path accordingly. */
export function activeChatMemoryProvider(): ChatMemoryProvider | null {
  return current;
}

/**
 * List the available implementations for troubleshooting "Why didn't I register the one?"
 *
 * @returns `builtin` is always the native identifier; `external` is the currently effective third-party id (if not, it
 * is an empty array).
 */
export function listChatMemoryProviders(): { builtin: string[]; external: string[] } {
  return { builtin: [NATIVE_MEMORY_ID], external: current ? [current.id] : [] };
}

/**
 * clear register for testing isolation cases.
 * @internal
 */
export function resetChatMemoryProviders(): void {
  current = null;
}
