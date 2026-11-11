/**
 * Occupying lock (issue #122 item 4) unit test - verify truth table, tombstone and "separate according to the number
 * when there is no lock".
 *
 * Why nail these separately: The lock is the only thing that will refuse other people's calls (the five action
 * endpoints during the occupation period must carry lockId). Once it is wrongly judged, it will be "the third-party
 * linkage is rejected halfway through" or "the pet is locked and no one can move it." And its boundaries are all in
 * time (expiration, renewal, preemption), so a fake clock is injected here - there is no need to really wait for 30
 * seconds for expiration semantics.
 *
 * Four conventions to be nailed: ① No lock + no number → release (no need to change a word of the existing caller); no
 * lock + number → `lock-lost` (the old lease cannot continue to execute late requests); ② "With id + currently no
 * lock" will always report an error and will not be revived (otherwise "I lost the lock" will be quietly erased); ③
 * The release is idempotent, but it is not allowed to misplace other people's locks (there is a lock but id does not
 * match → an error is reported); ④ cause can be distinguished (expired/released by oneself/snatched by the
 * user/unrecognized), relying on tombstones.
 *
 * Running method: node --experimental-strip-types --test src/host/lock.test.ts
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  LOCK_DEFAULT_TTL_MS,
  LOCK_MAX_TTL_MS,
  LOCK_MIN_TTL_MS,
  LockStore,
  normalizeLockTtl,
  type LockLeafData,
} from './lock.ts';

/** Fake clock + leaf callback record: expiration semantics depends entirely on it, and the test does not have to wait really */
function makeStore(): {
  store: LockStore;
  advance: (ms: number) => void;
  leaves: { petId: string; data: LockLeafData }[];
} {
  let now = 1_000_000;
  const leaves: { petId: string; data: LockLeafData }[] = [];
  const store = new LockStore({
    now: () => now,
    onChange: (petId, data) => leaves.push({ petId, data }),
  });
  return { store, advance: (ms) => (now += ms), leaves };
}

