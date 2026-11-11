/**
 * Test of speech recognition service (src/host/voice/hear.ts). Only assertion serves its own rules: input
 * verification, downgrade due to lack of host capabilities, conclusion mapping; no real requests are sent, and no
 * audio format is touched.
 */
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { createHearService, MAX_AUDIO_BYTES, type HearResult } from './hear.ts';
import { registerSpeechProvider, resetSpeechProviders } from './speech-registry.ts';

// The register table is a module singleton: clear at the end of each use case to prevent third-party implementation from being passed to the next use case.
afterEach(() => {
  resetSpeechProviders();
});

/** A piece of fake audio: the service does not perform format verification and the content is arbitrary. */
const AUDIO = new Uint8Array([1, 2, 3, 4]);

/** Compile bytes into base64 according to the form of renderer. */
const encode = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64');

/** An actual parameter record of resolve. */
interface ResolveCall {
  readonly audio: Uint8Array;
  readonly language?: string;
}

/** Fake host service: Both the registration form and transliteration can be substituted, and the actual parameters of resolve should be recorded. */
function makeSpeech(
  overrides: {
    providers?: readonly unknown[];
    transcribe?: (spec: unknown, signal: AbortSignal) => Promise<{ text: string }>;
  } = {},
): { service: unknown; calls: ResolveCall[] } {
  const calls: ResolveCall[] = [];
  const service = {
    listProviders: () => overrides.providers ?? [{ id: 'sensevoice' }],
    resolve: (request: ResolveCall) => {
      calls.push(request);
      return { pinned: request };
    },
    // The host returns a finished object instead of a bare character string: the real shape is used here to fake it, otherwise the wrong field cannot be detected.
    transcribe: overrides.transcribe ?? (async () => ({ text: '你好' })),
  };
  return { service, calls };
}

/** Run identification once with the given host service; `timeoutMs` is only given in the timeout use case. */
async function hearWith(speech: unknown, raw: unknown, timeoutMs?: number): Promise<HearResult> {
  return createHearService({ speechToText: () => speech, timeoutMs }).hear(raw);
}

test('Missing audio: bad-request, and the host service is not called', async () => {
  const speech = makeSpeech();
  const result = await hearWith(speech.service, {});
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, 'bad-request');
  assert.equal(speech.calls.length, 0, 'The host should not be alarmed when the input is illegal.');
});

test('audio is not base64: bad-request', async () => {
  const result = await hearWith(makeSpeech().service, { audio: '这不是 base64' });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, 'bad-request');
});

test('audio is an empty string: bad-request', async () => {
  const result = await hearWith(makeSpeech().service, { audio: '   ' });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, 'bad-request');
});

test('audio exceeds the upper limit: bad-request, and the host service is not called', async () => {
  const speech = makeSpeech();
  const result = await hearWith(speech.service, { audio: encode(new Uint8Array(MAX_AUDIO_BYTES + 1)) });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, 'bad-request');
  assert.equal(speech.calls.length, 0);
});

test('Host does not have speechToText service: unsupported instead of treating it as a failure', async () => {
  const result = await hearWith(undefined, { audio: encode(AUDIO) });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, 'unsupported');
});

test('host has service but no recognizer: unsupported, and no transcoding is called', async () => {
  let transcribed = 0;
  const speech = makeSpeech({
    providers: [],
    transcribe: async () => {
      transcribed++;
      return { text: '不该出现' };
    },
  });
  const result = await hearWith(speech.service, { audio: encode(AUDIO) });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, 'unsupported');
  assert.equal(transcribed, 0);
});

test('Normal recognition: return the text and give the original bytes to the host', async () => {
  const speech = makeSpeech();
  const result = await hearWith(speech.service, { audio: encode(AUDIO) });
  assert.deepEqual(result, { ok: true, text: '你好' });
  assert.equal(speech.calls.length, 1);
  assert.deepEqual(new Uint8Array(speech.calls[0]?.audio ?? new Uint8Array()), AUDIO);
});

test('The recognition result is an empty string: it is still considered successful. Whether to prompt or not is determined by the caller.', async () => {
  const result = await hearWith(makeSpeech({ transcribe: async () => ({ text: '' }) }).service, {
    audio: encode(AUDIO),
  });
  assert.deepEqual(result, { ok: true, text: '' });
});

test('language is transparently transmitted to the host as it is', async () => {
  const speech = makeSpeech();
  await hearWith(speech.service, { audio: encode(AUDIO), language: ' zh ' });
  assert.equal(speech.calls[0]?.language, 'zh');
});

