/**
 * Pure logic layer single test of playback receipt (`/dsh-pet-7340/playback/...`).
 *
 * The three core clauses of the contract must be nailed down: ① The final state cannot be changed - the late ended is
 * not allowed to overwrite cancelled. The renderer's reporting is asynchronous: the interrupted scene is likely to
 * receive another ended during the reporting process, and the order cannot be guaranteed. ② Reporting is idempotent -
 * repeated reporting of the same state, and reporting after the final state will return ignored, and the record will
 * not be changed. ③ The waiter does not leak - the four paths of timeout, active cancellation, record cleaning, and
 * plugin unmount must be cleanup. The pending HTTP response does not have a second cleanup path, and the missing one
 * is a request that never ends.
 *
 * Use Node to build test runner (node:test) without introducing any npm dependencies. Time: sweep is controlled by
 * injected now (not mock by Date); wait timeout is controlled by mock by timers by setTimeout.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  isPlaybackStatus,
  isReportableStatus,
  isTerminalStatus,
  MAX_PLAYBACK_WAIT_MS,
  parsePlaybackPath,
  parseWaitQuery,
  PLAYBACK_KEEP_MS,
  PlaybackStore,
  type PlaybackRecord,
} from './playback.ts';

/** Collect the conclusion of a wait (the same waiter is awakened twice, which is bug, and the following assertion will directly see it) */
function collector(): {
  seen: Array<{ status: string; matched: boolean }>;
  onWake: (r: PlaybackRecord, m: boolean) => void;
} {
  const seen: Array<{ status: string; matched: boolean }> = [];
  return {
    seen,
    onWake: (r, matched) => seen.push({ status: r.status, matched }),
  };
}

describe('playback ——Status determination assistance', () => {
  test('The final state is only ended / failed / cancelled', () => {
    assert.equal(isTerminalStatus('ended'), true);
    assert.equal(isTerminalStatus('failed'), true);
    assert.equal(isTerminalStatus('cancelled'), true);
    assert.equal(isTerminalStatus('accepted'), false);
    assert.equal(isTerminalStatus('playing'), false);
    assert.equal(isTerminalStatus('随便写的'), false);
  });

  test('The valid status name contains accepted, but accepted is not allowed to be reported by the renderer', () => {
    assert.equal(isPlaybackStatus('accepted'), true);
    assert.equal(isPlaybackStatus('playing'), true);
    assert.equal(isPlaybackStatus('finished'), false);
    assert.equal(
      isReportableStatus('accepted'),
      false,
      'accepted is the acceptance state of host, renderer is not allowed to write',
    );
    assert.equal(isReportableStatus('playing'), true);
    assert.equal(isReportableStatus('cancelled'), true);
  });
});