describe('LockStore - lock acquisition/renewal (two-in-one) truth table', () => {
  test('No lock + without lockId → Create new, return lockId / expiresAt, and write leaf { locked:true }', () => {
    const { store, leaves } = makeStore();
    const d = store.acquire({ petId: 'main' });
    assert.equal(d.ok, true);
    if (!d.ok) return;
    assert.equal(d.petId, 'main');
    assert.equal(d.renewed, false);
    assert.ok(d.lockId.length > 0);
    assert.equal(d.expiresAt, 1_000_000 + LOCK_DEFAULT_TTL_MS, 'The default TTL is 2 min');
    assert.deepEqual(leaves, [{ petId: 'main', data: { locked: true, expiresAt: d.expiresAt } }]);
  });

  test('The leaf ** does not contain lockId **: It is the certificate of the lock holder and cannot be put into the readable / state', () => {
    const { store, leaves } = makeStore();
    const d = store.acquire({ petId: 'main' });
    assert.equal(d.ok, true);
    if (!d.ok) return;
    const data = leaves[0].data as Record<string, unknown>;
    assert.deepEqual(Object.keys(data).sort(), ['expiresAt', 'locked']);
    assert.equal(JSON.stringify(data).includes(d.lockId), false);
  });

  test('With lock + without lockId → locked + expiresAt (let the other party know when to try again), do not build a second one', () => {
    const { store } = makeStore();
    const first = store.acquire({ petId: 'main' });
    assert.equal(first.ok, true);
    if (!first.ok) return;
    const second = store.acquire({ petId: 'main' });
    assert.equal(second.ok, false);
    if (second.ok || second.reason !== 'locked') throw new Error('应当是 locked');
    assert.equal(second.expiresAt, first.expiresAt);
    assert.equal(store.current('main')?.lockId, first.lockId, 'The original lock must be left intact');
  });

  test('Locked + consistent lockId → Renewal: No change, expiresAt postponed, renewed = true', () => {
    const { store, advance, leaves } = makeStore();
    const first = store.acquire({ petId: 'main', ttl: 10_000 });
    assert.equal(first.ok, true);
    if (!first.ok) return;
    advance(5_000);
    const again = store.acquire({ petId: 'main', lockId: first.lockId });
    assert.equal(again.ok, true);
    if (!again.ok) return;
    assert.equal(again.renewed, true);
    assert.equal(again.lockId, first.lockId, 'Renewal without changing number');
    assert.equal(again.expiresAt, 1_005_000 + 10_000, 'Renewal without ttl → Use the original one');
    assert.deepEqual(leaves[leaves.length - 1]?.data, { locked: true, expiresAt: again.expiresAt });
  });

  test('Locked + inconsistent lockId → lock-lost / unknown (cannot recognize this number)', () => {
    const { store } = makeStore();
    store.acquire({ petId: 'main' });
    const d = store.acquire({ petId: 'main', lockId: 'lk-nope' });
    assert.equal(d.ok, false);
    if (d.ok || d.reason !== 'lock-lost') throw new Error('应当是 lock-lost');
    assert.equal(d.cause, 'unknown');
  });

  test('No lock + with lockId → lock-lost / unknown (never had this lock), **no resurrection**', () => {
    const { store } = makeStore();
    const d = store.acquire({ petId: 'main', lockId: 'lk-ghost' });
    assert.equal(d.ok, false);
    if (d.ok || d.reason !== 'lock-lost') throw new Error('应当是 lock-lost');
    assert.equal(d.cause, 'unknown');
    assert.equal(store.current('main'), null, 'It is not allowed to renew the lock by renewing it.');
  });

  test('Renew with the old number after expiration → lock-lost / expired (no resurrection), and new locks can be created normally', () => {
    const { store, advance, leaves } = makeStore();
    const first = store.acquire({ petId: 'main', ttl: 1_000 });
    assert.equal(first.ok, true);
    if (!first.ok) return;
    advance(1_000);
    const late = store.acquire({ petId: 'main', lockId: first.lockId });
    assert.equal(late.ok, false);
    if (late.ok || late.reason !== 'lock-lost') throw new Error('应当是 lock-lost');
    assert.equal(late.cause, 'expired');
    // The leaf was synchronized once when it expired (there is no timer on the host side, this is the only place outside the renderer that "write S to the point")
    assert.deepEqual(leaves[leaves.length - 1], { petId: 'main', data: { locked: false } });
    const fresh = store.acquire({ petId: 'main' });
    assert.equal(fresh.ok, true);
    if (!fresh.ok) return;
    assert.notEqual(fresh.lockId, first.lockId);
  });

  test('Expiration is a **lazy judgment**: current will not return it when no one accesses it, and the leaf will only be rewritten once', () => {
    const { store, advance, leaves } = makeStore();
    store.acquire({ petId: 'main', ttl: 1_000 });
    advance(2_000);
    assert.equal(store.current('main'), null);
    assert.equal(store.locked('main'), false);
    const written = leaves.length;
    assert.equal(store.current('main'), null);
    assert.equal(leaves.length, written, 'You should not write the leaves again after reading it for the second time.');
  });

  test('After the new lock is established, the old tombstone is invalid: the old number is unknown from now on (not expired in the previous round)', () => {
    const { store, advance } = makeStore();
    const first = store.acquire({ petId: 'main', ttl: 1_000 });
    assert.equal(first.ok, true);
    if (!first.ok) return;
    advance(1_000);
    store.acquire({ petId: 'main' }); // Create new lock
    const d = store.acquire({ petId: 'main', lockId: first.lockId });
    assert.equal(d.ok, false);
    if (d.ok || d.reason !== 'lock-lost') throw new Error('应当是 lock-lost');
    assert.equal(d.cause, 'unknown');
  });
});

