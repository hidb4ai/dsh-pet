/**
 * End-side voice input: record a paragraph and spell it into WAV recognized by the host. `POST /voice/hear` is
 * replaced with text.
 *
 * The verification of the format conventions (16 kHz / mono / PCM16) and the host provider is the same fact - here we
 * only output according to it, and no longer verify them separately; if they are really inconsistent, the host will
 * return a readable failure explanation. It is only responsible for "Microphone → WAV → Text" and does not touch the
 * interface: the button status and text placement point belong to the caller (chat/dom).
 * @module dsh-pet/src/shared/hear
 */

/** Sampling rate: host provider only accepts 16 kHz. */
export const HEAR_SAMPLE_RATE = 16000;
/**
 * The upper limit of single recording (ms).
 *
 * 24 seconds × 32000 B/s ≈ 750 KB, base64 still falls in the request body of host 1 MiB (the upper limit is 768 KiB
 * audio); if it is longer, you must first find a way to fragment it, that is another thing.
 */
export const MAX_RECORD_MS = 24_000;
/** The peak threshold for judging silence (0..1): below it, it is considered that no sound is heard, and the recognition is not wasted. */
export const SILENCE_PEAK = 0.002;
/**
 * Recordings shorter than this are treated as false triggers.
 *
 * When you hold down the shortcut key and speak, an accidental touch will only record a few tens of milliseconds; this
 * kind of clip is neither worth sending for identification nor should it report "no sound" - it has nothing to do with
 * whether there is sound from the microphone.
 */
export const MIN_RECORD_MS = 300;
/** The upper limit of waiting for recognition results (ms): The host itself 30 s times out, leave some margin here and wait for it to respond to structured failure. */
const HEAR_TIMEOUT_MS = 40_000;
/** The number of samples collected in each block: 1024 samples @16 kHz = 64 ms. The waiting time to complete the tail sound after letting go is also calculated according to this. */
const BLOCK_SAMPLES = 1024;
/** After letting go, wait for the last piece of audio to fall into the bag (ms): slightly longer than one piece to avoid cutting off the last half of the sentence. */
const TAIL_SETTLE_MS = 80;

/** Recognition results: success will be given to text (empty string = no one speaks in this paragraph), failure will be given to classification and instructions that can be directly displayed. */
export type HearOutcome =
  | { readonly ok: true; readonly text: string }
  | {
      readonly ok: false;
      readonly reason: 'silent' | 'unsupported' | 'bad-request' | 'generate-error' | 'network';
      readonly message: string;
    };

/** A piece of recorded audio: WAV bytes are handed over together with the peak value. There is no need to decode the bytes again for silence determination. */
export interface RecordedClip {
  /** Complete WAV bytes (16 kHz / mono / PCM16). */
  readonly wave: Uint8Array;
  /** Peak value (0..1); lower than {@link SILENCE_PEAK} means no sound is heard. */
  readonly peak: number;
}

/** The handle for one recording; it must be `stop` or `cancel` when used up, otherwise the microphone will always be occupied. */
export interface HearRecorder {
  /** Recorded duration (ms): It will no longer increase after {@link MAX_RECORD_MS}. */
  elapsedMs(): number;
  /** Stop and hand over audio; gives null when not a single sample is available. */
  stop(): Promise<RecordedClip | null>;
  /** Discard recording and release microphone; can be called repeatedly. */
  cancel(): void;
}

/** Whether the browser can record; `mediaDevices` does not exist at all in non-security context (http and not localhost). */
export function canRecord(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function';
}

/**
 * Convert floating-point sampling to 16-bit integer type: clamp when out of range, and scale the negative half-axis
 * according to 32768 to prevent -1 from overflowing into a positive number.
 *
 * @param samples - Web Audio gives [-1,1] floating point samples.
 * @returns can write directly into the 16-bit samples of WAV.
 */
export function floatToPcm16(samples: Float32Array): Int16Array {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i] < -1 ? -1 : samples[i] > 1 ? 1 : samples[i];
    out[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
  }
  return out;
}

/**
 * Volume peak: Silence judgment only cares about "whether there is sound coming in", not how loud it is.
 *
 * @param pcm - 16-bit samples.
 * @returns peaks are normalized to 0..1; empty arrays give 0.
 */
export function peakOf(pcm: Int16Array): number {
  let peak = 0;
  for (let i = 0; i < pcm.length; i++) {
    const v = pcm[i] < 0 ? -pcm[i] : pcm[i];
    if (v > peak) peak = v;
  }
  return peak / 0x8000;
}

/**
 * Concatenate a bare PCM to WAV: 44 bytes header + sampling data.
 *
 * Each field host in the header will be checked (`fmt ` length 16, PCM =1, mono, 16 bit, byteRate self-consistent), so
 * here we write it byte by byte at a fixed offset, and there is no trick like "picking a usable template".
 *
 * @param pcm - 16-bit samples.
 * @param sampleRate - sampling rate; default 16 kHz.
 * @returns complete WAV bytes.
 */