describe('playback - Path and query parameter analysis (pure function, route is just glue)', () => {
  test('parsePlaybackPath: Only recognizes two shapes, regular anchoring at both ends', () => {
    assert.deepEqual(parsePlaybackPath('playback/pb-x'), { playbackId: 'pb-x', isReport: false });
    assert.deepEqual(parsePlaybackPath('playback/pb-x/report'), { playbackId: 'pb-x', isReport: true });
    // All other shapes will be ignored - hand it over to the downstream thumb/font/pic branch to report errors according to their respective conventions, never "try your best to guess a id"
    for (const bad of [
      'playback',
      'playback/',
      'playback/a/b',
      'playback/a/report/extra',
      'playbackx/a',
      'playbacks/a',
      'anim',
      'state',
      '',
    ]) {
      assert.equal(parsePlaybackPath(bad), undefined, `${bad} should not be claimed by / playback`);
    }
  });

  test('parseWaitQuery: wait and timeout are required in pairs', () => {
    assert.deepEqual(parseWaitQuery(null, null), { kind: 'none' });
    const onlyWait = parseWaitQuery('ended', null);
    assert.equal(onlyWait.kind, 'error', 'Only filling in wait will hang indefinitely and must be rejected.');
    assert.match(onlyWait.kind === 'error' ? onlyWait.error : '', /together/);
    assert.equal(
      parseWaitQuery(null, '1000').kind,
      'error',
      'Just filling in timeout means you didn’t say what to wait for.',
    );
  });

  test('parseWaitQuery: wait supports comma list (there are three final states)', () => {
    assert.deepEqual(parseWaitQuery('ended', '1000'), { kind: 'ok', wait: ['ended'], timeoutMs: 1000 });
    assert.deepEqual(parseWaitQuery('ended,failed,cancelled', '1000'), {
      kind: 'ok',
      wait: ['ended', 'failed', 'cancelled'],
      timeoutMs: 1000,
    });
    // White space and extra commas are tolerated (empty items are discarded without affecting the rest)
    assert.deepEqual(parseWaitQuery(' ended , failed ,', '1000'), {
      kind: 'ok',
      wait: ['ended', 'failed'],
      timeoutMs: 1000,
    });
  });

  test('parseWaitQuery: Invalid status name is explicitly rejected and not silently ignored.', () => {
    const bad = parseWaitQuery('finished', '1000');
    assert.equal(bad.kind, 'error');
    assert.match(bad.kind === 'error' ? bad.error : '', /finished/);
    assert.equal(
      parseWaitQuery('ended,fake', '1000').kind,
      'error',
      'If the name is mixed with an illegal name, it will be rejected as a whole.',
    );
    assert.equal(parseWaitQuery('', '1000').kind, 'error', 'Empty wait means it didn’t say what to wait for.');
    assert.equal(parseWaitQuery(' , ', '1000').kind, 'error');
  });

  test('parseWaitQuery: timeout only accepts integers with an upper limit of 0..', () => {
    assert.deepEqual(parseWaitQuery('ended', '0'), { kind: 'ok', wait: ['ended'], timeoutMs: 0 });
    assert.equal(parseWaitQuery('ended', String(MAX_PLAYBACK_WAIT_MS)).kind, 'ok');
    for (const bad of ['-1', '1.5', 'abc', '', ' ', '1e3', '+5', String(MAX_PLAYBACK_WAIT_MS + 1)]) {
      assert.equal(parseWaitQuery('ended', bad).kind, 'error', `timeout = ${bad} should be rejected`);
    }
  });
});

describe('playback——Acceptance and number', () => {
  test('create returns accepted record with all fields', () => {
    const store = new PlaybackStore();
    const rec = store.create('main', '拉侧栏-拉拽');
    assert.equal(rec.petId, 'main');
    assert.equal(rec.name, '拉侧栏-拉拽');
    assert.equal(rec.status, 'accepted');
    assert.ok(rec.playbackId.length > 0);
    assert.equal(typeof rec.createdAt, 'number');
    assert.equal(rec.createdAt, rec.updatedAt);
    assert.equal(store.get(rec.playbackId), rec);
  });

  test('The number is unique within the operation (it is repeated multiple times without repeating)', () => {
    const store = new PlaybackStore();
    const ids = new Set<string>();
    for (let i = 0; i < 50; i++) ids.add(store.create('pet-' + i, 'A').playbackId);
    assert.equal(ids.size, 50);
  });

  test('The number that cannot be found returns undefined (route returns 404 accordingly)', () => {
    const store = new PlaybackStore();
    assert.equal(store.get('pb-nope'), undefined);
  });
});