describe('LockStore —— ttl verification', () => {
  test('Default / null → 2 min; Boundary value is valid', () => {
    assert.equal(normalizeLockTtl(undefined, LOCK_DEFAULT_TTL_MS), LOCK_DEFAULT_TTL_MS);
    assert.equal(normalizeLockTtl(null, LOCK_DEFAULT_TTL_MS), LOCK_DEFAULT_TTL_MS);
    assert.equal(normalizeLockTtl(LOCK_MIN_TTL_MS, 0), LOCK_MIN_TTL_MS);
    assert.equal(normalizeLockTtl(LOCK_MAX_TTL_MS, 0), LOCK_MAX_TTL_MS);
    assert.equal(
      normalizeLockTtl(1_234.5, 0),
      1_234.5,
      'Fractional milliseconds are harmless, accept them as they are',
    );
  });

  test('Invalid → null (out of bounds, no clamping: caller should know immediately if the wrong duration is written)', () => {
    for (const bad of [0, -1, LOCK_MIN_TTL_MS - 1, LOCK_MAX_TTL_MS + 1, NaN, Infinity, '30000', {}, []]) {
      assert.equal(normalizeLockTtl(bad, LOCK_DEFAULT_TTL_MS), null, `${String(bad)} should be illegal`);
    }
  });

  test('ttl invalid → bad-request, and **no lock**', () => {
    const { store } = makeStore();
    const d = store.acquire({ petId: 'main', ttl: 0 });
    assert.equal(d.ok, false);
    if (d.ok || d.reason !== 'bad-request') throw new Error('应当是 bad-request');
    assert.equal(store.current('main'), null);
  });

  test('lockId is not a character string → bad-request (instead of creating a new one as "not given")', () => {
    const { store } = makeStore();
    const d = store.acquire({ petId: 'main', lockId: 123 });
    assert.equal(d.ok, false);
    if (d.ok || d.reason !== 'bad-request') throw new Error('应当是 bad-request');
    assert.equal(store.current('main'), null);
  });
});

describe('LockStore - Release', () => {
  test('lockId matches → unlock, write leaf { locked:false }, then the old number is released', () => {
    const { store, leaves } = makeStore();
    const d = store.acquire({ petId: 'main' });
    assert.equal(d.ok, true);
    if (!d.ok) return;
    const r = store.release({ petId: 'main', lockId: d.lockId });
    assert.deepEqual(r, { ok: true, petId: 'main', released: true });
    assert.deepEqual(leaves[leaves.length - 1], { petId: 'main', data: { locked: false } });
    const again = store.acquire({ petId: 'main', lockId: d.lockId });
    assert.equal(again.ok, false);
    if (again.ok || again.reason !== 'lock-lost') throw new Error('应当是 lock-lost');
    assert.equal(again.cause, 'released');
  });

  test('Release when no lock → idempotent ok (released:false), do not write leaves', () => {
    const { store, leaves } = makeStore();
    assert.deepEqual(store.release({ petId: 'main', lockId: 'lk-any' }), {
      ok: true,
      petId: 'main',
      released: false,
    });
    assert.deepEqual(leaves, []);
  });

  test("There is a lock but lockId does not match → lock-lost, **Never misplace someone else's lock**", () => {
    const { store } = makeStore();
    const d = store.acquire({ petId: 'main' });
    assert.equal(d.ok, true);
    if (!d.ok) return;
    const r = store.release({ petId: 'main', lockId: 'lk-someone-else' });
    assert.equal(r.ok, false);
    if (r.ok || r.reason !== 'lock-lost') throw new Error('应当是 lock-lost');
    assert.equal(r.cause, 'unknown');
    assert.equal(store.current('main')?.lockId, d.lockId, 'The lock must still be there');
  });

  test('force:true → Unconditionally unlock, cause = preempted (user takes over)', () => {
    const { store, leaves } = makeStore();
    const d = store.acquire({ petId: 'main' });
    assert.equal(d.ok, true);
    if (!d.ok) return;
    assert.deepEqual(store.release({ petId: 'main', force: true }), { ok: true, petId: 'main', released: true });
    assert.deepEqual(leaves[leaves.length - 1], { petId: 'main', data: { locked: false } });
    const late = store.acquire({ petId: 'main', lockId: d.lockId });
    assert.equal(late.ok, false);
    if (late.ok || late.reason !== 'lock-lost') throw new Error('应当是 lock-lost');
    assert.equal(
      late.cause,
      'preempted',
      'The lock holder must be able to distinguish between "those I put in myself" and "those snatched away by the user"',
    );
  });

  test('force only recognizes strict true: the character string "true" does not count (relaxed will take the misinformation seriously, at the cost of removing other people\'s locks)', () => {
    const { store } = makeStore();
    store.acquire({ petId: 'main' });
    const r = store.release({ petId: 'main', force: 'true' });
    assert.equal(r.ok, false);
    if (r.ok || r.reason !== 'bad-request') throw new Error('应当是 bad-request');
    assert.notEqual(store.current('main'), null);
  });

  test('lockId and force will be given together/neither will be given → bad-request (unknown intention, no guessing for the caller)', () => {
    const { store } = makeStore();
    store.acquire({ petId: 'main' });
    for (const args of [{ lockId: 'lk-x', force: true }, {}]) {
      const r = store.release({ petId: 'main', ...args });
      assert.equal(r.ok, false);
      if (r.ok || r.reason !== 'bad-request') throw new Error('应当是 bad-request');
    }
    assert.notEqual(store.current('main'), null);
  });

  test('force releases an unoccupied pet → idempotent ok', () => {
    const { store } = makeStore();
    assert.deepEqual(store.release({ petId: 'main', force: true }), { ok: true, petId: 'main', released: false });
  });

  test('releaseAll (plugin unmount path) → Remove all and write each leaf once', () => {
    const { store, leaves } = makeStore();
    store.acquire({ petId: 'main' });
    store.acquire({ petId: 'pet-2' });
    leaves.length = 0;
    store.releaseAll();
    assert.equal(store.anyLocked(), false);
    assert.deepEqual(leaves, [
      { petId: 'main', data: { locked: false } },
      { petId: 'pet-2', data: { locked: false } },
    ]);
  });
});