export function encodeWave(pcm: Int16Array, sampleRate = HEAR_SAMPLE_RATE): Uint8Array {
  const dataBytes = pcm.length * 2;
  const bytes = new Uint8Array(44 + dataBytes);
  const view = new DataView(bytes.buffer);
  /** Write 4 bytes ASCII mark (RIFF/WAVE/fmt / data), all uppercase or lowercase letters, regardless of encoding. */
  const ascii = (offset: number, text: string): void => {
    for (let i = 0; i < text.length; i++) bytes[offset + i] = text.charCodeAt(i);
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // 1 = PCM
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byteRate = sampling rate × channel × bit depth/8
  view.setUint16(32, 2, true); // blockAlign = channel × bit depth/8
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, dataBytes, true);
  for (let i = 0; i < pcm.length; i++) view.setInt16(44 + i * 2, pcm[i], true);
  return bytes;
}

/**
 * bytes to base64 (without data: prefix).
 *
 * Segmented conversion: Expanding hundreds of thousands of bytes at one time will burst the parameter stack, and here
 * is the allowed magnitude of 750 KB.
 *
 * @param bytes - raw bytes.
 * @returns specification base64.
 */
export function toBase64(bytes: Uint8Array): string {
  const BASE64_CHUNK_BYTES = 8192;
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK_BYTES) {
    const end = Math.min(offset + BASE64_CHUNK_BYTES, bytes.length);
    for (let i = offset; i < end; i++) binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/** Converg the host failure reasons to the ones you know; the rest will be treated as generation failures. */
function reasonOf(raw: unknown): 'unsupported' | 'bad-request' | 'generate-error' {
  return raw === 'unsupported' || raw === 'bad-request' ? raw : 'generate-error';
}

/**
 * Give a section of WAV (base64) to the host for recognition.
 *
 * @param url - Identification address that includes the mount prefix.
 * @param audio - specification base64 (without data : prefix).
 * @returns text or failure classification; network exceptions also converge to outcome and are not thrown upward.
 */
export async function hearAudio(url: string, audio: string, signal?: AbortSignal): Promise<HearOutcome> {
  const timeout = AbortSignal.timeout(HEAR_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ audio }),
      signal: signal === undefined ? timeout : AbortSignal.any([signal, timeout]),
    });
    const raw: unknown = await res.json().catch(() => null);
    if (!raw || typeof raw !== 'object') {
      return { ok: false, reason: 'network', message: '识别响应不是 JSON' };
    }
    const body = raw as Record<string, unknown>;
    if (body.ok === true && typeof body.text === 'string') return { ok: true, text: body.text };
    return {
      ok: false,
      reason: reasonOf(body.reason),
      message: typeof body.message === 'string' ? body.message : '',
    };
  } catch (e) {
    return { ok: false, reason: 'network', message: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Start recording once.
 *
 * Use `AudioContext({ sampleRate: 16000 })` to let the browser do the resampling by itself (the hardware is usually 48
 * k), and what you get is the mono floating point of the target sampling rate; although `ScriptProcessor` has been
 * marked as obsolete, it does not require additional worklet module files - `file://` page loading worklet will be
 * stuck by source restrictions.
 *
 * @returns recording handle.
 * @throws { Error } When the microphone cannot be obtained (no permission, device occupied, non-security context) -
 * the original text is given to the caller for display.
 */
export async function startRecording(): Promise<HearRecorder> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } });
  const ctx = new AudioContext({ sampleRate: HEAR_SAMPLE_RATE });
  const source = ctx.createMediaStreamSource(stream);
  const processor = ctx.createScriptProcessor(BLOCK_SAMPLES, 1, 1);
  const chunks: Float32Array[] = [];
  const maxSamples = Math.floor((MAX_RECORD_MS / 1000) * HEAR_SAMPLE_RATE);
  let frames = 0;
  let closed = false;

  processor.onaudioprocess = (event) => {
    if (frames >= maxSamples) return;
    const samples = event.inputBuffer.getChannelData(0);
    const room = maxSamples - frames;
    const take = samples.length > room ? samples.subarray(0, room) : samples;
    // Must copy: The underlying array of inputBuffer is reused every frame. Directly storing the reference will result in a bunch of the same data.
    chunks.push(new Float32Array(take));
    frames += take.length;
  };
  source.connect(processor);
  processor.connect(ctx.destination);
  // The default context may be suspended (when there is no user gesture); the caller is in pointerdown and is eligible for recovery.
  await ctx.resume();

  const teardown = (): void => {
    if (closed) return;
    closed = true;
    processor.onaudioprocess = null;
    try {
      source.disconnect();
      processor.disconnect();
    } catch {
      /* Disconnected: Doesn’t matter */
    }
    for (const track of stream.getTracks()) track.stop();
    void ctx.close();
  };

  return {
    elapsedMs: () => (frames / HEAR_SAMPLE_RATE) * 1000,
    async stop() {
      // The acquisition is one block later than the release: let the last block fall into the bag first, otherwise tens of milliseconds of tail sound will be cut off every time
      await new Promise((resolve) => setTimeout(resolve, TAIL_SETTLE_MS));
      teardown();
      if (frames === 0) return null;
      const all = new Float32Array(frames);
      let offset = 0;
      for (const chunk of chunks) {
        all.set(chunk, offset);
        offset += chunk.length;
      }
      const pcm = floatToPcm16(all);
      return { wave: encodeWave(pcm), peak: peakOf(pcm) };
    },
    cancel: teardown,
  };
}