describe('playback ——State machine and reporting', () => {
  test('accepted → playing → ended gradually advance', () => {
    const store = new PlaybackStore();
    const rec = store.create('main', 'A');
    assert.equal(store.report(rec.playbackId, 'playing'), 'ok');
    assert.equal(store.get(rec.playbackId)?.status, 'playing');
    assert.equal(store.report(rec.playbackId, 'ended'), 'ok');
    const done = store.get(rec.playbackId);
    assert.equal(done?.status, 'ended');
    assert.equal(typeof done?.endedAt, 'number', 'ended must bring endedAt');
  });

  test('failed with reason', () => {
    const store = new PlaybackStore();
    const rec = store.create('main', 'A');
    assert.equal(store.report(rec.playbackId, 'failed', 'asset-not-found'), 'ok');
    const hit = store.get(rec.playbackId);
    assert.equal(hit?.status, 'failed');
    assert.equal(hit?.reason, 'asset-not-found');
    assert.equal(hit?.endedAt, undefined, 'endedAt only belongs to ended');
  });

  test('**The final state cannot be changed**: playing after ended is ignored', () => {
    const store = new PlaybackStore();
    const rec = store.create('main', 'A');
    store.report(rec.playbackId, 'ended');
    assert.equal(store.report(rec.playbackId, 'playing'), 'ignored');
    assert.equal(
      store.get(rec.playbackId)?.status,
      'ended',
      'Late reports are not allowed to change the final state back.',
    );
  });

  test('**The final state cannot be changed**: ended after cancelled is ignored (the interrupted scene)', () => {
    const store = new PlaybackStore();
    const first = store.create('main', 'A');
    store.create('main', 'B'); // Top the first game → cancelled/superseded
    assert.equal(store.get(first.playbackId)?.status, 'cancelled');
    assert.equal(store.report(first.playbackId, 'ended'), 'ignored');
    assert.equal(store.get(first.playbackId)?.status, 'cancelled');
    assert.equal(store.get(first.playbackId)?.reason, 'superseded');
  });

  test('Idempotent: Repeated reports of the same status are ignored', () => {
    const store = new PlaybackStore();
    const rec = store.create('main', 'A');
    assert.equal(store.report(rec.playbackId, 'playing'), 'ok');
    assert.equal(store.report(rec.playbackId, 'playing'), 'ignored');
    assert.equal(store.get(rec.playbackId)?.status, 'playing');
  });

  test('Unknown number → unknown; Invalid status name → invalid', () => {
    const store = new PlaybackStore();
    const rec = store.create('main', 'A');
    assert.equal(store.report('pb-nope', 'playing'), 'unknown');
    assert.equal(store.report(rec.playbackId, 'finished'), 'invalid');
    assert.equal(
      store.report(rec.playbackId, 'accepted'),
      'invalid',
      'renderer is not allowed to write acceptance status',
    );
    assert.equal(store.report(rec.playbackId, ''), 'invalid');
    assert.equal(store.report(rec.playbackId, undefined), 'invalid');
    assert.equal(store.report(rec.playbackId, 42), 'invalid');
    assert.equal(
      store.get(rec.playbackId)?.status,
      'accepted',
      'Illegal reporting is not allowed to change the record',
    );
  });
});

describe('playback - New playback request overrides the old field (pets.< id>. anim is a single leaf)', () => {
  test('New playback request for the same pet marks the previous play as cancelled/superseded', () => {
    const store = new PlaybackStore();
    const first = store.create('main', 'A');
    const second = store.create('main', 'B');
    assert.equal(store.get(first.playbackId)?.status, 'cancelled');
    assert.equal(store.get(first.playbackId)?.reason, 'superseded');
    assert.equal(store.get(second.playbackId)?.status, 'accepted');
  });

  test('Different pets do not affect each other', () => {
    const store = new PlaybackStore();
    const a = store.create('main', 'A');
    const b = store.create('other', 'B');
    assert.equal(store.get(a.playbackId)?.status, 'accepted');
    assert.equal(store.get(b.playbackId)?.status, 'accepted');
  });

  test('The final scene will not be marked again by subsequent playback requests.', () => {
    const store = new PlaybackStore();
    const first = store.create('main', 'A');
    store.report(first.playbackId, 'ended');
    store.create('main', 'B');
    const hit = store.get(first.playbackId);
    assert.equal(hit?.status, 'ended', 'Normally played content cannot be rewritten as cancelled');
    assert.equal(hit?.reason, undefined);
  });
});

