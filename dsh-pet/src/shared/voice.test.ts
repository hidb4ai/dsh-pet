/**
 * Judgment behavior test for client-side voice broadcast (src/shared/voice.ts): whether this sentence should be read
 * or not.
 *
 * Four contracts:
 * 1. Only the local end of the leaf roll call will read - `voiceTo` . By default or the other end, only bubble will be
 * played;
 * 2. Don’t read when the web page is invisible (no one is watching and don’t make a sound);
 * 3. The synthesis failure falls to `failed` , and a mute speaker is left on the interface instead of nothing;
 * 4. `start` and `end` are reported once for each sentence; `end` is only sent after the broadcast is completed (or
 * fails or times out), and the bubble relies on it to decide when to close it.
 *
 * The playback itself (Audio / blob) only makes sense in the browser. Here we use fake audio to verify "whether a
 * synthesis request has been sent", status and cleanup timing.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  PLAYBACK_WAIT_MAX_MS,
  getVoiceState,
  playSayVoice,
  setSurface,
  setVoiceConfig,
  speakNotice,
  subscribeVoiceUtterance,
  type VoiceUtteranceEvent,
} from './voice.ts';

/** Fake synthesis endpoint: records each request, and the response is a fake audio by default; `ok: false` simulates the host and returns failure. */
function stubFetch(options: { ok?: boolean; hold?: boolean } = {}): {
  calls: Array<{ text: string }>;
  pending: Array<{ resolve: () => void; reject: () => void }>;
  restore: () => void;
} {
  const ok = options.ok ?? true;
  const hold = options.hold === true;
  const calls: Array<{ text: string }> = [];
  const pending: Array<{ resolve: () => void; reject: () => void }> = [];
  const previous = globalThis.fetch;
  const respond = () => ({
    ok,
    headers: { get: () => (ok ? 'audio/mpeg' : 'application/json') },
    blob: async () => ({ size: 1 }),
  });
  (globalThis as { fetch: unknown }).fetch = (_url: string, init?: { body?: string }) => {
    calls.push({ text: String((JSON.parse(init?.body ?? '{}') as { text?: unknown }).text ?? '') });
    if (!hold) return Promise.resolve(respond());
    return new Promise((resolve, reject) => {
      pending.push({ resolve: () => resolve(respond()), reject: () => reject(new Error('合成失败')) });
    });
  };
  return {
    calls,
    pending,
    restore: () => {
      (globalThis as { fetch: unknown }).fetch = previous;
    },
  };
}

/** Fake audio: The test must be able to manually trigger cleanup to nail "end only after playing". */
interface FakeAudio {
  /** Volume field with the same name as the real Audio. */
  volume: number;
  onended: (() => void) | null;
  onerror: (() => void) | null;
  onpause: (() => void) | null;
  /** Has it been cut off? */
  paused: boolean;
  play(): Promise<void>;
  /** Cut off (real Audio method). */
  pause(): void;
  /** Simulate a cleanup event. */
  fire(event: 'ended' | 'error' | 'pause'): void;
}

/**
 * Add two objects that are only available in browsers: audio element and blob address.
 *
 * @param options - `volumes` collects the volume of each audio segment when it is played; `autoEnd` defaults to true,
 * allowing use cases that do not care about the duration
 * The broadcast will automatically end after it starts; `playFails` simulates the browser refusing to start the
 * broadcast.
 * @returns Fake audio and restoration function created in playback order.
 */
