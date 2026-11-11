/**
 * Single test of web page playback progress register table (src/client/progress.ts) - issue #122 Article 2.
 *
 * Three contracts:
 * 1. Read on demand: the value is re-retrieved every time it is called (not a snapshot), and the position read during
 * playback is the position at that moment;
 * 2. No register / empty id / non-character string → `null` , never thrown to a third party;
 * 3. When the same id is remounted, the cleanup function of the old instance cannot remove the new read function
 * (otherwise the port will be silently invalid).
 *
 * Use Node to build test runner without introducing any npm dependencies.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { progressReaderCount, readProgress, registerProgress } from './progress.ts';

const progress = (currentTime: number, playbackId: string | null = null, anim = 'walk') => ({
  playbackId,
  anim,
  currentTime,
  duration: 10,
  paused: false,
  buffering: false,
});

describe('registerProgress / readProgress —— Playback progress within the page', () => {
  test('The current value can be read after registering, and the value is re-retrieved every time it is called (on demand, not a snapshot)', () => {
    let t = 0.5;
    const off = registerProgress('p1', () => progress(t));
    assert.equal(readProgress('p1')?.currentTime, 0.5);
    t = 3.25; // Simulation playback advancement
    assert.equal(readProgress('p1')?.currentTime, 3.25, 'Read on demand: the latest value should be obtained');
    off();
    assert.equal(readProgress('p1'), null, 'Unable to read after removal');
  });

  test('playbackId is revealed as it is: playback request has value, self-broadcast is null', () => {
    const off1 = registerProgress('pointed', () => progress(1, 'pb_1'));
    assert.equal(readProgress('pointed')?.playbackId, 'pb_1');
    off1();

    const off2 = registerProgress('auto', () => progress(1, null));
    assert.equal(readProgress('auto')?.playbackId, null);
    off2();
  });

  test('anim is revealed as it is: the action in the pool is given to the name, url playback request is given to the address', () => {
    const off1 = registerProgress('named', () => progress(1, null, 'walk'));
    assert.equal(readProgress('named')?.anim, 'walk');
    off1();

    const off2 = registerProgress('byUrl', () => progress(1, 'pb_2', 'https://example.com/a.webm'));
    assert.equal(readProgress('byUrl')?.anim, 'https://example.com/a.webm');
    off2();
  });

  test('No register / empty id / non-character string → null (not thrown)', () => {
    assert.equal(readProgress('nope'), null);
    assert.equal(readProgress(''), null);
    assert.equal(readProgress(undefined as unknown as string), null);
    assert.equal(readProgress(42 as unknown as string), null);
  });

  test('The same id is remounted: the old cleanup function cannot remove the new read function', () => {
    const off1 = registerProgress('p2', () => progress(0));
    const off2 = registerProgress('p2', () => progress(9));
    off1(); // The old instance is unmounted (later than the new instance)
    assert.equal(readProgress('p2')?.currentTime, 9, 'The new read function must still exist');
    off2();
    assert.equal(readProgress('p2'), null);
  });

  test('Repeated calls to the cleanup function are harmless and the register number is not leaked.', () => {
    const before = progressReaderCount();
    const off = registerProgress('p3', () => progress(0));
    assert.equal(progressReaderCount(), before + 1);
    off();
    off();
    assert.equal(progressReaderCount(), before);
  });
});
