/**
 * polling unified state storage (S) unit test - verify the foundation of the entire design: counter semantics.
 *
 * Why nail this alone: The front end only relies on "counter changed" to decide whether to render or not.
 * - counter Missing update → The front end does not refresh even after writing the data (silent failure, the most
 * difficult to check);
 * - counter uses auto-increment (0,1,2…) → the host restarts and returns to zero, but the front-end still has the old
 * value, and the comparison is permanently invalid (/ notify If auto-increment is used, this will happen: seq returns
 * to zero after restarting, and `seq <= previousValue` is always established → the notification never pops up again);
 * - counter uses Date.now() but writes twice in the same millisecond → the second time is swallowed as "no change".
 * This document nails all three.
 *
 * Running method: node --experimental-strip-types --test src/host/state.test.ts
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { MAX_STATE_WAIT_MS, parseStateWaitQuery, PollStateStore } from './state.ts';

describe('PollStateStore——Initial form', () => {
  test('The six global leaves are { counter:0 , data:null } (0 = never written, the first pull of the front end is used as the baseline)', () => {
    const s = new PollStateStore().read();
    assert.deepEqual(Object.keys(s.sections).sort(), [
      'balance',
      'config',
      'focusSession',
      'menu',
      'notify',
      'workStatus',
    ]);
    for (const leaf of Object.values(s.sections)) assert.deepEqual(leaf, { counter: 0, data: null });
    assert.deepEqual(s.pets, {});
  });
});

describe('PollStateStore - Configuration change signal (sections.config)', () => {
  test('Pure signal leaf: data is always {}, only counter is valid information', () => {
    const store = new PollStateStore();
    store.writeSection('config', {});
    const leaf = store.read().sections.config;
    assert.deepEqual(leaf.data, {});
    assert.ok(leaf.counter > 0);
  });

  test('Advance counter every time you write (you must be able to tell "changed again" even if you write twice)', () => {
    const store = new PollStateStore();
    store.writeSection('config', {});
    const a = store.read().sections.config.counter;
    store.writeSection('config', {});
    const b = store.read().sections.config.counter;
    assert.ok(
      b > a,
      'counter must be strictly incremented, otherwise the second change within the same millisecond will be missed by the consumer',
    );
  });

  test('Writing it does not affect other global leaves (the counters of each leaf do not interfere with each other)', () => {
    const store = new PollStateStore();
    store.writeSection('balance', { ok: true });
    const before = store.read().sections.balance.counter;
    store.writeSection('config', {});
    assert.equal(store.read().sections.balance.counter, before);
    assert.equal(store.read().sections.notify.counter, 0, 'Unwritten leaves remain 0');
  });
});

describe('PollStateStore - writing and reading', () => {
  test('Write global leaves: counter changed, data unchanged', () => {
    const store = new PollStateStore();
    const payload = { ok: true, provider: 'deepseek' };
    store.writeSection('balance', payload);
    const leaf = store.read().sections.balance;
    assert.deepEqual(leaf.data, payload);
    assert.ok(leaf.counter > 0, 'counter must be a valid timestamp');
  });

  test('Writing pet leaves: entries are automatically created without interfering with each other', () => {
    const store = new PollStateStore();
    store.writePet('main', 'say', { text: '你好' });
    store.writePet('pet-2', 'say', { text: '在呢' });
    const s = store.read();
    assert.deepEqual(s.pets.main.say.data, { text: '你好' });
    assert.deepEqual(s.pets['pet-2'].say.data, { text: '在呢' });
    assert.notEqual(s.pets.main.say.counter, s.pets['pet-2'].say.counter);
  });

  test('data allows null (meaning "no data yet", consumer skips rendering)', () => {
    const store = new PollStateStore();
    store.writeSection('notify', null);
    assert.equal(store.read().sections.notify.data, null);
  });

  test('The five slots of the pet entry are built together (the unwritten slots are { counter:0 , data:null })', () => {
    const store = new PollStateStore();
    store.writePet('main', 'position', { x: 0.5, y: 0.5, mode: 'spring' });
    const entry = store.read().pets.main;
    // Keep a stable shape: after any leaf is written, all six keys exist, so consumers need not check for undefined.
    assert.deepEqual(Object.keys(entry).sort(), ['anim', 'lock', 'position', 'say', 'sleep', 'throw']);
    assert.deepEqual(entry.position.data, { x: 0.5, y: 0.5, mode: 'spring' });
    assert.deepEqual(entry.say, { counter: 0, data: null }, 'Unwritten slots remain empty leaves');
    assert.deepEqual(entry.anim, { counter: 0, data: null });
    assert.deepEqual(entry.throw, { counter: 0, data: null });
    assert.deepEqual(
      entry.lock,
      { counter: 0, data: null },
      'The occupied lock is also a resident slot (issue #122 item 4)',
    );
  });

  test('position and throw update counter independently (the two instructions do not swallow each other)', () => {
    const store = new PollStateStore();
    store.writePet('main', 'position', { x: 0.1, y: 0.2, mode: 'line', duration: 800 });
    const posCounter = store.read().pets.main.position.counter;
    store.writePet('main', 'throw', { angle: 45, power: 1 });
    const s = store.read();
    assert.ok(s.pets.main.throw.counter > posCounter, 'throw write must advance its own counter');
    assert.equal(
      s.pets.main.position.counter,
      posCounter,
      'counter of position should not be modified by the write of throw',
    );
  });

  test('Whole leaf replacement: the reference read first will not be changed by subsequent writes (half-new and half-old cannot happen)', () => {
    const store = new PollStateStore();
    store.writeSection('workStatus', { state: 'working' });
    const before = store.read().sections.workStatus;
    store.writeSection('workStatus', { state: null });
    assert.deepEqual(before.data, { state: 'working' }, 'Old references must retain their old values');
    assert.deepEqual(store.read().sections.workStatus.data, { state: null });
  });

  test('The sections returned by read() is a copy: external changes do not affect the internal state', () => {
    const store = new PollStateStore();
    const snapshot = store.read();
    delete (snapshot.sections as Record<string, unknown>).balance;
    assert.ok(store.read().sections.balance, 'Internal state should not be changed by caller');
  });
});

describe('PollStateStore —— counter must be strictly incremented (the only rendering criterion for the front end)', () => {
  test('Continuously writing the same leaf within the same millisecond, counter is also different', () => {
    const store = new PollStateStore();
    const seen = new Set<number>();
    for (let i = 0; i < 50; i++) {
      store.writeSection('notify', { i });
      seen.add(store.read().sections.notify.counter);
    }
    assert.equal(seen.size, 50, '50 consecutive writes must get 50 different counter');
  });

  test('Monotonically increasing across leaves (to prevent writes at the same time from being swallowed by the front end pressing "no change")', () => {
    const store = new PollStateStore();
    store.writeSection('balance', 1);
    const a = store.read().sections.balance.counter;
    store.writePet('main', 'say', 2);
    const b = store.read().pets.main.say.counter;
    store.writeSection('workStatus', 3);
    const c = store.read().sections.workStatus.counter;
    assert.ok(b > a && c > b, `counter should be strictly incremented: ${a} < ${b} < ${c}`);
  });

  test('counter sticks to the wall time (not self-increasing from 0) and will not go backwards after restarting', () => {
    const store = new PollStateStore();
    const before = Date.now();
    store.writeSection('balance', 1);
    const counter = store.read().sections.balance.counter;
    assert.ok(
      counter >= before,
      "counter should ≥ the wall time before writing (the old value in the front end's hands will only be smaller after restarting)",
    );
    assert.ok(counter - before < 1000, 'counter should not be significantly ahead of the wall time');
  });
});

describe('PollStateStore - top-level counter (version number of the entire S)', () => {
  test('Never written = 0; after writing, it is equal to the number of the last write', () => {
    const store = new PollStateStore();
    assert.equal(store.read().counter, 0);
    store.writeSection('balance', 1);
    assert.equal(store.read().counter, store.read().sections.balance.counter);
    store.writePet('main', 'say', { text: 'x' });
    assert.equal(store.read().counter, store.read().pets.main.say.counter, 'counter must follow the latest write');
  });
});

describe('parseStateWaitQuery ——? Analysis of since =& timeout =', () => {
  test('Neither is transmitted → none (return the full amount immediately = semantics before transformation)', () => {
    assert.deepEqual(parseStateWaitQuery(null, null), { kind: 'none' });
  });

  test('Only one → error (required in pairs, the same set of conventions as wait/timeout of / playback)', () => {
    assert.equal(parseStateWaitQuery('5', null).kind, 'error');
    assert.equal(parseStateWaitQuery(null, '1000').kind, 'error');
  });

  test('The valid value is revealed as it is; since =0 and timeout =0 are both valid', () => {
    assert.deepEqual(parseStateWaitQuery('0', '0'), { kind: 'ok', since: 0, timeoutMs: 0 });
    assert.deepEqual(parseStateWaitQuery('1755000000000', '1000'), {
      kind: 'ok',
      since: 1755000000000,
      timeoutMs: 1000,
    });
    assert.deepEqual(parseStateWaitQuery('1', String(MAX_STATE_WAIT_MS)), {
      kind: 'ok',
      since: 1,
      timeoutMs: MAX_STATE_WAIT_MS,
    });
  });

  test('Invalid values are always error (negative numbers/decimals/non-digits/exceeding the upper limit/empty string)', () => {
    const badSince = ['-1', '1.5', 'abc', '', ' ', '1e3', '+5'];
    for (const s of badSince) {
      assert.equal(
        parseStateWaitQuery(s, '1000').kind,
        'error',
        `since = ${JSON.stringify(s)} should be deemed illegal`,
      );
    }
    const badTimeout = [...badSince, String(MAX_STATE_WAIT_MS + 1)];
    for (const t of badTimeout) {
      assert.equal(
        parseStateWaitQuery('1', t).kind,
        'error',
        `timeout = ${JSON.stringify(t)} should be deemed illegal`,
      );
    }
  });
});

describe('PollStateStore.wait - pending waiting (long polling)', () => {
  /** Gadget to collect wake-up times */
  const collector = () => {
    const seen: number[] = [];
    return { seen, onWake: () => void seen.push(seen.length) };
  };

  test('The leaf has been written → wake up immediately and remove those who are waiting', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const store = new PollStateStore();
    const c = collector();
    const cancel = store.wait({ since: store.read().counter, timeoutMs: 10_000, onWake: c.onWake });
    assert.equal(store.waiterCount(), 1);
    store.writeSection('balance', { ok: true });
    assert.deepEqual(c.seen, [0], 'Writing leaves must be awakened');
    assert.equal(
      store.waiterCount(),
      0,
      'Must be removed after waking up (otherwise the timer and reference will remain)',
    );
    cancel(); // Idempotent: It has already been removed. If you cancel it, there should be no problem.
    assert.equal(store.waiterCount(), 0);
  });

  test('Writing pet leaves also wakes up (the waiting condition is "any write", regardless of section / pets)', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const store = new PollStateStore();
    const c = collector();
    store.wait({ since: store.read().counter, timeoutMs: 10_000, onWake: c.onWake });
    store.writePet('main', 'say', { text: 'x' });
    assert.deepEqual(c.seen, [0]);
  });

  test('The leaf has been written when waking up (read() in the callback must see the new value, not the old one)', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const store = new PollStateStore();
    let seenText: unknown = 'NOT_WOKEN';
    store.wait({
      since: store.read().counter,
      timeoutMs: 10_000,
      onWake: () => {
        seenText = (store.read().pets.main?.say?.data as { text?: unknown } | undefined)?.text;
      },
    });
    store.writePet('main', 'say', { text: '该喝水了' });
    assert.equal(
      seenText,
      '该喝水了',
      'Wake-up must occur after leaf assignment (if placed in next (), the old state will be read)',
    );
  });

  test('No writing → wake up when the point timeout is reached, and only wake up once', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const store = new PollStateStore();
    const c = collector();
    store.wait({ since: store.read().counter, timeoutMs: 1000, onWake: c.onWake });
    t.mock.timers.tick(999);
    assert.deepEqual(c.seen, [], 'You shouldn’t wake up before it’s time');
    t.mock.timers.tick(1);
    assert.deepEqual(c.seen, [0]);
    assert.equal(store.waiterCount(), 0);
    t.mock.timers.tick(10_000);
    assert.deepEqual(c.seen, [0], 'The timer cannot sound a second time after timeout.');
  });

  test('timeout =0 → wake up on next tick (equivalent to "return immediately", route does not require special judgment)', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const store = new PollStateStore();
    const c = collector();
    store.wait({ since: store.read().counter, timeoutMs: 0, onWake: c.onWake });
    assert.deepEqual(c.seen, [], 'callback should not be synchronized when registering');
    t.mock.timers.tick(1);
    assert.deepEqual(c.seen, [0]);
  });

  test('Cancel → Take it off and no longer wake up (if the caller is disconnected, go this way)', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const store = new PollStateStore();
    const c = collector();
    const cancel = store.wait({ since: store.read().counter, timeoutMs: 1000, onWake: c.onWake });
    cancel();
    assert.equal(store.waiterCount(), 0);
    t.mock.timers.tick(10_000);
    assert.deepEqual(c.seen, [], 'The timer must be cleared after cancellation and cannot be called back again.');
  });

  test('since is already the latest (no one writes it) → will not be woken up by idling during suspend', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const store = new PollStateStore();
    const c = collector();
    store.writeSection('balance', 1);
    store.wait({ since: store.read().counter, timeoutMs: 10_000, onWake: c.onWake });
    // Writing the same value again counts as writing (counter changes), so you must actually write here to wake up.
    store.writeSection('balance', 1);
    assert.deepEqual(
      c.seen,
      [0],
      'A change in counter is a change, and it has nothing to do with whether data is the same.',
    );
  });

  test('cancelAll (plugin unmount path) → wake up all and clear', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const store = new PollStateStore();
    const a = collector();
    const b = collector();
    store.wait({ since: 0, timeoutMs: 10_000, onWake: a.onWake });
    store.wait({ since: 0, timeoutMs: 10_000, onWake: b.onWake });
    assert.equal(store.waiterCount(), 2);
    store.cancelAll();
    assert.deepEqual([a.seen.length, b.seen.length], [1, 1]);
    assert.equal(store.waiterCount(), 0);
    t.mock.timers.tick(10_000);
    assert.deepEqual([a.seen.length, b.seen.length], [1, 1], 'The timer cannot sound again after cancelAll');
  });

  test('One write wakes up **all** waiters (global counter = wakes up everyone, intentional)', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const store = new PollStateStore();
    const a = collector();
    const b = collector();
    store.wait({ since: 0, timeoutMs: 10_000, onWake: a.onWake });
    store.wait({ since: 0, timeoutMs: 10_000, onWake: b.onWake });
    store.writeSection('notify', { x: 1 });
    assert.deepEqual([a.seen.length, b.seen.length], [1, 1], 'Both those who are waiting should wake up');
    assert.equal(store.waiterCount(), 0, 'No leakage');
  });
});