function stubBrowser(options: { volumes?: number[]; autoEnd?: boolean; playFails?: boolean } = {}): {
  audios: FakeAudio[];
  restore: () => void;
} {
  const { volumes, autoEnd = true, playFails = false } = options;
  const previousAudio = (globalThis as { Audio?: unknown }).Audio;
  const previousCreate = URL.createObjectURL;
  const previousRevoke = URL.revokeObjectURL;
  const audios: FakeAudio[] = [];
  (globalThis as { Audio?: unknown }).Audio = class {
    /** The volume field with the same name as the real Audio: the code under test writes it, and here it is taken out at play. */
    volume = 1;
    onended: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onpause: (() => void) | null = null;
    /** Set when the code under test is cut off: the new sentence takes over the old sentence and is verified by it. */
    paused = false;

    constructor() {
      audios.push(this);
    }

    play(): Promise<void> {
      volumes?.push(this.volume);
      if (playFails) return Promise.reject(new Error('play blocked'));
      // Macro task instead of micro task: cleanup callback is hung by the code under test after await play()
      if (autoEnd) setTimeout(() => this.fire('ended'), 0);
      return Promise.resolve();
    }

    pause(): void {
      this.paused = true;
      this.onpause?.();
    }

    fire(event: 'ended' | 'error' | 'pause'): void {
      if (event === 'ended') this.onended?.();
      else if (event === 'error') this.onerror?.();
      else this.onpause?.();
    }
  };
  URL.createObjectURL = () => 'blob:dsh-pet-test';
  URL.revokeObjectURL = () => undefined;
  return {
    audios,
    restore: () => {
      (globalThis as { Audio?: unknown }).Audio = previousAudio;
      URL.createObjectURL = previousCreate;
      URL.revokeObjectURL = previousRevoke;
    },
  };
}

/** Let the asynchronous bypass at the back run out (the playback is void, not await). */
async function flush(): Promise<void> {
  for (let round = 0; round < 20; round++) await new Promise((resolve) => setTimeout(resolve, 0));
}

/** Only run micro tasks: {@link flush} cannot be used in the use case of mock instead of setTimeout, otherwise it will wait for a timer that will never come. */
async function microtasks(): Promise<void> {
  for (let round = 0; round < 20; round++) await Promise.resolve();
}

describe('playSayVoice——Should this sentence be pronounced?', () => {
  test('The leaf is not named (voiceTo default) → no request is sent, the bubble remains as usual', async () => {
    const fetchStub = stubFetch();
    const browser = stubBrowser();
    try {
      setSurface('web');
      setVoiceConfig('', 1);
      playSayVoice({ text: '随便一句' });
      await flush();
      assert.equal(
        fetchStub.calls.length,
        0,
        'You shouldn’t synthesize if no one calls you by name, let alone say anything.',
      );
    } finally {
      browser.restore();
      fetchStub.restore();
    }
  });

  test('The other end of leaf roll call → the local end does not send a request', async () => {
    const fetchStub = stubFetch();
    const browser = stubBrowser();
    try {
      setSurface('web');
      setVoiceConfig('', 1);
      playSayVoice({ text: '这一句归桌面端', voiceTo: 'desktop' });
      await flush();
      assert.equal(fetchStub.calls.length, 0, 'This is the key to preventing repeated broadcasts at both ends.');
    } finally {
      browser.restore();
      fetchStub.restore();
    }
  });

  test('Name this client → send a synthesis request with the text as it is.', async () => {
    const fetchStub = stubFetch();
    const browser = stubBrowser();
    try {
      setSurface('desktop');
      setVoiceConfig('', 1);
      playSayVoice({ text: '该喝水了', voiceTo: 'desktop' });
      await flush();
      assert.deepEqual(fetchStub.calls, [{ text: '该喝水了' }]);
    } finally {
      browser.restore();
      fetchStub.restore();
    }
  });

  test('The page is not visible on the web page → no request is sent (visibility is not checked on the desktop)', async () => {
    const fetchStub = stubFetch();
    const browser = stubBrowser();
    const previousDocument = (globalThis as { document?: unknown }).document;
    (globalThis as { document?: unknown }).document = { hidden: true };
    try {
      setSurface('web');
      setVoiceConfig('', 1);
      playSayVoice({ text: '后台标签页', voiceTo: 'web' });
      await flush();
      assert.equal(fetchStub.calls.length, 0, 'Pages that no one is viewing should not make any noise.');

      // The desktop side on the same machine is not affected: it does not have document.hidden
      setSurface('desktop');
      playSayVoice({ text: '桌面端照念', voiceTo: 'desktop' });
      await flush();
      assert.deepEqual(fetchStub.calls, [{ text: '桌面端照念' }]);
    } finally {
      (globalThis as { document?: unknown }).document = previousDocument;
      browser.restore();
      fetchStub.restore();
    }
  });

  test('synthesis failed → status falls to failed (leaving a mute speaker instead of no icon at all)', async () => {
    const fetchStub = stubFetch({ ok: false });
    const browser = stubBrowser();
    try {
      setSurface('desktop');
      setVoiceConfig('', 1);
      playSayVoice({ text: '这句合成不出来', voiceTo: 'desktop' });
      await flush();
      assert.equal(fetchStub.calls.length, 1, 'The synthesis request of this request is sent as usual');
      assert.equal(getVoiceState(), 'failed', 'Failure must be visible and cannot be returned silently idle');
    } finally {
      browser.restore();
      fetchStub.restore();
    }
  });
});

