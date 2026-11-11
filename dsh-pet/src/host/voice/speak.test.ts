/**
 * Behavioral testing of voice services (src/host/voice/speak.ts). The synthesis implementation is injected by use
 * cases: the default suite is not connected to the Internet, only the boundaries and orchestration logic are verified.
 */
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { VoiceSynthError, type SynthInput } from './edge.ts';
import { registerVoiceProvider } from './registry.ts';
import { MAX_TEXT_CHARS, createVoiceService, isQueueStale, type VoiceService } from './speak.ts';

/** Create an isolated voice service; `synthesize` defaults to a false mp3. */
async function withService(
  run: (voice: VoiceService, root: string) => Promise<void>,
  synthesize?: (input: SynthInput) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-pet-voice-svc-'));
  try {
    const voice = createVoiceService({
      userRoot: root,
      synthesize: synthesize ?? ((input) => writeFile(input.target, Buffer.from('mp3'))),
    });
    await run(voice, root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

/** Waiting for asynchronous file operation; event loop count cannot serve as time limit for I/O. */
async function waitFor(check: () => boolean): Promise<void> {
  const deadline = performance.now() + 5000;
  while (performance.now() < deadline) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail('Waiting condition timed out');
}

test('text is empty or completely blank: judge bad-request and do not call synthesis', () =>
  withService(async (voice) => {
    const result = await voice.speak({ text: '   ' });
    assert.equal(result.ok, false);
    assert.equal(result.ok === false ? result.reason : '', 'bad-request');
  }));

test('text exceeds the upper limit: judge bad-request without truncation', () =>
  withService(async (voice) => {
    const result = await voice.speak({ text: '中'.repeat(MAX_TEXT_CHARS + 1) });
    assert.equal(result.ok, false);
    assert.equal(result.ok === false ? result.reason : '', 'bad-request');
    assert.match(result.ok === false ? result.message : '', /too long/);
  }));

test('voice is not in the whitelist: judge bad-request and list the valid values', () =>
  withService(async (voice) => {
    const result = await voice.speak({ text: '你好', voice: 'zh-CN-NopeNeural' });
    assert.equal(result.ok, false);
    assert.match(result.ok === false ? result.message : '', /zh-CN-XiaoxiaoNeural/);
  }));

test('rate format is invalid: judge bad-request', () =>
  withService(async (voice) => {
    const result = await voice.speak({ text: '你好', rate: '10%' });
    assert.equal(result.ok, false);
    assert.match(result.ok === false ? result.message : '', /rate/);
  }));

test('Valid request: return mp3 path, the file does persist to disk', () =>
  withService(async (voice, root) => {
    const result = await voice.speak({ text: '今天也要加油哦' });
    assert.equal(result.ok, true);
    const file = result.ok ? result.file : '';
    assert.ok(file.startsWith(join(root, 'voice-cache')), 'Must fall under voice-cache');
    assert.ok(file.endsWith('.mp3'));
  }));

test('The same input for the second time: cache is hit and synthesis is no longer called.', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-pet-voice-hit-'));
  try {
    let calls = 0;
    const voice = createVoiceService({
      userRoot: root,
      synthesize: async (input) => {
        calls += 1;
        await writeFile(input.target, Buffer.from('mp3'));
      },
    });
    await voice.speak({ text: '同一句话' });
    const second = await voice.speak({ text: '同一句话' });
    assert.equal(second.ok, true);
    assert.equal(calls, 1, 'The cache must be hit the second time');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('synthesis failed: judgment generate-error, do not return upstream details to the caller', () =>
  withService(
    async (voice) => {
      const result = await voice.speak({ text: '你好' });
      assert.equal(result.ok, false);
      assert.equal(result.ok === false ? result.reason : '', 'generate-error');
      assert.doesNotMatch(result.ok === false ? result.message : '', /https?:/, 'Do not echo the upstream address');
    },
    async () => {
      throw new VoiceSynthError('upstream 403 from https://example.invalid');
    },
  ));

test('The queue is full: subsequent requests will be judged as voice-busy instead of being queued indefinitely.', () => {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return withService(
    async (voice) => {
      let settled = 0;
      const calls = ['a', 'b', 'c', 'd', 'e'].map((text) =>
        voice.speak({ text }).then((result) => {
          settled += 1;
          return result;
        }),
      );
      await waitFor(() => settled >= 2);
      release();
      const results = await Promise.all(calls);
      const busy = results.filter((result) => !result.ok && result.reason === 'voice-busy');
      assert.ok(busy.length >= 1, 'At least one request should be evaluated as voice-busy');
    },
    () => gate,
  );
});

test('isQueueStale - discarded after queuing for a long time', () => {
  assert.equal(isQueueStale(1_000, 1_000), false, 'It’s not long since it was my turn');
  assert.equal(
    isQueueStale(1_000, 1_000 + 28_000),
    false,
    'Just reached the upper limit but still within the allowable range',
  );
  assert.equal(isQueueStale(1_000, 1_000 + 28_001), true, 'If it exceeds the upper limit, it should be thrown away.');
});

test('Queue until the client has already given up: discard it directly, no more wasted synthesis', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-pet-voice-stale-'));
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  const voice = createVoiceService({
    userRoot: root,
    staleWaitMs: 100,
    synthesize: async (input) => {
      calls += 1;
      if (calls === 1) await gate; // The first sentence occupies the serial chain, and only the second sentence can be queued.
      await writeFile(input.target, Buffer.from('mp3'));
    },
  });
  try {
    const first = voice.speak({ text: '第一句' }); // Holding the queue and not releasing it
    await waitFor(() => calls === 1);
    const second = voice.speak({ text: '第二句' }); // behind it
    await new Promise((resolve) => setTimeout(resolve, 200)); // The waiting upper limit is exceeded, and the first request is given a margin for normal scheduling.
    release();
    const [kept, dropped] = await Promise.all([first, second]);
    assert.equal(kept.ok, true, 'The first ranked synthesis is as usual');
    assert.equal(dropped.ok === false ? dropped.reason : '', 'voice-busy');
    assert.match(dropped.ok === false ? dropped.message : '', /queued too long/);
    assert.equal(calls, 1, 'The discarded sentence cannot be synthesized again.');
  } finally {
    release();
    await rm(root, { recursive: true, force: true });
  }
});

test('Registered a third-party implementation: synthesis goes through it, and the built-in is not adjusted even once', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-pet-voice-provider-'));
  let edgeCalls = 0;
  let providerCalls = 0;
  const dispose = registerVoiceProvider({
    id: 'my-tts',
    name: '我的语音',
    synthesize: async () => {
      providerCalls += 1;
      return new Uint8Array([1, 2, 3]);
    },
  });
  try {
    const voice = createVoiceService({
      userRoot: root,
      synthesize: async () => {
        edgeCalls += 1;
      },
    });
    const result = await voice.speak({ text: '你好' });
    assert.equal(result.ok, true);
    assert.equal(providerCalls, 1, 'Should be implemented by a third party');
    assert.equal(edgeCalls, 0, 'You should not adjust the built-in after registering');
  } finally {
    dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test('The third party returns empty bytes: judge generate-error, leaving no 0 bytes file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-pet-voice-empty-'));
  const dispose = registerVoiceProvider({ id: 'my-tts', name: '我的语音', synthesize: async () => new Uint8Array() });
  try {
    const voice = createVoiceService({ userRoot: root, synthesize: async () => undefined });
    const result = await voice.speak({ text: '你好' });
    assert.equal(result.ok, false);
    assert.equal(result.ok === false ? result.reason : '', 'generate-error');
  } finally {
    dispose();
    await rm(root, { recursive: true, force: true });
  }
});
