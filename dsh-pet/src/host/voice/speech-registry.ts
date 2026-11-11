/**
 * Register table for third-party speech recognition: single slot, the one registered later overwrites the one
 * registered first.
 *
 * There is only one difference from the synthesis register table: the built-in source is `speechToText` of the host
 * (which may not exist at all), and is not an implementation built into the package, so the reserved name is `dsh`
 * instead of `edge` . Module singleton: register returns disposer; test with {@link resetSpeechProviders} to reset.
 * Only registration and search: no recognition, no queuing, no timeout (those belong to hear.ts).
 * @module dsh-pet/src/host/voice/speech-registry
 */

/** The name of the built-in source: The host’s own identification capability cannot be used by third parties. */
export const BUILTIN_SPEECH_ID = 'dsh';

/** Third-party recognition implementation: given a segment of WAV, text is returned. */
export interface SpeechProvider {
  /** Unique identifier; involved in troubleshooting output, cannot have the same name as the built-in source. */
  readonly id: string;
  /** Display name, only used for troubleshooting. */
  readonly name: string;
  /**
   * Recognize a paragraph WAV as text.
   *
   * Failure must throw an error - the host will be normalized to `generate-error` and recorded in the log; swallowing
   * it yourself will make the upper layer think that the recognition is successful. Returning an empty string means
   * "no one is talking in this paragraph", which is a valid result and does not constitute a failure. `signal` is the
   * caller's abort signal: it can be ignored, but the host will stop waiting immediately.
   */
  transcribe(input: { readonly audio: Uint8Array; readonly language?: string }, signal?: AbortSignal): Promise<string>;
}

/** The currently effective third-party implementation; `null` = no register, and the host’s own capabilities are used for identification. */
let current: SpeechProvider | null = null;

/**
 * Register a third-party identification implementation, overriding the one currently in effect.
 *
 * @param def - Implementation defined; `id` cannot have the same name as a built-in source (it will be difficult to
 * tell who is running when troubleshooting).
 * @returns logout function; it is only cleared when "this is still the current share". Late logout will not overthrow
 * latecomers.
 * When @throws { TypeError } is invalidly defined, `transcribe` is not a function, or id has the same name as a
 * built-in source.
 */
export function registerSpeechProvider(def: SpeechProvider): () => void {
  if (!def || typeof def !== 'object') throw new TypeError('Speech provider definition must be an object');
  if (typeof def.id !== 'string' || def.id.length === 0) throw new TypeError('id must be a nonempty string');
  if (def.id === BUILTIN_SPEECH_ID) throw new TypeError('Cannot reuse a built-in source name: ' + BUILTIN_SPEECH_ID);
  if (typeof def.transcribe !== 'function') throw new TypeError('transcribe must be a function');

  current = def;
  return () => {
    if (current === def) current = null;
  };
}

/**
 * Which third-party implementation should be used currently.
 * The implementation of @returns has been registered; when it is not registered, `null` is returned, and the caller
 * falls back to the host with its own capabilities.
 */
export function activeSpeechProvider(): SpeechProvider | null {
  return current;
}

/**
 * List the available implementations for troubleshooting "Why didn't I register the one?"
 * @returns `builtin` is always the host's own source; `external` is the currently effective third-party id (if not, it
 * is an empty array).
 */
export function listSpeechProviders(): { builtin: string[]; external: string[] } {
  return { builtin: [BUILTIN_SPEECH_ID], external: current ? [current.id] : [] };
}

/**
 * clear register for testing isolation cases.
 * @internal
 */
export function resetSpeechProviders(): void {
  current = null;
}