describe('Play event - the bubble depends on it to decide when to collapse', () => {
  test('Read a sentence: start once and end once. Long sentences will also be sent to synthesis.', async () => {
    const events: VoiceUtteranceEvent[] = [];
    const fetchStub = stubFetch();
    const browser = stubBrowser();
    const off = subscribeVoiceUtterance((event) => events.push(event));
    try {
      const text = '很长的一句话。'.repeat(20);
      setSurface('desktop');
      setVoiceConfig('', 1);
      playSayVoice({ text, voiceTo: 'desktop' });
      await flush();
      assert.deepEqual(
        events.map((event) => event.kind),
        ['start', 'end'],
      );
      assert.equal(fetchStub.calls[0]?.text, text, 'No truncation: the full sentence of bubble is sent to synthesis.');
      assert.equal(events[0].text, text, 'Event with original text: bubble. Press it to recognize the sentence.');
      assert.equal(events[0].seq, events[1].seq, 'Pairs of the same sentence must have the same sequence number');
    } finally {
      off();
      browser.restore();
      fetchStub.restore();
    }
  });

  test('end is also reported when synthesis fails: bubble cannot hang forever just because of failure.', async () => {
    const events: VoiceUtteranceEvent[] = [];
    const fetchStub = stubFetch({ ok: false });
    const browser = stubBrowser();
    const off = subscribeVoiceUtterance((event) => events.push(event));
    try {
      setSurface('desktop');
      setVoiceConfig('', 1);
      playSayVoice({ text: '这句合成不出来', voiceTo: 'desktop' });
      await flush();
      assert.deepEqual(
        events.map((event) => event.kind),
        ['start', 'end'],
      );
    } finally {
      off();
      browser.restore();
      fetchStub.restore();
    }
  });

  test('No events will be reported for sentences that should not be read: don’t prolong the bubble if there is no voice.', async () => {
    const events: VoiceUtteranceEvent[] = [];
    const fetchStub = stubFetch();
    const browser = stubBrowser();
    const off = subscribeVoiceUtterance((event) => events.push(event));
    try {
      setSurface('web');
      setVoiceConfig('', 1);
      playSayVoice({ text: '这一句归桌面端', voiceTo: 'desktop' });
      await flush();
      assert.equal(events.length, 0);
    } finally {
      off();
      browser.restore();
      fetchStub.restore();
    }
  });

  test('No more events will be received after unsubscribing', async () => {
    const events: VoiceUtteranceEvent[] = [];
    const fetchStub = stubFetch();
    const browser = stubBrowser();
    const off = subscribeVoiceUtterance((event) => events.push(event));
    off();
    try {
      setSurface('desktop');
      setVoiceConfig('', 1);
      playSayVoice({ text: '没人听了', voiceTo: 'desktop' });
      await flush();
      assert.equal(events.length, 0);
    } finally {
      browser.restore();
      fetchStub.restore();
    }
  });

  test('Send end after the broadcast: bubble will not close after 1.5 seconds after it starts broadcasting', async () => {
    const events: VoiceUtteranceEvent[] = [];
    const fetchStub = stubFetch();
    const browser = stubBrowser({ autoEnd: false });
    const off = subscribeVoiceUtterance((event) => events.push(event));
    try {
      setSurface('desktop');
      setVoiceConfig('', 1);
      playSayVoice({ text: '这一句要念一会儿', voiceTo: 'desktop' });
      await flush();
      assert.deepEqual(
        events.map((event) => event.kind),
        ['start'],
        'The audio is still playing, but the bubble cannot receive the cleanup signal.',
      );
      assert.equal(browser.audios.length, 1, 'Playback should have started');
      browser.audios[0].fire('ended');
      await flush();
      assert.deepEqual(
        events.map((event) => event.kind),
        ['start', 'end'],
        'The bubble is only allowed to be closed after the broadcast is finished.',
      );
    } finally {
      off();
      browser.restore();
      fetchStub.restore();
    }
  });

  test('end will be sent even if the broadcast fails: bubble cannot hang permanently because the browser refuses to play.', async () => {
    const events: VoiceUtteranceEvent[] = [];
    const fetchStub = stubFetch();
    const browser = stubBrowser({ playFails: true });
    const off = subscribeVoiceUtterance((event) => events.push(event));
    try {
      setSurface('desktop');
      setVoiceConfig('', 1);
      playSayVoice({ text: '播不出来', voiceTo: 'desktop' });
      await flush();
      assert.deepEqual(
        events.map((event) => event.kind),
        ['start', 'end'],
      );
      assert.equal(getVoiceState(), 'failed', 'Failure to start broadcast must be visible');
    } finally {
      off();
      browser.restore();
      fetchStub.restore();
    }
  });

  test('Playback is stuck: press cleanup when the upper limit is reached, the bubble will not hang permanently', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const events: VoiceUtteranceEvent[] = [];
    const fetchStub = stubFetch();
    const browser = stubBrowser({ autoEnd: false });
    const off = subscribeVoiceUtterance((event) => events.push(event));
    try {
      setSurface('desktop');
      setVoiceConfig('', 1);
      playSayVoice({ text: '这句卡住了', voiceTo: 'desktop' });
      await microtasks();
      assert.deepEqual(
        events.map((event) => event.kind),
        ['start'],
        'Cleanup should not be performed before the upper limit is reached.',
      );
      t.mock.timers.tick(PLAYBACK_WAIT_MAX_MS);
      await microtasks();
      assert.deepEqual(
        events.map((event) => event.kind),
        ['start', 'end'],
        'Cleanup is required when the upper limit is reached',
      );
    } finally {
      off();
      browser.restore();
      fetchStub.restore();
    }
  });
});

