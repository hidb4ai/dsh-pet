/**
 * Playback record table: acceptance, reporting, query and pending waiting.
 *
 * URL is not parsed (returned to ./parse), and the status legitimacy is not judged (returned to ./status). Must always
 * hold: late ended must not overwrite cancelled; waiters are woken up only once.
 * @module dsh-pet/src/host/playback/store
 */
import { PLAYBACK_KEEP_MS, isReportableStatus, isTerminalStatus } from './status.ts';
import type { PlaybackStatus } from './status.ts';

/** A record of a playback request (the response body of `GET /playback/{id}` is its shallow copy + `matched`). */
export interface PlaybackRecord {
  playbackId: string;
  /** Target pet instance id. */
  petId: string;
  /** The identifier of this playback request: The name form is the animation name (the name is the file name), and the url form is the address; it is purely recorded and does not participate in the judgment. */
  name: string;
  status: PlaybackStatus;
  createdAt: number;
  updatedAt: number;
  /** Time to enter ended (only ended band; failed / cancelled see updatedAt). */
  endedAt?: number;
  /** Reason for failure/interruption (only failed/cancelled bands). */
  reason?: string;
}

/** The conclusion of report (route determines the HTTP status code accordingly). */
export type ReportOutcome =
  /** Status updated (possibly awakening waiter). */
  | 'ok'
  /** Idempotent: Reporting after the final state, or reporting the same as the current state → 200 but does not change. */
  | 'ignored'
  /** Number does not exist/expired → 404. */
  | 'unknown'
  /** Invalid status name (including accepted, which renderer is not allowed to write) → 400. */
  | 'invalid';

/**
 * A pending waiter.
 *
 * record holds a live object reference: even if the record is cleared during the waiting period, what it reads is
 * still the final value, so there is always something to return to when waking up after a timeout, and there is no
 * need to save another snapshot.
 */
interface Waiter {
  /** Wait for one of these states. */
  readonly wait: ReadonlySet<string>;
  readonly onWake: (record: PlaybackRecord, matched: boolean) => void;
  readonly record: PlaybackRecord;
  timer: ReturnType<typeof setTimeout> | undefined;
}

/** Waiting for register parameter. */
export interface WaitArgs {
  playbackId: string;
  /** Wait for one of these states (not empty; the route will first verify the validity). */
  wait: readonly string[];
  /** Timeout in milliseconds; 0 = wake up immediately on next tick (equivalent to "return immediately"). */
  timeoutMs: number;
  /** Wake-up callback: matched = true means waiting, false means timeout/cancellation/record cleared. */
  onWake: (record: PlaybackRecord, matched: boolean) => void;
}

/**
 * Playback record table (one for each plugin instance; in-process memory state, empty when host restarts).
 *
 * In a single-threaded event loop, all methods are completed synchronously, and there is no race condition; the
 * wake-up callback can only be called after the method returns, so the caller can rest assured to call the method of
 * this table in the callback.
 */
export class PlaybackStore {
  // Using declare + constructor assignment: the class field initializer will downgrade @oxc - project/runtime external
  // helper, and it is an undeclared dependency and will be blocked by the prepack validation check (same as the
  // PollStateStore convention of ./state).
  declare private readonly records: Map<string, PlaybackRecord>;
  declare private readonly waiters: Map<string, Set<Waiter>>;
  /**
   * The scene in which each pet is currently in its final state. `pets.<id>.anim` is a single leaf (the same pet has
   * only one playback request at the same time), so when accepting a new playback request, directly mark the previous
   * one as cancelled/superseded - this is a deterministic fact, and there is no need to wait for the renderer to
   * report it.
   */
  declare private readonly activeByPet: Map<string, string>;
  /** The number is incremented (together with the timestamp, it constitutes a unique number within the run). */
  declare private seq: number;

  constructor() {
    this.records = new Map();
    this.waiters = new Map();
    this.activeByPet = new Map();
    this.seq = 0;
  }

  /**
   * Accept a playback request: Create a record (accepted), and mark the pet's previous game (if it is still in a
   * non-final state) as cancelled/superseded.
   * @returns newly created record (caller takes playbackId and sends it to caller).
   */
  create(petId: string, name: string): PlaybackRecord {
    this.sweep();
    const prev = this.activeByPet.get(petId);
    if (prev !== undefined) this.finish(prev, 'cancelled', 'superseded');
    const now = Date.now();
    const record: PlaybackRecord = {
      playbackId: 'pb-' + now.toString(36) + '-' + (++this.seq).toString(36),
      petId,
      name,
      status: 'accepted',
      createdAt: now,
      updatedAt: now,
    };
    this.records.set(record.playbackId, record);
    this.activeByPet.set(petId, record.playbackId);
    return record;
  }

  /** Check the record; does not exist/has expired and returns undefined (route returns 404). */
  get(playbackId: string): PlaybackRecord | undefined {
    this.sweep();
    return this.records.get(playbackId);
  }