describe('LockStore - Validation check of action endpoint (gate)', () => {
  test('No lock + no number → Release (no need to change a word of the existing caller)', () => {
    const { store } = makeStore();
    assert.deepEqual(store.gate('main', ''), { ok: true });
  });

  test('No lock + numbered → lock-lost (old lease cannot continue to execute late requests)', () => {
    const { store } = makeStore();
    const g = store.gate('main', 'lk-随便传的');
    assert.equal(g.ok, false);
    if (g.ok || g.reason !== 'lock-lost') throw new Error('应当是 lock-lost');
    assert.equal(g.cause, 'unknown', 'Never built a lock → unknown');
  });

  test('With lock + Without belt → lock-required', () => {
    const { store } = makeStore();
    store.acquire({ petId: 'main' });
    const g = store.gate('main', '');
    assert.equal(g.ok, false);
    if (g.ok || g.reason !== 'lock-required') throw new Error('应当是 lock-required');
  });

  test('Locked + brought correctly → released (the lock holder’s performance will not be affected)', () => {
    const { store } = makeStore();
    const d = store.acquire({ petId: 'main' });
    assert.equal(d.ok, true);
    if (!d.ok) return;
    assert.deepEqual(store.gate('main', d.lockId), { ok: true });
  });

  test('Locked + Wrong item → lock-lost / unknown', () => {
    const { store } = makeStore();
    store.acquire({ petId: 'main' });
    const g = store.gate('main', 'lk-wrong');
    assert.equal(g.ok, false);
    if (g.ok || g.reason !== 'lock-lost') throw new Error('应当是 lock-lost');
    assert.equal(g.cause, 'unknown');
  });

  test('After the lock expires: Release without number, with old number → lock-lost / expired', () => {
    const { store, advance } = makeStore();
    const d = store.acquire({ petId: 'main', ttl: 1_000 });
    advance(1_000);
    assert.deepEqual(store.gate('main', ''), { ok: true });
    if (!d.ok) return;
    const g = store.gate('main', d.lockId);
    assert.equal(g.ok, false);
    if (g.ok || g.reason !== 'lock-lost') throw new Error('应当是 lock-lost');
    assert.equal(g.cause, 'expired', 'The tombstone records why it disappeared');
  });

  test('Locks are separated by pets: occupying main does not affect pet-2', () => {
    const { store } = makeStore();
    store.acquire({ petId: 'main' });
    assert.equal(store.gate('main', '').ok, false);
    assert.deepEqual(store.gate('pet-2', ''), { ok: true });
    assert.equal(store.anyLocked(), true);
  });
});

describe('LockStore —— Third parties do not preempt each other', () => {
  test('First come first served: When A is locked, B can only get locked + expiresAt, but cannot topple A', () => {
    const { store } = makeStore();
    const a = store.acquire({ petId: 'main' });
    assert.equal(a.ok, true);
    if (!a.ok) return;
    const b = store.acquire({ petId: 'main' });
    assert.equal(b.ok, false);
    if (b.ok || b.reason !== 'locked') throw new Error('应当是 locked');
    assert.equal(b.expiresAt, a.expiresAt);
    assert.deepEqual(store.gate('main', a.lockId), { ok: true }, 'The lock of A is not affected');
  });
});