describe('setVoiceConfig —— Volume coefficient', () => {
  test('0.35 is played as it is: audio.volume is 0.35', async () => {
    const sink = { volumes: [] as number[] };
    const fetchStub = stubFetch();
    const browser = stubBrowser({ volumes: sink.volumes });
    try {
      setSurface('web');
      setVoiceConfig('', 0.35);
      playSayVoice({ text: '小声说', voiceTo: 'web' });
      await flush();
      assert.deepEqual(sink.volumes, [0.35], 'The volume should fall to the audio that is actually played');
    } finally {
      browser.restore();
      fetchStub.restore();
    }
  });

  test('Out-of-bounds and dirty values converge to 0–1: 2 → 1, -1 → 0, non-numeric → 1', async () => {
    const sink = { volumes: [] as number[] };
    const fetchStub = stubFetch();
    const browser = stubBrowser({ volumes: sink.volumes });
    try {
      setSurface('web');
      const cases: ReadonlyArray<readonly [unknown, number]> = [
        [2, 1],
        [-1, 0],
        ['不是数字', 1],
        [0, 0],
      ];
      for (const [input, wanted] of cases) {
        setVoiceConfig('', input);
        playSayVoice({ text: '说一句', voiceTo: 'web' });
        await flush();
        assert.equal(
          sink.volumes[sink.volumes.length - 1],
          wanted,
          `Volume ${String(input)} should converge to ${wanted}`,
        );
      }
    } finally {
      browser.restore();
      fetchStub.restore();
    }
  });
});

