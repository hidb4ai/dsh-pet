/**
 * Judgment test for working status broadcast: verify "Which states make the sound, which sentence is read, and the same
 * state is not repeated."
 *
 * Only pure judgment is tested; the real voice is the responsibility of speakNotice of shared/voice.ts and is not
 * covered by this document.
 *
 * Running method: node --experimental-strip-types --test src/client/voice-notify.test.ts
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { decideWorkStatusLine, resetSpokenState, speakWorkStatus } from './voice-notify.ts';
import { petBridge } from './settings/bridge.ts';
import { setSurface, setVoiceConfig, setVoiceNotifyEnabled } from '../shared/voice.ts';
import type { WorkStatusSnapshot } from '../shared/work-status.ts';
import type { Pet } from '../shared/types.ts';

/** Six lines of lines, the order is consistent with WORK_STATUS_INDEX. */
const TEXTS = [['思考中'], ['忙碌中'], ['整理中'], ['等你确认'], ['完成啦'], ['出错了']];

/** Create a pet with only the fields used in this module filled in. */
function mkPet(texts?: string[][]): Pet {
  return { id: 'main', workStatusTexts: texts } as unknown as Pet;
}

/** Create a working status snapshot. */
function mkSnap(state: WorkStatusSnapshot['state'], task: string | null = null): WorkStatusSnapshot {
  return { state, task };
}

describe('decideWorkStatusLine - Determination of working status broadcast', () => {
  test('The state has not changed → Don’t read', () => {
    assert.equal(decideWorkStatusLine(mkSnap('success'), [mkPet(TEXTS)], 'success'), undefined);
  });

  test('Non-notification state (thinking / working / result) → Don’t read', () => {
    for (const state of ['thinking', 'working', 'result'] as const) {
      assert.equal(decideWorkStatusLine(mkSnap(state), [mkPet(TEXTS)], null), undefined, state);
    }
  });

  test('Notify the state (waiting / success / error) → read the lines of the state', () => {
    assert.equal(decideWorkStatusLine(mkSnap('waiting'), [mkPet(TEXTS)], null), '等你确认');
    assert.equal(decideWorkStatusLine(mkSnap('success'), [mkPet(TEXTS)], null), '完成啦');
    assert.equal(decideWorkStatusLine(mkSnap('error'), [mkPet(TEXTS)], null), '出错了');
  });

  test('Mission details are not included in the broadcast: only the configuration lines are read', () => {
    assert.equal(decideWorkStatusLine(mkSnap('success', 'voice.ts 这里要修一下'), [mkPet(TEXTS)], null), '完成啦');
  });

  test('There are no lines for this state → Don’t read it (even if there are mission details)', () => {
    assert.equal(decideWorkStatusLine(mkSnap('success', '改文件'), [mkPet()], null), undefined);
    assert.equal(decideWorkStatusLine(mkSnap('success'), [], null), undefined);
  });

  test('idle (state is null) → do not read', () => {
    assert.equal(decideWorkStatusLine(mkSnap(null), [mkPet(TEXTS)], 'success'), undefined);
  });
});

/** Wait for the asynchronous chain to finish running. */
async function flush(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));
}

/** Minimalist browser stand-in: only allows the sound link to complete, and records the synthesis several times. */
function stubSpeakEnv(): { count: () => number; restore: () => void } {
  let count = 0;
  const previousFetch = globalThis.fetch;
  const previousAudio = (globalThis as { Audio?: unknown }).Audio;
  const previousCreate = URL.createObjectURL;
  const previousRevoke = URL.revokeObjectURL;
  (globalThis as { fetch: unknown }).fetch = () => {
    count += 1;
    return Promise.resolve({
      ok: true,
      headers: { get: () => 'audio/mpeg' },
      blob: async () => ({ size: 1 }),
    });
  };
  (globalThis as { Audio?: unknown }).Audio = class {
    volume = 1;
    onended: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onpause: (() => void) | null = null;
    play(): Promise<void> {
      setTimeout(() => this.onended?.(), 0);
      return Promise.resolve();
    }
    pause(): void {
      this.onpause?.();
    }
  };
  URL.createObjectURL = () => 'blob:dsh-pet-test';
  URL.revokeObjectURL = () => undefined;
  return {
    count: () => count,
    restore: () => {
      (globalThis as { fetch: unknown }).fetch = previousFetch;
      (globalThis as { Audio?: unknown }).Audio = previousAudio;
      URL.createObjectURL = previousCreate;
      URL.revokeObjectURL = previousRevoke;
    },
  };
}

describe('speakWorkStatus——Broadcast switch', () => {
  test('Switch off → no sound', async () => {
    const env = stubSpeakEnv();
    try {
      setSurface('web');
      setVoiceConfig('', true);
      setVoiceNotifyEnabled(false);
      resetSpokenState();
      petBridge.current = [mkPet(TEXTS)];
      speakWorkStatus(mkSnap('success'));
      await flush();
      assert.equal(env.count(), 0, 'Synthesis requests should not be sent when the switch is turned off.');
    } finally {
      env.restore();
    }
  });

  test('Switch on → read a configuration line', async () => {
    const env = stubSpeakEnv();
    try {
      setSurface('web');
      setVoiceConfig('', true);
      setVoiceNotifyEnabled(true);
      resetSpokenState();
      petBridge.current = [mkPet(TEXTS)];
      speakWorkStatus(mkSnap('success'));
      await flush();
      assert.equal(env.count(), 1, 'A synthesis request should be sent when the switch is turned on');
    } finally {
      env.restore();
    }
  });
});
