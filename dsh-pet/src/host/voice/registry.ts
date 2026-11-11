/**
 * The register table of third-party voice implementation: single slot, the one registered later overwrites the one
 * registered first.
 *
 * Different from the balance register table, voice does not have a "match by service provider name" key - just say one
 * sentence and it is done. There is no semantics for multiple implementations to coexist, so here is a slot instead of
 * Map. Module singleton: register returns disposer; test with {@link resetVoiceProviders} to reset. Only registration
 * and search, no synthesis, no caching, no configuration reading.
 * @module dsh-pet/src/host/voice/registry
 */

/** The name of the built-in implementation; it is used for caching keys and troubleshooting, and cannot be used by third parties. */
export const BUILTIN_VOICE_ID = 'edge';

/** Third-party voice implementation: given a text, mp3 bytes are returned. */
export interface VoiceProvider {
  /** Unique identifier; participates in the cache key, and the implementation will not hit the old audio. */
  readonly id: string;
  /** Display name, only used for troubleshooting. */
  readonly name: string;
  /**
   * Synthesize a piece of text into mp3.
   *
   * Failure must throw an error - the host will be normalized to `generate-error` and recorded in the log; swallowing
   * it yourself will make the upper layer think it is successful. Do not accept voices: `voiceName` is a whitelist
   * implemented by the built-in, and third-party voices are determined by itself.
   */
  synthesize(input: { readonly text: string; readonly rate: string }): Promise<Uint8Array>;
}

/** Currently effective third-party implementation; `null` = no register, synthesis uses built-in implementation. */
let current: VoiceProvider | null = null;

/**
 * Register a third-party speech implementation, overriding the one currently in effect.
 *
 * @param def - implementation defined; `id` cannot have the same name as a built-in implementation (that would bump
 * cache keys together).
 * @returns logout function; it is only cleared when "this is still the current share". Late logout will not overthrow
 * latecomers.
 * When @throws { TypeError } is invalidly defined, `synthesize` is not a function or id has the same name as a
 * built-in.
 */
export function registerVoiceProvider(def: VoiceProvider): () => void {
  if (!def || typeof def !== 'object') throw new TypeError('Voice provider definition must be an object');
  if (typeof def.id !== 'string' || def.id.length === 0) throw new TypeError('id must be a nonempty string');
  if (def.id === BUILTIN_VOICE_ID)
    throw new TypeError('Cannot reuse a built-in implementation name: ' + BUILTIN_VOICE_ID);
  if (typeof def.synthesize !== 'function') throw new TypeError('synthesize must be a function');

  current = def;
  return () => {
    if (current === def) current = null;
  };
}

/**
 * Which third-party implementation should be used currently.
 * The implementation of @returns has been registered; when it is not registered, it returns `null` , and the caller
 * falls back to the built-in implementation accordingly.
 */
export function activeVoiceProvider(): VoiceProvider | null {
  return current;
}

/**
 * List the available implementations for troubleshooting "Why didn't I register the one?"
 * @returns `builtin` is always a built-in implementation; `external` is the currently effective third-party id (if
 * not, it is an empty array).
 */
export function listVoiceProviders(): { builtin: string[]; external: string[] } {
  return { builtin: [BUILTIN_VOICE_ID], external: current ? [current.id] : [] };
}

/**
 * clear register for testing isolation cases.
 * @internal
 */
export function resetVoiceProviders(): void {
  current = null;
}
