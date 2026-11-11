/**
 * Sleep state and selection logic single test: verify "Write three segment names when going to sleep, repeat the sleep
 * without replaying, wake up and only clear the state" and "Randomize the entire set + random within the segment,
 * return null when there is no available set".
 *
 * Pure logic, do not start HTTP, do not touch files; use callback to collect leaf synchronization. Running method:
 * node --experimental-strip-types --test src/host/sleep.test.ts
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { SleepStore, pickSleepNames, pickSleepText, sleepTextsOf, type SleepLeafData } from './sleep.ts';

describe('SleepStore——Sleep/wake up/leaf synchronization', () => {
  test('When you go to sleep, write three paragraphs of names and synchronize the leaves; when you go to sleep again, the original set will be kept and the leaves will not be written again.', () => {
    const writes: Array<[string, SleepLeafData]> = [];
    const store = new SleepStore({ onChange: (petId, data) => writes.push([petId, data]) });
    const first = { start: '睡-开始', loop: '睡-循环', end: '睡-起来' };
    const second = { start: '趴-开始', loop: '趴-循环', end: '趴-起来' };

    assert.equal(store.enter('a', first), true);
    assert.deepEqual(store.setOf('a'), first);
    assert.equal(store.enter('a', second), false, 'Already keeping the original set while sleeping');
    assert.deepEqual(store.setOf('a'), first);
    assert.equal(writes.length, 1, 'If you fall asleep repeatedly, you are not allowed to write another leaf.');
    assert.deepEqual(writes[0], ['a', { sleeping: true, ...first }]);
  });

  test('Clear the state when waking up and write sleeping:false; it is an idempotent no operation when not sleeping.', () => {
    const writes: Array<[string, SleepLeafData]> = [];
    const store = new SleepStore({ onChange: (petId, data) => writes.push([petId, data]) });
    store.enter('a', { start: 'a1', loop: 'a2', end: 'a3' });

    assert.equal(store.wake('a'), true);
    assert.equal(store.sleeping('a'), false);
    assert.deepEqual(writes[writes.length - 1], ['a', { sleeping: false }]);
    assert.equal(store.wake('a'), false);
    assert.equal(writes.length, 2);
  });

  test('anySleeping / ids reflects the currently sleeping pet; wakeAll clears once', () => {
    const store = new SleepStore();
    assert.equal(store.anySleeping(), false);
    store.enter('a', { start: 'a1', loop: 'a2', end: 'a3' });
    store.enter('b', { start: 'b1', loop: 'b2', end: 'b3' });
    assert.equal(store.anySleeping(), true);
    assert.deepEqual(store.ids().sort(), ['a', 'b']);
    store.wakeAll();
    assert.equal(store.anySleeping(), false);
    assert.deepEqual(store.ids(), []);
  });
});

describe('pickSleepNames——Random for the entire set + random within the segment', () => {
  const animations = {
    sleep: [
      { start: ['蹲-开始'], loop: ['蹲-循环'], end: ['蹲-起来'] },
      { start: ['趴-开始'], loop: ['趴-循环'], end: ['趴-起来'] },
    ],
  };

  test('I drew three pieces of the same suit (cannot fight across suits)', () => {
    // roll is determined in sequence: intra-segment index → intra-segment index → intra-segment index → set index (implementation order), when all are 0, it falls to the first set
    assert.deepEqual(
      pickSleepNames(animations, () => 0),
      { start: '蹲-开始', loop: '蹲-循环', end: '蹲-起来' },
    );
    assert.deepEqual(
      pickSleepNames(animations, () => 0.99),
      { start: '趴-开始', loop: '趴-循环', end: '趴-起来' },
    );
  });

  test('When there are multiple candidates in a segment, they can each hit different items.', () => {
    const multi = { sleep: [{ start: ['A1', 'A2'], loop: ['L1', 'L2'], end: ['E1', 'E2'] }] };
    const rolls = [0.9, 0.1, 0.9];
    let index = 0;
    const picked = pickSleepNames(multi, () => rolls[index++] ?? 0);
    assert.deepEqual(picked, { start: 'A2', loop: 'L1', end: 'E2' });
  });

  test('null is returned when there is no configuration/empty array/empty segment (the caller refuses to sleep based on this)', () => {
    assert.equal(pickSleepNames(undefined), null);
    assert.equal(pickSleepNames({}), null);
    assert.equal(pickSleepNames({ sleep: [] }), null);
    assert.equal(pickSleepNames({ sleep: [{ start: [], loop: ['L'], end: ['E'] }] }), null);
    assert.equal(pickSleepNames({ sleep: [{ start: ['S'], loop: ['L'] }] }), null);
  });
});

describe('Text pool - lines only come from configuration, no second copy of code is left', () => {
  test('pickSleepText: Randomly pick a sentence when the pool is not empty; if the pool is empty, undefined will be returned (the caller does not play the bubble)', () => {
    const saved = Math.random;
    try {
      Math.random = () => 0.99;
      assert.equal(pickSleepText(['A', 'B']), 'B');
      assert.equal(pickSleepText([]), undefined);
    } finally {
      Math.random = saved;
    }
  });

  test('sleepTextsOf: The three groups of lines are all read from the entry configuration, and the missing fields are empty (default if no code is dropped)', () => {
    const conf = {
      sleepStartTexts: ['去睡了'],
      sleepEndTexts: ['醒了'],
      sleepRefuseTexts: ['别吵'],
    };
    assert.deepEqual(sleepTextsOf(conf), {
      start: ['去睡了'],
      end: ['醒了'],
      refuse: ['别吵'],
    });
    assert.deepEqual(sleepTextsOf({}), { start: [], end: [], refuse: [] });
  });
});
