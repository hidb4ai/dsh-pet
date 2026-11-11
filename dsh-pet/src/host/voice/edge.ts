/**
 * Wrap Edge online speech: lazily load @andresaya/edge-tts, produce MP3 and normalize failures to one error type.
 *
 * Load the optional dependency only during synthesis so a missing package fails that request rather than DSH startup.
 * Use dynamic import inside try, not createRequire: tsdown noExternal must see the import to bundle it into the app.
 * The dependency handles SSML, XML escaping, WebSocket and DRM tokens. Pass raw text; escaping twice would read `&` as
 * "amp".
 * Protocol changes are handled by upgrading the dependency. Caching and queuing belong to the service layer.
 * @module dsh-pet/src/host/voice/edge
 */
import { rename, rm, writeFile } from 'node:fs/promises';

/** Dependent module shape: Runtime code only appears at import on demand. */
type EdgeTtsModule = typeof import('@andresaya/edge-tts');

/** Single synthesis timeout (ms): If the upstream does not respond for a long time, it will be deemed a failure and the serial queue will not be held up. */
const SYNTHESIS_TIMEOUT_MS = 15_000;

/** Synthesis failed: The upper layer returns `generate-error` accordingly, without distinguishing the upstream details. */
export class VoiceSynthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VoiceSynthError';
  }
}

/** Parameters required for synthesis once. */
export interface SynthInput {
  /** Text that has passed length and whitespace verification is handed over to the dependency as is (it is responsible for escaping). */
  readonly text: string;
  /** The tone id in the whitelist. */
  readonly voice: string;
  /** prosody rate expression, such as `+0%`. */
  readonly rate: string;
  /** Final path to destination mp3; parent directory must already exist. */
  readonly target: string;
  /** Total time limit: Relying on the built-in timeout is just a "silent" timeout (reset every frame). The real total upper limit depends on this signal. */
  readonly signal?: AbortSignal;
}

/**
 * Synthesize a piece of text to the target mp3.
 *
 * First write `<target>.part` and then change the name: Once `target` appears, it is a complete file. Failure in the
 * middle will not leave half mp3 as valid audio by cache hit logic.
 *
 * @param input - text, voice, speech rate and target path.
 * @throws { VoiceSynthError } When the upstream fails, times out, or fails to write to disk.
 */
export async function synthesize({ signal, text, voice, rate, target }: SynthInput): Promise<void> {
  const staging = `${target}.part`;
  try {
    // Loading on demand: MODULE_NOT_FOUND is thrown here when the package is missing, and is unified into
    // VoiceSynthError from below. CJS may only reveal default after dynamic import. Both shapes are recognized.
    const mod = (await import('@andresaya/edge-tts')) as EdgeTtsModule & { default?: EdgeTtsModule };
    const EdgeTTS = mod.EdgeTTS ?? mod.default?.EdgeTTS;
    if (!EdgeTTS) throw new VoiceSynthError('The dependency does not export EdgeTTS');
    const tts = new EdgeTTS();
    const result = await tts.generate(text, voice, { rate, signal, timeout: SYNTHESIS_TIMEOUT_MS });
    await writeFile(staging, result.audio);
    await rename(staging, target);
  } catch (error) {
    await rm(staging, { force: true }).catch(() => undefined);
    throw new VoiceSynthError(error instanceof Error ? error.message : String(error));
  }
}