describe('Automatic broadcasting is mutually exclusive - the sound does not overlap when the screen is turned off and wakes up.', () => {
  test('Two consecutive sentences: the latter sentence takes over, and the previous sentence is pause, which will not sound at the same time.', async () => {
    const fetchStub = stubFetch();
    const browser = stubBrowser({ autoEnd: false });
    try {
      setSurface('web');
      setVoiceConfig('', 1);
      playSayVoice({ text: '第一句', voiceTo: 'web' });
      await flush();
      playSayVoice({ text: '第二句', voiceTo: 'web' });
      await flush();
      assert.equal(browser.audios.length, 2, 'Each of the two sentences requires an audio clip.');
      assert.equal(browser.audios[0].paused, true, 'The first sentence must be cut off');
      assert.equal(browser.audios[1].paused, false, 'The second sentence is still ringing');
    } finally {
      browser.restore();
      fetchStub.restore();
    }
  });

  test('The page is hidden during synthesis: this sentence is not played and the sound cannot be waited for.', async () => {
    const sink = { volumes: [] as number[] };
    const fetchStub = stubFetch();
    const browser = stubBrowser({ volumes: sink.volumes, autoEnd: false });
    const previousDocument = (globalThis as { document?: unknown }).document;
    try {
      setSurface('web');
      setVoiceConfig('', 1);
      (globalThis as { document?: unknown }).document = { hidden: true };
      playSayVoice({ text: '息屏时生成的一句', voiceTo: 'web' });
      await flush();
      assert.deepEqual(sink.volumes, [], 'Synthesis sentences should not be overbroadcast during hiding');
    } finally {
      (globalThis as { document?: unknown }).document = previousDocument;
      browser.restore();
      fetchStub.restore();
    }
  });

  test('Expired failure: late error in the previous sentence → the speaker in the next sentence is still ready', async () => {
    const fetchStub = stubFetch({ hold: true });
    const browser = stubBrowser({ autoEnd: false });
    try {
      setSurface('web');
      setVoiceConfig('', 1);
      playSayVoice({ text: '第一句', voiceTo: 'web' });
      playSayVoice({ text: '第二句', voiceTo: 'web' });
      await flush();
      assert.equal(fetchStub.pending.length, 2, 'Each of the two sentences sends a synthesis request.');
      // Let the next sentence succeed first, and then let the previous sentence fail: the failure arrives too late, and the speaker of the new sentence cannot be muted.
      fetchStub.pending[1].resolve();
      await flush();
      fetchStub.pending[0].reject();
      await flush();
      assert.equal(
        getVoiceState(),
        'ready',
        'The new sentence is ready, the failure of the old sentence should not overwrite it',
      );
    } finally {
      browser.restore();
      fetchStub.restore();
    }
  });
});

describe('speakNotice - notification broadcast allows background sound', () => {
  test('When the page is not visible, send the request and start broadcasting as usual (it is most needed when the user walks away)', async () => {
    const fetchStub = stubFetch();
    const volumes: number[] = [];
    const browser = stubBrowser({ volumes });
    const previousDocument = (globalThis as { document?: unknown }).document;
    (globalThis as { document?: unknown }).document = { hidden: true };
    try {
      setSurface('web');
      setVoiceConfig('', 1);
      speakNotice('任务完成啦');
      await flush();
      assert.deepEqual(
        fetchStub.calls,
        [{ text: '任务完成啦' }],
        'Notification classes should not be blocked by visibility gates',
      );
      assert.equal(volumes.length, 1, 'Really start the broadcast instead of throwing it away after synthesis.');
    } finally {
      (globalThis as { document?: unknown }).document = previousDocument;
      browser.restore();
      fetchStub.restore();
    }
  });

  test('Empty string → Do not send request', async () => {
    const fetchStub = stubFetch();
    const browser = stubBrowser();
    try {
      setSurface('web');
      setVoiceConfig('', 1);
      speakNotice('');
      await flush();
      assert.equal(fetchStub.calls.length, 0, 'The empty string has no readable content.');
    } finally {
      browser.restore();
      fetchStub.restore();
    }
  });
});
