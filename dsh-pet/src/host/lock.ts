/**
 * Pet occupation lock (memory exclusive lock of host side): The third party will exclusively occupy this pet to itself
 * during linkage.
 *
 * Responsible for lock creation/renewal/release, lazy expiration, tombstone and leaf synchronization; all in one, one
 * lock corresponds to one pet. Not responsible for renderer freezing: expiresAt in the leaves is the only truth, and
 * the front end will unfreeze it accordingly. The judgment must be able to be separated from the HTTP single test, so
 * the judgment is all here, and the route only does analysis and response. The clock and leaves of dependency
 * injection are written into callback (if callback is not passed, it is pure logic and S is not touched). Always true:
 * lock is not passed = zero change in the status quo; the number is passed but the lock cannot be found and must be
 * returned to lock-lost; only the user can preempt it. See contracts API.md and openapi.yaml.
 *
 * @module dsh-pet/src/host/lock
 */

/**
 * Occupation duration and upper and lower limits (milliseconds).
 *
 * Default 2 min: A linked performance usually lasts from tens of seconds to one or two minutes. Even if the caller is
 * not renewed or misses a beat, the lock will not be lost midway - if it is lost, it will be unfrozen on the spot,
 * which is difficult to check. The upper limit is 30 min: enough for "a series of actions + the user clicks on the
 * sidebar in the middle". Longer performances should be extended, rather than relying on a huge TTL to occupy the pet.
 */
export const LOCK_DEFAULT_TTL_MS = 2 * 60 * 1000;
export const LOCK_MIN_TTL_MS = 1 * 1000;
export const LOCK_MAX_TTL_MS = 30 * 60 * 1000;

/**
 * Why is the lock lost? The lock holder decides to reacquire or cleanup based on this (for value semantics, see
 * lock-lost `cause` of openapi.yaml). `preempted` means it has been snatched away by the user (drag/click/hide/close).
 * The linkage must be cleanup immediately. Do not snatch it from the user.
 */
export type LockCause = 'expired' | 'released' | 'preempted' | 'unknown';

/** cause → A sentence read by others (message in the receipt; reason is the one read by the machine). */
const CAUSE_TEXT: Record<LockCause, string> = {
  expired: '占用已过期（没有及时续期）',
  released: '占用已被释放',
  preempted: '占用已被用户接管（拖拽/点击/隐藏/关闭）',
  unknown: 'lock 不是当前生效的占用编号',
};

/** Payload written to `pets.<id>.lock` (renderer freezes/thaws accordingly). */
export type LockLeafData = { locked: true; expiresAt: number } | { locked: false };

/** An occupation record (memory state). */
interface LockRecord {
  /** Opaque number (`lk-<time36>-<sequence36>`), the lock holder must bring it in all subsequent operations. */
  lockId: string;
  /** The duration of this round: it will be used when renewing without ttl. */
  ttl: number;
  /** When the point is reached, it will be deemed as none (lazy judgment, no timer). */
  expiresAt: number;
}

/** Tombstone: Why is this lock missing (keep it until the pet creates a new lock, otherwise cause can only return to unknown forever). */
interface Tombstone {
  lockId: string;
  cause: LockCause;
}

/** Validation check conclusion of action endpoint (shared by 5 interfaces). */
export type LockGate =
  | { ok: true }
  | { ok: false; reason: 'lock-required'; message: string }
  | { ok: false; reason: 'lock-lost'; cause: LockCause; message: string };

/** Conclusion of lock acquisition/renewal. */
export type LockAcquireDecision =
  | { ok: true; petId: string; lockId: string; expiresAt: number; renewed: boolean }
  | { ok: false; reason: 'bad-request'; message: string }
  | { ok: false; reason: 'locked'; expiresAt: number; message: string }
  | { ok: false; reason: 'lock-lost'; cause: LockCause; message: string };

/** Release conclusion (released only means that a lock is really removed this time, false for idempotent no operation). */
export type LockReleaseDecision =
  | { ok: true; petId: string; released: boolean }
  | { ok: false; reason: 'bad-request'; message: string }
  | { ok: false; reason: 'lock-lost'; cause: LockCause; message: string };

/** ttl validity description (route and decision-making layer share the same rule to avoid distortion in two places). */
const TTL_TEXT = `ttl 必须是 ${LOCK_MIN_TTL_MS}~${LOCK_MAX_TTL_MS} 之间的有限数字（毫秒）`;

/**
 * ttl normalization: default / null → `fallback` ; if valid, return as is; if invalid, return null.
 *
 * Non-numeric / non-limited / out-of-bounds are all invalid, and there is no loose convention of "clamping when
 * out-of-bounds": if the caller writes the wrong duration, you should know it immediately, instead of getting a longer
 * or shorter lock than you thought.
 */