  /**
   * renderer reports status once.
   *
   * Reports after the final state are always ignored (late ended is not allowed to overwrite cancelled), reports with
   * the same status as the current state are the same ignored; in both cases, the route returns 200 - for the
   * reporting party, "this is already the case" is success.
   */
  report(playbackId: string, status: unknown, reason?: unknown): ReportOutcome {
    this.sweep();
    const record = this.records.get(playbackId);
    if (!record) return 'unknown';
    const next = typeof status === 'string' ? status : '';
    if (!isReportableStatus(next)) return 'invalid';
    if (isTerminalStatus(record.status) || record.status === next) return 'ignored';
    const why = typeof reason === 'string' && reason !== '' ? reason : undefined;
    this.finish(playbackId, next as PlaybackStatus, why);
    return 'ok';
  }

  /**
   * A waiter is pending.
   * @returns cancels the function; when the number does not exist, it returns undefined (route returns 404 immediately
   * accordingly, without hanging).
   */
  wait(args: WaitArgs): (() => void) | undefined {
    this.sweep();
    const record = this.records.get(args.playbackId);
    if (!record) return undefined;
    const waiter: Waiter = {
      wait: new Set(args.wait),
      onWake: args.onWake,
      record,
      timer: undefined,
    };
    let set = this.waiters.get(args.playbackId);
    if (!set) {
      set = new Set();
      this.waiters.set(args.playbackId, set);
    }
    set.add(waiter);
    // Use bare setTimeout (not import node:timers): the named import will fix the original function reference, and the
    // single test mock timers cannot stop it.
    // timeoutMs = 0 → wake up immediately next tick (equivalent to "return immediately", route does not require
    // special judgment)
    waiter.timer = setTimeout(
      () => {
        this.dropWaiter(args.playbackId, waiter);
        waiter.onWake(waiter.record, false);
      },
      Math.max(0, args.timeoutMs),
    );
    // Do not allow this timer to wait for host main process verify (host should not wait for it when exiting)
    waiter.timer.unref?.();
    return () => this.dropWaiter(args.playbackId, waiter);
  }

  /** End all pending waiting (plugin unmount / host exit path); when waking up, matched = false, the caller will cleanup immediately accordingly. */
  cancelAll(): void {
    for (const [playbackId, set] of [...this.waiters]) {
      for (const waiter of [...set]) {
        this.dropWaiter(playbackId, waiter);
        waiter.onWake(waiter.record, false);
      }
    }
  }

  /**
   * Clean up expired final state records (lazy calls: create / get / report are called once each, the number of
   * records is very small, and the cost is negligible).
   *
   * People who are still waiting for it must be woken up first: the upper limit of waiting (10 s) is usually much
   * smaller than the retention time (60 s), but the caller can register a waiter waiting for "other states" at the end
   * of the retention window of a final state record - if it is not awakened, it will become a suspended waiter that
   * will never wait.
   *
   * @param now - Injection time (for single measurement; the default is the current time).
   */
  sweep(now: number = Date.now()): void {
    for (const [playbackId, record] of this.records) {
      if (!isTerminalStatus(record.status)) continue;
      if (now - record.updatedAt < PLAYBACK_KEEP_MS) continue;
      const set = this.waiters.get(playbackId);
      if (set) {
        for (const waiter of [...set]) {
          this.dropWaiter(playbackId, waiter);
          waiter.onWake(waiter.record, false);
        }
      }
      this.records.delete(playbackId);
    }
  }

  /** Current record number (for testing/observation). */
  count(): number {
    return this.records.size;
  }

  /** The current number of waiters (for testing/observation: to verify that there is no leakage). */
  waiterCount(): number {
    let n = 0;
    for (const set of this.waiters.values()) n += set.size;
    return n;
  }

  /**
   * Falling into a final state: writing status, updating time, removing "currently active", and waking up people
   * waiting for this status. This is the only state writing point, so waiter wake-up only occurs here (no need for
   * diff, no comparison).
   */
  private finish(playbackId: string, status: PlaybackStatus, reason?: string): void {
    const record = this.records.get(playbackId);
    if (!record) return;
    record.status = status;
    record.updatedAt = Date.now();
    if (status === 'ended') record.endedAt = record.updatedAt;
    if (reason !== undefined) record.reason = reason;
    if (this.activeByPet.get(record.petId) === playbackId) this.activeByPet.delete(record.petId);
    const set = this.waiters.get(playbackId);
    if (!set) return;
    for (const waiter of [...set]) {
      if (!waiter.wait.has(status)) continue; // Not waiting for this status: continue to hang
      this.dropWaiter(playbackId, waiter);
      waiter.onWake(waiter.record, true);
    }
  }

  /** Remove a waiter (clear timer + remove from collection + empty collection collection). */
  private dropWaiter(playbackId: string, waiter: Waiter): void {
    if (waiter.timer !== undefined) {
      clearTimeout(waiter.timer);
      waiter.timer = undefined;
    }
    const set = this.waiters.get(playbackId);
    if (!set) return;
    set.delete(waiter);
    if (set.size === 0) this.waiters.delete(playbackId);
  }
}
