/**
 * Voice service: verify input, serial queue, check cache, call synthesis, and converge the results into "file path or
 * failure reason".
 *
 * The queue is placed here instead of in route: The concurrency upper limit is a resource constraint and has nothing
 * to do with HTTP. Serialization guarantees that there is only one upstream connection at a time, and also guarantees
 * first click, first ring - concurrency synthesis makes the order unpredictable. It is not responsible for delivering
 * mp3 to the client: that is a matter for route and bridge.
 * @module dsh-pet/src/host/voice/speak
 */
import { stat, writeFile } from 'node:fs/promises';
import { cacheKey, cachePath, ensureCacheDir, pruneCache } from './cache.ts';
import { VoiceSynthError, synthesize, type SynthInput } from './edge.ts';
import { BUILTIN_VOICE_ID, activeVoiceProvider, type VoiceProvider } from './registry.ts';
import { DEFAULT_VOICE, VOICES, isKnownVoice, type VoiceInfo } from './voices.ts';

/** The maximum text length allowed in a single request (character, in UTF-16). */
export const MAX_TEXT_CHARS = 500;
/** The upper limit of the synthesis queued at the same time (including the running one); if it is exceeded, it will be directly rejected and there will be no infinite accumulation. */
export const MAX_QUEUE = 3;

/** Speech rate expression: `+N%` or `-N%`. */
const RATE_PATTERN = /^[+-]\d{1,3}%$/;
/** Lower bound of speaking speed (percentage). */
const RATE_MIN_PERCENT = -50;
/** Upper limit of speaking speed (percentage). */
const RATE_MAX_PERCENT = 100;
/** The upper limit of a single synthesis implemented by a third party (ms): the same conventions as the built-in, to avoid getting stuck in the serial queue. */
const PROVIDER_TIMEOUT_MS = 15_000;
/** The total time limit of the built-in edge synthesis (ms): relies on the built-in 15 s which is just a "silent" timeout and is reset every time a frame comes. It cannot be used as the total time limit. */
const BUILTIN_TIMEOUT_MS = 28_000;
/** After queuing for this long, it is discarded before it is the turn (ms): The wait is longer than a synthesis, the client has already given up, and further synthesis is just a waste of time upstream. */
const STALE_WAIT_MS = BUILTIN_TIMEOUT_MS;

/** Input to a synthesis (verified). */
interface SpeakInput {
  readonly text: string;
  readonly voice: string;
  readonly rate: string;
}

/** Reason for failure; route layer is mapped to reason of `result.ts` as it is. */
export type SpeakFailure = 'bad-request' | 'voice-busy' | 'generate-error';

/** synthesis result: the absolute path of the final mp3 is given when successful. */
export type SpeakResult = { ok: true; file: string } | { ok: false; reason: SpeakFailure; message: string };

/** Voice service: The route layer only relies on these two methods. */
export interface VoiceService {
  /** synthesis of a piece of text; no longer connected to the network when the same input hits the cache. */
  speak(raw: unknown): Promise<SpeakResult>;
  /** Optional tone list (same origin as whitelist). */
  listVoices(): readonly VoiceInfo[];
}

/** Analysis conclusion: Verified input will be given if successful, and an explanation will be given directly back to the caller if failed. */
type ParseResult = { ok: true; value: SpeakInput } | { ok: false; message: string };

/** Verify the request body; only recognize the three fields `text` / `voice` / `rate`, and ignore the rest. */
function parseSpeakInput(raw: unknown): ParseResult {
  const body = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) return { ok: false, message: 'text is required' };
  if (text.length > MAX_TEXT_CHARS) return { ok: false, message: `text too long (max ${MAX_TEXT_CHARS} chars)` };
  const voice = body.voice === undefined ? DEFAULT_VOICE : body.voice;
  if (typeof voice !== 'string' || !isKnownVoice(voice)) {
    return { ok: false, message: `unknown voice; allowed: ${VOICES.map((item) => item.id).join(', ')}` };
  }
  const rate = body.rate === undefined ? '+0%' : body.rate;
  if (typeof rate !== 'string' || !RATE_PATTERN.test(rate)) {
    return { ok: false, message: 'rate must look like +0% or -10%' };
  }
  const percent = Number(rate.slice(1, -1));
  if (!Number.isFinite(percent) || percent < RATE_MIN_PERCENT || percent > RATE_MAX_PERCENT) {
    return { ok: false, message: `rate out of range (${RATE_MIN_PERCENT}%..+${RATE_MAX_PERCENT}%)` };
  }
  return { ok: true, value: { text, voice, rate } };
}

/** assertion uses: The construction points of `SpeakResult` all pass here to avoid handwriting the same sentence everywhere. */
function dropped(): SpeakResult {
  return { ok: false, reason: 'voice-busy', message: 'queued too long, dropped' };
}

/**
 * Have you waited too long in this queue?
 *
 * After waiting longer than the allowed time for a synthesis, the client has already timed out and given up: further
 * synthesis is just a waste of time upstream, and when the sound comes out, it is already talking about the previous
 * thing.
 *
 * @param queuedMs - Time to join the team.
 * @param nowMs - The moment when it's your turn.
 * @param waitMs - the maximum allowed queuing time; the default is {@link STALE_WAIT_MS} , test injecting shorter
 * values.
 * @returns should be discarded as true .
 * @internal
 */
export function isQueueStale(queuedMs: number, nowMs: number, waitMs: number = STALE_WAIT_MS): boolean {
  return nowMs - queuedMs > waitMs;
}