test('language is not a non-empty character string: bad-request', async () => {
  for (const language of ['', '   ', 42]) {
    const result = await hearWith(makeSpeech().service, { audio: encode(AUDIO), language });
    assert.equal(result.ok, false, `language = ${JSON.stringify(language)} should be rejected`);
    if (result.ok) continue;
    assert.equal(result.reason, 'bad-request');
  }
});

test('Transcription error: normalize to generate-error and retain the original description', async () => {
  const speech = makeSpeech({
    transcribe: async () => {
      throw new Error('Audio must be a canonical 16 kHz mono PCM16 WAV recording');
    },
  });
  const result = await hearWith(speech.service, { audio: encode(AUDIO) });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, 'generate-error');
  assert.match(result.message, /canonical 16 kHz/);
});

test('Transcription timeout: return generate-error after interruption, will not hang forever', async () => {
  const speech = makeSpeech({
    // Never honored, only signal can unlock it - the verification timeout really connected to provider.
    transcribe: (_spec, signal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      }),
  });
  const result = await hearWith(speech.service, { audio: encode(AUDIO) }, 10);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, 'generate-error');
});

test('Register a third party: just use it, the host will not participate at all', async () => {
  let hostCalls = 0;
  const speech = makeSpeech({
    transcribe: async () => {
      hostCalls++;
      return { text: '宿主的答案' };
    },
  });
  registerSpeechProvider({ id: 'my-asr', name: '我的识别', transcribe: async () => '第三方答案' });
  const result = await hearWith(speech.service, { audio: encode(AUDIO) });
  assert.deepEqual(result, { ok: true, text: '第三方答案' });
  assert.equal(hostCalls, 0, 'Host should not be called again after registering');
});

test('Third-party error: return generate-error, and do not fallback host', async () => {
  let hostCalls = 0;
  const speech = makeSpeech({
    transcribe: async () => {
      hostCalls++;
      return { text: '不该出现' };
    },
  });
  registerSpeechProvider({
    id: 'my-asr',
    name: '坏实现',
    transcribe: async () => {
      throw new Error('upstream 500');
    },
  });
  const result = await hearWith(speech.service, { audio: encode(AUDIO) });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, 'generate-error');
  assert.match(result.message, /upstream 500/);
  assert.equal(hostCalls, 0, 'No fallback: host should not be called silently');
});

test('The third party returns an empty string: it is considered successful (no one speaks in this paragraph)', async () => {
  registerSpeechProvider({ id: 'my-asr', name: '安静', transcribe: async () => '' });
  const result = await hearWith(makeSpeech().service, { audio: encode(AUDIO) });
  assert.deepEqual(result, { ok: true, text: '' });
});

test('The third party returns a non-character string: handle it as a failure and do not stuff the object into text', async () => {
  registerSpeechProvider({ id: 'my-asr', name: '乱回', transcribe: async () => ({ text: '坏' }) as never });
  const result = await hearWith(makeSpeech().service, { audio: encode(AUDIO) });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, 'generate-error');
  assert.match(result.message, /invalid transcript/);
});

test('Third-party timeout: can be interrupted and will not hang forever', async () => {
  registerSpeechProvider({
    id: 'my-asr',
    name: '慢实现',
    transcribe: (_input, signal) =>
      new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      }),
  });
  const result = await hearWith(makeSpeech().service, { audio: encode(AUDIO) }, 10);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, 'generate-error');
});

test('The third party gets the decoded bytes and language', async () => {
  let seen: { audio: Uint8Array; language?: string } | undefined;
  registerSpeechProvider({
    id: 'my-asr',
    name: '记录',
    transcribe: async (input) => {
      seen = input;
      return '好';
    },
  });
  await hearWith(makeSpeech().service, { audio: encode(AUDIO), language: 'zh' });
  assert.deepEqual(new Uint8Array(seen?.audio ?? new Uint8Array()), AUDIO);
  assert.equal(seen?.language, 'zh');
});

test('After logging out: Return to the host', async () => {
  const dispose = registerSpeechProvider({ id: 'my-asr', name: '临时', transcribe: async () => '第三方' });
  dispose();
  const result = await hearWith(makeSpeech().service, { audio: encode(AUDIO) });
  assert.deepEqual(result, { ok: true, text: '你好' }, 'You should re-host after logging out.');
});