export function normalizeLockTtl(ttl: unknown, fallback: number): number | null {
  if (ttl === undefined || ttl === null) return fallback;
  if (typeof ttl !== 'number' || !Number.isFinite(ttl)) return null;
  if (ttl < LOCK_MIN_TTL_MS || ttl > LOCK_MAX_TTL_MS) return null;
  return ttl;
}

/**
 * lockId normalization: default / null → empty string (= not given, take the new path); non-character string → null
 * (invalid). Empty strings are treated as "not given" on purpose (consistent with the relaxed conventions of image /
 * url).
 */
function normalizeLockId(v: unknown): string | null {
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string') return null;
  return v.trim();
}

/** Occupied lock table (one for each plugin instance; in-process memory state, empty after restart). */
export class LockStore {
  // Using declare + constructor assignment: the class field initializer will downgrade @oxc - project/runtime external
  // helper, and it is an undeclared dependency and will be blocked by the prepack validation check (same as the
  // PollStateStore convention of ./state).
  /** petId → Currently occupied. */
  declare private readonly locks: Map<string, LockRecord>;
  /** petId → Why did the previous lock disappear (it will be invalidated when the new lock is created). */
  declare private readonly tombstones: Map<string, Tombstone>;
  /** The number is automatically incremented (together with the timestamp, it forms a unique number within the run, the same set as ./playback). */
  declare private seq: number;
  /** Get the current time (can be injected: the single test of expiration semantics does not really need to wait for 30 seconds). */
  declare private readonly now: () => number;
  /** Synchronize leaves when the lock status changes (it will be used for lock creation/renewal/release/expiration; if it is not passed, it will be purely logical and S will not be touched). */
  declare private readonly onChange: (petId: string, data: LockLeafData) => void;

  constructor(opts?: { now?: () => number; onChange?: (petId: string, data: LockLeafData) => void }) {
    this.locks = new Map();
    this.tombstones = new Map();
    this.seq = 0;
    this.now = opts?.now ?? Date.now;
    this.onChange = opts?.onChange ?? ((): void => {});
  }

  /**
   * Currently occupied (lazy judgment expired). Once reached, it will be considered as nothing: clearing records,
   * recording tombstones, and synchronizing leaves once.
   *
   * It is intentional to bring a side effect to the read method: the leaf is the only signal that the renderer can
   * see, and there is no timer on the host side - if any action endpoint or internal source calls this method once,
   * the expired lock will be cleared and written to S faithfully; even if no one calls it once, the renderer will
   * release itself according to expiresAt in the leaf.
   */
  current(petId: string): LockRecord | null {
    const rec = this.locks.get(petId);
    if (rec === undefined) return null;
    if (this.now() < rec.expiresAt) return rec;
    this.drop(petId, rec, 'expired');
    return null;
  }

  /** Whether this pet is occupied at the moment (the host internal automatic source uses it to decide to skip; it also lazily determines expiration). */
  locked(petId: string): boolean {
    return this.current(petId) !== null;
  }

  /**
   * Whether any pet is currently occupied (for testing/observation, the same as waiterCount of ./state).
   *
   * No one adjusts it on the production path: the two global segments (sections.balance / sections.workStatus) that
   * need to be blocked during the occupation period are shared by all pets. Skipping writing by the host will also
   * mute other pets, so those two places are ignored by the renderer itself.
   */
  anyLocked(): boolean {
    for (const petId of [...this.locks.keys()]) {
      if (this.current(petId) !== null) return true;
    }
    return false;
  }

  /**
   * Validation check of action endpoint (shared by / anim, / broadcast, / position, / throw, / bubble/clear).
   *
   * When there is no lock, it is divided into two categories according to whether it has a number: no → release (under
   * normal conditions without occupation, the existing caller does not need to change a word); with a number but the
   * lock cannot be found → lock-lost. Bringing the number means that the caller thinks it still holds it. Release at
   * this time is equivalent to quietly erasing "You lost the lock", and it will think that the show is still going on.
   * cause is taken from the tombstone, and the lock has never been built, which is unknown.
   */
  gate(petId: string, provided: string): LockGate {
    const rec = this.current(petId);
    if (rec !== null) {
      if (provided && provided === rec.lockId) return { ok: true };
      if (!provided) {
        return { ok: false, reason: 'lock-required', message: '这只桌宠正被占用，必须带 lock=<lockId>' };
      }
      return { ok: false, reason: 'lock-lost', cause: 'unknown', message: CAUSE_TEXT.unknown };
    }
    // No lock: Release without number; with number → clearly tell him that the lock is no longer there
    if (!provided) return { ok: true };
    const cause = this.causeOf(petId, provided);
    return { ok: false, reason: 'lock-lost', cause, message: CAUSE_TEXT[cause] };
  }