/** Create voice service. */
export function createVoiceService(options: {
  /** User data root; cache falls at `<userRoot>/voice-cache/`. */
  userRoot: string;
  /** Used to leave traces; if not passed, it will be silent. Only the character count and results are recorded, not the text (user content is not entered into the log). */
  log?: { info?(message: string): void; warn?(message: string): void };
  /** synthesis implementation; test injection avatar, default to the real implementation of edge. */
  synthesize?: (input: SynthInput) => Promise<void>;
  /** The maximum allowed queuing time (ms); the default is {@link STALE_WAIT_MS}, which is used for testing to force out the discard branch. */
  staleWaitMs?: number;
}): VoiceService {
  const { userRoot, log } = options;
  const synthesizeImpl = options.synthesize ?? synthesize;
  const staleWaitMs = options.staleWaitMs ?? STALE_WAIT_MS;
  /** The occupied queue quota (including the one currently running). */
  let queueUsed = 0;
  /** Serial chain: After the previous thing cleanup (success or failure), it is the turn of the next thing. */
  let chain: Promise<void> = Promise.resolve();

  /** Queue a synthesis into the serial chain; release the quota regardless of success or failure. */
  function enqueue(task: () => Promise<void>): Promise<void> {
    queueUsed += 1;
    const run = chain.then(task, task);
    // The chain itself cannot contain rejections, otherwise subsequent tasks will inherit the same failure; rejections are only given to this caller.
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run.finally(() => {
      queueUsed -= 1;
    });
  }

  /** Cache hit returns file path; non-existent or empty file returns undefined. */
  async function findCached(target: string): Promise<string | undefined> {
    try {
      const info = await stat(target);
      return info.isFile() && info.size > 0 ? target : undefined;
    } catch {
      return undefined;
    }
  }

  async function speak(raw: unknown): Promise<SpeakResult> {
    const parsed = parseSpeakInput(raw);
    if (!parsed.ok) return { ok: false, reason: 'bad-request', message: parsed.message };
    const { text, voice, rate } = parsed.value;
    // Check once for each request: the third party may register while it is running, or it may be unmounted. The startup snapshot will miss these two types.
    const provider = activeVoiceProvider();
    const source = provider ? provider.id : BUILTIN_VOICE_ID;
    // The third party does not have the concept of voice. voice is left blank in the cache key; the source key will not hit the old audio if it is changed.
    const target = cachePath(userRoot, cacheKey(source, provider ? '' : voice, rate, text));
    const startedMs = Date.now();
    const cached = await findCached(target);
    if (cached) {
      log?.info?.(`[dsh-pet] voice speak: cache=hit chars=${text.length} voice=${source}`);
      return { ok: true, file: cached };
    }
    if (queueUsed >= MAX_QUEUE) {
      log?.warn?.(`[dsh-pet] voice speak: queue full (max ${MAX_QUEUE}) chars=${text.length} voice=${source}`);
      return { ok: false, reason: 'voice-busy', message: 'voice queue is full, retry later' };
    }
    const queue = { dropped: false };
    const queuedMs = Date.now();
    try {
      await enqueue(async () => {
        if (isQueueStale(queuedMs, Date.now(), staleWaitMs)) {
          queue.dropped = true;
          return;
        }
        const dir = await ensureCacheDir(userRoot);
        if (provider) await synthesizeWithProvider(provider, { text, voice, rate, target });
        else await synthesizeImpl({ signal: AbortSignal.timeout(BUILTIN_TIMEOUT_MS), target, text, voice, rate });
        // Elimination is placed after success: on failure, you should not delete the still usable cache to make room.
        await pruneCache(dir);
      });
    } catch (error) {
      // Upstream details (including URL and status code) are not leaked and are only kept in the log.
      log?.warn?.(
        `[dsh-pet] voice speak: failed chars=${text.length} voice=${source} ` +
          `ms=${Date.now() - startedMs} reason=${error instanceof VoiceSynthError ? error.message : String(error)}`,
      );
      return { ok: false, reason: 'generate-error', message: 'voice synthesis failed' };
    }
    if (queue.dropped) {
      log?.warn?.(
        `[dsh-pet] voice speak: dropped chars=${text.length} voice=${source} queued=${Date.now() - queuedMs}ms`,
      );
      return dropped();
    }
    log?.info?.(`[dsh-pet] voice speak: cache=miss chars=${text.length} voice=${source} ms=${Date.now() - startedMs}`);
    return { ok: true, file: target };
  }

  return { listVoices: () => VOICES, speak };
}

/** Give a Promise set a timeout; when the timeout is reject, the original Promise will not be canceled (provider should process and give up by itself). */
function withTimeout<T>(task: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('voice provider timed out')), timeoutMs);
    timer.unref?.();
    task.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Use a third party to implement synthesis and persist to disk.
 *
 * Empty bytes are treated as failures: files with 0 bytes will be skipped by `size > 0` of {@link findCached} , so
 * each request will be synthesized again, and an empty file will be obtained each time, which is a waste of time
 * upstream.
 */
async function synthesizeWithProvider(provider: VoiceProvider, input: SynthInput): Promise<void> {
  let bytes: Uint8Array;
  try {
    bytes = await withTimeout(provider.synthesize({ text: input.text, rate: input.rate }), PROVIDER_TIMEOUT_MS);
  } catch (error) {
    throw new VoiceSynthError(error instanceof Error ? error.message : String(error));
  }
  if (bytes.length === 0) throw new VoiceSynthError('voice provider returned empty audio');
  await writeFile(input.target, bytes);
}
