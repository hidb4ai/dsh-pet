/**
 * Contract test of click sound effect (src/client/pet/click-sound.ts): when the switch is turned off, it will not be
 * constructed or played; it will be played once after it is turned on, and the connection point in the throttling
 * window will only sound once; the audio construction or playback failure will not be thrown. Use fake Audio with fake
 * clock without touching the real device.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { playClickSound, setClickSoundEnabled } from './click-sound.ts';

/** False Audio: Record structure and play times. */
class FakeAudio {
  static constructed = 0;
  static plays = 0;
  volume = 0;
  currentTime = 0;

  constructor() {
    FakeAudio.constructed += 1;
  }

  play(): Promise<void> {
    FakeAudio.plays += 1;
    return Promise.resolve();
  }
}

/** Fake clock; the use case directly changes the `now` advance time. */
interface Clock {
  now: number;
}

/** Replace Audio and Date.now and restore after running a use case (including turning off the switch). */
function withFakeAudio(run: (clock: Clock) => void): void {
  const previousAudio = globalThis.Audio;
  const previousNow = Date.now;
  const clock: Clock = { now: 10_000 };
  FakeAudio.constructed = 0;
  FakeAudio.plays = 0;
  (globalThis as { Audio?: unknown }).Audio = FakeAudio;
  Date.now = () => clock.now;
  try {
    run(clock);
  } finally {
    (globalThis as { Audio?: unknown }).Audio = previousAudio;
    Date.now = previousNow;
    setClickSoundEnabled(false);
  }
}

describe('playClickSound —— Click sound effect', () => {
  test('Switch off: no construction, no playback', () => {
    withFakeAudio(() => {
      setClickSoundEnabled(false);
      playClickSound();
      assert.equal(FakeAudio.constructed, 0);
      assert.equal(FakeAudio.plays, 0);
    });
  });

  test('Switch on: play once, the connected dots in the throttling window only sound once, audio instance reuse', () => {
    withFakeAudio((clock) => {
      setClickSoundEnabled(true);
      playClickSound();
      assert.equal(FakeAudio.plays, 1, 'Ringing for the first time');
      clock.now += 50;
      playClickSound();
      assert.equal(
        FakeAudio.plays,
        1,
        'The throttling window does not sound repeatedly when connected dots are connected.',
      );
      clock.now += 200;
      playClickSound();
      assert.equal(FakeAudio.plays, 2, 'Recovery after throttling window exceeded');
      assert.equal(FakeAudio.constructed, 1, 'audio instance reuse, no repeated construction');
    });
  });

  test('Audio is not available: do not throw (no sound should not turn into an error)', () => {
    const previousAudio = globalThis.Audio;
    const previousNow = Date.now;
    const clock: Clock = { now: 30_000 };
    (globalThis as { Audio?: unknown }).Audio = class {
      volume = 0;
      currentTime = 0;

      play(): Promise<void> {
        throw new Error('设备不可用');
      }
    };
    Date.now = () => clock.now;
    try {
      setClickSoundEnabled(true);
      assert.doesNotThrow(() => playClickSound());
    } finally {
      (globalThis as { Audio?: unknown }).Audio = previousAudio;
      Date.now = previousNow;
      setClickSoundEnabled(false);
    }
  });
});