describe('playback - Waiter: wake-up and timeout', () => {
  test('The state enters the wait set → wake up immediately (matched = true) and remove the waiter', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const store = new PlaybackStore();
    const rec = store.create('main', 'A');
    const c = collector();
    const cancel = store.wait({
      playbackId: rec.playbackId,
      wait: ['playing', 'ended'],
      timeoutMs: 10_000,
      onWake: c.onWake,
    });
    assert.ok(cancel, 'Number exists → should register successfully');
    assert.equal(store.waiterCount(), 1);
    store.report(rec.playbackId, 'playing');
    assert.deepEqual(c.seen, [{ status: 'playing', matched: true }]);
    assert.equal(
      store.waiterCount(),
      0,
      'Must be removed after waking up (otherwise the timer and reference will remain)',
    );
  });

  test('Status changes not in the wait set do not wake up', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const store = new PlaybackStore();
    const rec = store.create('main', 'A');
    const c = collector();
    store.wait({ playbackId: rec.playbackId, wait: ['ended'], timeoutMs: 10_000, onWake: c.onWake });
    store.report(rec.playbackId, 'playing');
    assert.deepEqual(c.seen, [], 'Just wait for ended, playing should not wake up');
    assert.equal(store.waiterCount(), 1, 'It continues to hang before waiting.');
    store.report(rec.playbackId, 'ended');
    assert.deepEqual(c.seen, [{ status: 'ended', matched: true }]);
  });

  test('wait supports comma list semantics: any hit will return (there are three final states)', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const store = new PlaybackStore();
    const rec = store.create('main', 'A');
    const c = collector();
    store.wait({
      playbackId: rec.playbackId,
      wait: ['ended', 'failed', 'cancelled'],
      timeoutMs: 10_000,
      onWake: c.onWake,
    });
    store.report(rec.playbackId, 'failed', 'decode-error');
    assert.deepEqual(
      c.seen,
      [{ status: 'failed', matched: true }],
      'Failure is also the final state, you can’t wait in vain timeout',
    );
  });

  test('Timeout → matched = false, return to the current state', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const store = new PlaybackStore();
    const rec = store.create('main', 'A');
    const c = collector();
    store.wait({ playbackId: rec.playbackId, wait: ['ended'], timeoutMs: 500, onWake: c.onWake });
    store.report(rec.playbackId, 'playing');
    t.mock.timers.tick(499);
    assert.deepEqual(c.seen, [], 'Does not wake up before arrival time');
    t.mock.timers.tick(1);
    assert.deepEqual(c.seen, [{ status: 'playing', matched: false }]);
    assert.equal(store.waiterCount(), 0, 'Must be removed after timeout');
  });

  test('timeout =0 → wake up immediately next tick (equivalent to "return immediately")', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const store = new PlaybackStore();
    const rec = store.create('main', 'A');
    const c = collector();
    store.wait({ playbackId: rec.playbackId, wait: ['ended'], timeoutMs: 0, onWake: c.onWake });
    assert.deepEqual(
      c.seen,
      [],
      'Asynchronous wake-up when registering (avoiding reentrancy in the Promise structure)',
    );
    t.mock.timers.tick(1);
    assert.deepEqual(c.seen, [{ status: 'accepted', matched: false }]);
  });

  test('Unknown number → return undefined (route will immediately respond to 404 accordingly, without hanging)', () => {
    const store = new PlaybackStore();
    const c = collector();
    assert.equal(store.wait({ playbackId: 'pb-nope', wait: ['ended'], timeoutMs: 1000, onWake: c.onWake }), undefined);
    assert.equal(store.waiterCount(), 0);
  });

  test('Active cancellation → no longer wake up, no timer left', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const store = new PlaybackStore();
    const rec = store.create('main', 'A');
    const c = collector();
    const cancel = store.wait({ playbackId: rec.playbackId, wait: ['ended'], timeoutMs: 5000, onWake: c.onWake });
    assert.ok(cancel);
    cancel();
    assert.equal(store.waiterCount(), 0);
    store.report(rec.playbackId, 'ended');
    assert.deepEqual(c.seen, [], 'Status changes after cancellation should not wake up again');
    t.mock.timers.tick(5000);
    assert.deepEqual(c.seen, [], 'The timer should not wake up again after cancellation.');
  });

  test('Multiple waiters in the same field are awakened at the same time', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const store = new PlaybackStore();
    const rec = store.create('main', 'A');
    const a = collector();
    const b = collector();
    store.wait({ playbackId: rec.playbackId, wait: ['ended'], timeoutMs: 5000, onWake: a.onWake });
    store.wait({ playbackId: rec.playbackId, wait: ['ended', 'failed'], timeoutMs: 5000, onWake: b.onWake });
    assert.equal(store.waiterCount(), 2);
    store.report(rec.playbackId, 'ended');
    assert.deepEqual(a.seen, [{ status: 'ended', matched: true }]);
    assert.deepEqual(b.seen, [{ status: 'ended', matched: true }]);
    assert.equal(store.waiterCount(), 0);
  });

  test('Waiting does not affect the record itself, nor does it block other writes due to waiting.', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const store = new PlaybackStore();
    const rec = store.create('main', 'A');
    const c = collector();
    store.wait({ playbackId: rec.playbackId, wait: ['ended'], timeoutMs: 5000, onWake: c.onWake });
    assert.equal(
      store.report(rec.playbackId, 'playing'),
      'ok',
      'If someone is waiting, this will not hinder reporting.',
    );
    assert.equal(store.count(), 1);
  });
});

