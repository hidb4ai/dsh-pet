/**
 * Speech recognition service: Give a piece of WAV to the host's `speechToText` , and converge the conclusion into
 * "text or failure reason".
 *
 * The audio format (16 kHz/mono/PCM16 WAV) is verified by host provider: Do not write a copy of the same rule in two
 * places, otherwise if you change one side, it will not match the other side. Only obviously invalid input is blocked
 * here to avoid wasted reasoning. Not responsible for recording and transmission - what comes in is the entire decoded
 * audio bytes.
 * @module dsh-pet/src/host/voice/hear
 */
import { activeSpeechProvider } from './speech-registry.ts';

/** The upper limit of audio for single recognition (bytes): The audio is stuffed into 1 MiB request body via base64, which is about 786 KiB after decoding. */
export const MAX_AUDIO_BYTES = 768 * 1024;
/** Recognition timeout (milliseconds): Local CPU reasoning, one sentence is much lower than this; if it exceeds, give up, not infinite. */
export const TRANSCRIBE_TIMEOUT_MS = 30_000;

/** Reason for failure; route layer is mapped to reason of result.ts as it is. */
export type HearFailure = 'bad-request' | 'unsupported' | 'generate-error';

/** Recognition results: text if successful, classification if failed, and instructions that can be directly returned to the caller. */
export type HearResult = { ok: true; text: string } | { ok: false; reason: HearFailure; message: string };

/** Speech recognition service: The route layer only relies on this method. */
export interface HearService {
  /** Recognize a piece of audio; stop waiting when `signal` aborts (caller has been disconnected). */
  hear(raw: unknown, signal?: AbortSignal): Promise<HearResult>;
}

/** Verified identification input. */
interface HearInput {
  readonly audio: Uint8Array;
  readonly language?: string;
}

/** The resolved value of one-time recognition: the text is an empty string, which means there is no voice in this paragraph. */
interface Transcript {
  readonly text: string;
}

/** The minimum shape of host `ctx.speechToText`: only three things are used: registration table, sequencing and transcoding. */
interface SpeechToTextLike {
  /** Registered recognizers; an empty array indicates that the host does not enable the voice input plugin. */
  listProviders(): readonly unknown[];
  /** Pin a recording to a certain recognizer. */
  resolve(request: { audio: Uint8Array; language?: string }): unknown;
  /** Perform identification. */
  transcribe(spec: unknown, signal: AbortSignal): Promise<Transcript>;
}

/** base64 Literal value: `Buffer.from` The decoding is very loose. First, the dirty data is blocked according to the alphabet and completion rules. */
const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;

/** Analysis conclusion: Verified input will be given if successful, and an explanation will be given if failed. */
type ParseResult = { ok: true; value: HearInput } | { ok: false; message: string };

/**
 * Verify the request body; only recognize the two fields `audio` and `language` , and ignore the rest.
 *
 * @param raw - The parsed request body.
 * @returns decoded audio bytes; if any field is invalid, a description will be given that can be directly returned to
 * the caller.
 */
function parseHearInput(raw: unknown): ParseResult {
  const body = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const encoded = typeof body.audio === 'string' ? body.audio.trim() : '';
  if (encoded === '') return { ok: false, message: 'audio is required' };
  if (!BASE64_PATTERN.test(encoded) || encoded.replace(/=+$/, '').length % 4 === 1) {
    return { ok: false, message: 'audio must be base64' };
  }
  const audio = new Uint8Array(Buffer.from(encoded, 'base64'));
  if (audio.byteLength === 0) return { ok: false, message: 'audio is empty' };
  if (audio.byteLength > MAX_AUDIO_BYTES) {
    return { ok: false, message: `audio too large (max ${MAX_AUDIO_BYTES} bytes)` };
  }
  const language = body.language;
  if (language !== undefined && (typeof language !== 'string' || language.trim() === '')) {
    return { ok: false, message: 'language must be a non-empty string' };
  }
  return {
    ok: true,
    value: { audio, ...(language === undefined ? {} : { language: (language as string).trim() }) },
  };
}

/**
 * Add a timeout and caller termination to a recognition, and converge the conclusion into "a value or a description".
 *
 * Both sources (third party, host) only recognize one signal, so they are merged here and there is no need to write
 * caller again.
 *
 * @param signal - caller abort signal (connection disconnected).
 * @param timeoutMs - Timeout limit.
 * @param task - the function that actually performs the recognition.
 * @returns The value given to the task if it succeeds; if it times out or throws an error, the original error
 * description will be given.
 */
async function withDeadline<T>(
  signal: AbortSignal | undefined,
  timeoutMs: number,
  task: (signal: AbortSignal) => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; message: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref();
  const onAbort = (): void => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    return { ok: true, value: await task(controller.signal) };
  } catch (error) {
    // Most of the errors thrown by the implementation are that the audio is not what it wants (format/duration): normalized to generate-error, the original text is given to the caller.
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * Manufacturing identification service.
 *
 * @param options.speechToText - Lazy access to the host service; it returns undefined when the voice input plugin is
 * not enabled.
 * @param options.timeoutMs - Single recognition timeout; default {@link TRANSCRIBE_TIMEOUT_MS} , use a small value for
 * testing.
 * @returns only exposes the services of `hear` .
 */
export function createHearService(options: { speechToText: () => unknown; timeoutMs?: number }): HearService {
  const timeoutMs = options.timeoutMs ?? TRANSCRIBE_TIMEOUT_MS;
  return {
    async hear(raw, signal) {
      const parsed = parseHearInput(raw);
      if (!parsed.ok) return { ok: false, reason: 'bad-request', message: parsed.message };

      // Third-party priority: If it is registered, just use it, no longer look at the host (the same semantics as "no fallback" of synthesis).
      const provider = activeSpeechProvider();
      if (provider !== null) {
        const run = await withDeadline(signal, timeoutMs, (inner) => provider.transcribe(parsed.value, inner));
        if (!run.ok) return { ok: false, reason: 'generate-error', message: run.message };
        // The third-party return value is not trustworthy: if it is not a character string, it will be treated as a failure. Avoid stuffing the object into the text field and sending it out.
        if (typeof run.value !== 'string') {
          return { ok: false, reason: 'generate-error', message: 'invalid transcript from provider' };
        }
        return { ok: true, text: run.value };
      }

      const speech = options.speechToText() as SpeechToTextLike | undefined;
      if (speech === undefined || typeof speech.transcribe !== 'function') {
        return { ok: false, reason: 'unsupported', message: 'host has no speech-to-text service' };
      }
      // Empty registration table = The plugin is not enabled or provider is not started: the transcoding must fail, give a clear reason in advance instead of waiting for it to throw an error.
      if (speech.listProviders().length === 0) {
        return { ok: false, reason: 'unsupported', message: 'host has no speech provider enabled' };
      }

      // The host returns the finished object (text + duration). Only the text is taken here, and the duration is left to the person who needs it to adjust it again.
      const run = await withDeadline(
        signal,
        timeoutMs,
        async (inner) => (await speech.transcribe(speech.resolve(parsed.value), inner)).text,
      );
      if (!run.ok) return { ok: false, reason: 'generate-error', message: run.message };
      return { ok: true, text: run.value };
    },
  };
}