  /**
   * Lock acquisition/renewal (two-in-one: if `lockId` is given, it is renewed, if not given, it is new; see
   * openapi.yaml for the true value table).
   *
   * "There is id + currently no lock" will always report an error and will not be resurrected: after
   * expiration/release/preemption, use the old number to renew. You cannot use this method to re-establish the lock -
   * otherwise the "I lost the lock" will be quietly erased, and the lock holder will think that the show is still
   * going on.
   */
  acquire(args: { petId: string; lockId?: unknown; ttl?: unknown }): LockAcquireDecision {
    const { petId } = args;
    const renewId = normalizeLockId(args.lockId);
    if (renewId === null) return { ok: false, reason: 'bad-request', message: 'lockId 必须是字符串' };
    const rec = this.current(petId);

    if (renewId) {
      if (rec === null || rec.lockId !== renewId) {
        // There is no lock → Go to the tombstone and ask "How did it disappear in the first place"; there is a lock but it is not it → I just can't recognize the number.
        const cause: LockCause = rec === null ? this.causeOf(petId, renewId) : 'unknown';
        return { ok: false, reason: 'lock-lost', cause, message: CAUSE_TEXT[cause] };
      }
      const ttl = normalizeLockTtl(args.ttl, rec.ttl);
      if (ttl === null) return { ok: false, reason: 'bad-request', message: TTL_TEXT };
      rec.ttl = ttl;
      rec.expiresAt = this.now() + ttl;
      this.onChange(petId, { locked: true, expiresAt: rec.expiresAt });
      return { ok: true, petId, lockId: rec.lockId, expiresAt: rec.expiresAt, renewed: true };
    }

    if (rec !== null) {
      return { ok: false, reason: 'locked', expiresAt: rec.expiresAt, message: '这只桌宠已被占用' };
    }
    const ttl = normalizeLockTtl(args.ttl, LOCK_DEFAULT_TTL_MS);
    if (ttl === null) return { ok: false, reason: 'bad-request', message: TTL_TEXT };
    const record: LockRecord = { lockId: this.newId(), ttl, expiresAt: this.now() + ttl };
    this.locks.set(petId, record);
    this.tombstones.delete(petId); // New lock is established → old tombstone is invalidated (the old number will be unknown from now on)
    this.onChange(petId, { locked: true, expiresAt: record.expiresAt });
    return { ok: true, petId, lockId: record.lockId, expiresAt: record.expiresAt, renewed: false };
  }

  /**
   * Release. Choose one of two forms: `lockId` = lock holder finishes work (cause: released), `force: true` = renderer
   * is called when user drags/clicks/hides/closes (cause: preempted).
   *
   * Idempotent: Return to ok (released: false) when there is currently no lock - the intention of "let the lock
   * disappear" has been established in the empty state; but when there is a lock and lockId does not match, an error
   * must be reported (other people's locks are not allowed to be misplaced). That is the only way to release and fail.
   * force only believes in strict true: Loose conventions will take misinformation seriously at the cost of removing
   * other people's locks.
   */
  release(args: { petId: string; lockId?: unknown; force?: unknown }): LockReleaseDecision {
    const { petId } = args;
    const force = args.force === true;
    const releaseId = normalizeLockId(args.lockId);
    if (releaseId === null) return { ok: false, reason: 'bad-request', message: 'lockId 必须是字符串' };
    if (force && releaseId) {
      return { ok: false, reason: 'bad-request', message: 'lockId 与 force 只能给一个' };
    }
    if (!force && !releaseId) {
      return { ok: false, reason: 'bad-request', message: 'lockId 或 force 必须给一个' };
    }
    const rec = this.current(petId);
    if (rec === null) return { ok: true, petId, released: false }; // Idempotent: no lock can be released
    if (!force && rec.lockId !== releaseId) {
      return { ok: false, reason: 'lock-lost', cause: 'unknown', message: CAUSE_TEXT.unknown };
    }
    this.drop(petId, rec, force ? 'preempted' : 'released');
    return { ok: true, petId, released: true };
  }

  /** Remove all occupations (plugin unmount path): If you don't do this, the renderer will wait until TTL reaches the point before unblocking it. */
  releaseAll(): void {
    for (const petId of [...this.locks.keys()]) {
      const rec = this.locks.get(petId);
      if (rec !== undefined) this.drop(petId, rec, 'released');
    }
  }

  /** Release the lock and record the tombstone (the only exit to change the status: release / preemption / expiration, to ensure that leaves and tombstones are not missed). */
  private drop(petId: string, rec: LockRecord, cause: LockCause): void {
    this.locks.delete(petId);
    this.tombstones.set(petId, { lockId: rec.lockId, cause });
    this.onChange(petId, { locked: false });
  }

  /** Tombstone query: If the number is correct, it will be returned to its original cause, otherwise it will be unknown (wrong number/never). */
  private causeOf(petId: string, lockId: string): LockCause {
    const stone = this.tombstones.get(petId);
    return stone !== undefined && stone.lockId === lockId ? stone.cause : 'unknown';
  }

  /** New number: `lk-<time36>-<sequence36>` (the same set as playbackId of ./playback, only guaranteed to be unique within one run). */
  private newId(): string {
    return 'lk-' + this.now().toString(36) + '-' + (++this.seq).toString(36);
  }
}