describe('playback - Cleanup (retain window and four cleanup paths)', () => {
  test('Final state records are cleared after exceeding the retention window; non-final states are not affected', () => {
    const store = new PlaybackStore();
    const done = store.create('main', 'A');
    store.report(done.playbackId, 'ended');
    const live = store.create('other', 'B'); // Another pet: It will not be pushed out, and it is not the final state.
    assert.equal(store.count(), 2);
    store.sweep(done.updatedAt + PLAYBACK_KEEP_MS - 1);
    assert.equal(store.count(), 2, 'Not yet reached: not sure yet');
    store.sweep(done.updatedAt + PLAYBACK_KEEP_MS);
    assert.equal(
      store.get(done.playbackId),
      undefined,
      'Arrival: the final state record is cleared (query later returns 404)',
    );
    assert.ok(store.get(live.playbackId), 'Non-final records are never cleared due to retention windows');
  });

  test('The record is cleared during the wait → the waiter is awakened (matched = false), leaving no hanging', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const store = new PlaybackStore();
    const rec = store.create('main', 'A');
    store.report(rec.playbackId, 'ended');
    const c = collector();
    // Deliberately wait for a state that is no longer possible, and set the timeout to be longer than the retention
    // window - this is exactly the form of "register at the end of the retention window": only sweep can cleanup it.
    const cancel = store.wait({
      playbackId: rec.playbackId,
      wait: ['playing'],
      timeoutMs: PLAYBACK_KEEP_MS * 2,
      onWake: c.onWake,
    });
    assert.ok(cancel);
    assert.equal(store.waiterCount(), 1);
    store.sweep(rec.updatedAt + PLAYBACK_KEEP_MS);
    assert.deepEqual(c.seen, [{ status: 'ended', matched: false }], 'Waiters must be woken up before cleaning');
    assert.equal(store.waiterCount(), 0, 'Don’t leave people waiting who will never wait.');
    assert.equal(store.count(), 0);
  });

  test('cancelAll (plugin unmount path) → wake up all and clear', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const store = new PlaybackStore();
    const a = store.create('main', 'A');
    const b = store.create('other', 'B');
    const ca = collector();
    const cb = collector();
    store.wait({ playbackId: a.playbackId, wait: ['ended'], timeoutMs: 10_000, onWake: ca.onWake });
    store.wait({ playbackId: b.playbackId, wait: ['ended'], timeoutMs: 10_000, onWake: cb.onWake });
    assert.equal(store.waiterCount(), 2);
    store.cancelAll();
    assert.deepEqual(ca.seen, [{ status: 'accepted', matched: false }]);
    assert.deepEqual(cb.seen, [{ status: 'accepted', matched: false }]);
    assert.equal(store.waiterCount(), 0);
    // After unmounting, it should not be awakened by subsequent reports.
    store.report(a.playbackId, 'ended');
    assert.deepEqual(ca.seen, [{ status: 'accepted', matched: false }]);
  });

  test('The timer will no longer wake up repeatedly after cancelAll', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const store = new PlaybackStore();
    const rec = store.create('main', 'A');
    const c = collector();
    store.wait({ playbackId: rec.playbackId, wait: ['ended'], timeoutMs: 3000, onWake: c.onWake });
    store.cancelAll();
    t.mock.timers.tick(3000);
    assert.equal(c.seen.length, 1, 'The timeout timer must have been cleared and cannot be woken up again.');
  });
});
