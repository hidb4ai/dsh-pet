/**
 * polling status (host side): The only data source for `GET /state` , global segment + per pet leaf + long polling
 * waiters are all here.
 *
 * Not responsible for rendering side comparison: pull, flatten, press counter to decide whether to render in
 * src/shared/state.ts. Not import src/shared (DSH single file load constraint), the state shape is therefore written
 * one copy each with the shared layer. There are no dependencies; the in-process memory state will be empty when the
 * host is restarted. Always true: every write must advance counter, and can only be written via writeSection /
 * writePet. For the contract, see "state Detailed Explanation" of API.md and openapi.yaml.
 *
 * @module dsh-pet/src/host/state
 */

/** A leaf: counter + load (data to null means there is no data yet). */
export interface StateLeaf {
  counter: number;
  data: unknown;
}

/**
 * Global state shared by every client. `config` carries only a change signal: its data is always `{}`.
 * When its counter changes, consumers fetch `GET /config` again. Keeping the full configuration out of
 * `/state` avoids sending it on every poll.
 *
 * `POST /pet-display` and `POST /pet-config` write this signal so other clients can refresh their configuration.
 * `PUT /config` and `POST /config` return the updated aggregate directly and do not write the signal.
 * Manual configuration-file edits require a reload; the host does not poll file modification times.
 */
export type SectionName = 'balance' | 'workStatus' | 'notify' | 'config' | 'menu' | 'focusSession';

/**
 * Each pet segment (say = what to say; anim = the name of the animation to be played; position = the position to be
 * moved to; throw = the initial velocity to be given;
 * lock = occupied lock state; sleep = sleeping state). say / anim / position / throw are host → Front-end
 * instructions: The front-end reads and executes them without writing anything to them. `lock` / `sleep` is a status,
 * not an instruction: the front end reads it to decide whether to freeze or sleep, and cleanup itself according to the
 * value in the leaf - there is no timer on the host side (see ./lock, ./sleep).
 */
export type PetLeafName = 'say' | 'anim' | 'position' | 'throw' | 'lock' | 'sleep';

/**
 * The complete form of S (the response body of GET /state). `counter` is the version number of the entire S = the
 * last written number, the top level rather than the leaf: the caller uses it as `?since=` to return.
 */
export interface PollState {
  counter: number;
  sections: Record<SectionName, StateLeaf>;
  pets: Record<string, Record<PetLeafName, StateLeaf>>;
}

/**
 * `?timeout=` upper limit (ms): the capped length of waiting time to prevent the caller from hanging the connection.
 * Same value and same reason as MAX_PLAYBACK_WAIT_MS of ./playback: DSH WebServer Whether idle timeout is set for
 * long-term held response has not been verified yet, first press it at 10 s; after verification, adjust both places
 * together.
 */
export const MAX_STATE_WAIT_MS = 10 * 1000;

/** Analytical conclusion of `?since=&timeout=`. */
export type StateWaitParse =
  /** Neither is transmitted → Return to the current status immediately. */
  | { kind: 'none' }
  /** Pending waiting. */
  | { kind: 'ok'; since: number; timeoutMs: number }
  /** Invalid parameter → route returns 400 (with clear reason, no silent fallback). */
  | { kind: 'error'; error: string };

/**
 * Parse `?since=<version>` and `?timeout=<ms>` (required in pairs, see openapi.yaml for rules).
 *
 * since is a non-negative integer, `0` is valid (the caller that accesses for the first time uses it to express "I
 * have nothing in my hand"); timeout only accepts non-negative integers from 0.. MAX_STATE_WAIT_MS, `0` is valid (the
 * next tick returns immediately).
 */
export function parseStateWaitQuery(sinceRaw: string | null, timeoutRaw: string | null): StateWaitParse {
  if (sinceRaw === null && timeoutRaw === null) return { kind: 'none' };
  if (sinceRaw === null || timeoutRaw === null) {
    return { kind: 'error', error: 'since and timeout must be used together' };
  }
  if (!/^\d+$/.test(sinceRaw)) return { kind: 'error', error: 'invalid since (expect a non-negative integer)' };
  if (!/^\d+$/.test(timeoutRaw)) {
    return { kind: 'error', error: `invalid timeout (expect 0..${MAX_STATE_WAIT_MS})` };
  }
  const since = Number(sinceRaw);
  const timeoutMs = Number(timeoutRaw);
  if (!Number.isFinite(since)) return { kind: 'error', error: 'invalid since (expect a non-negative integer)' };
  if (!Number.isFinite(timeoutMs) || timeoutMs > MAX_STATE_WAIT_MS) {
    return { kind: 'error', error: `invalid timeout (expect 0..${MAX_STATE_WAIT_MS})` };
  }
  return { kind: 'ok', since, timeoutMs };
}

/** Empty leaf: counter =0 means it has never been written - the front-end first pulls it as the baseline, and then renders the counter changes. */
const emptyLeaf = (): StateLeaf => ({ counter: 0, data: null });

/** A pending waiter. Just wait for one condition: `last` becomes not equal to `since`. */
interface Waiter {
  /** The version number of the state in the caller's hand. */
  readonly since: number;
  /** Wake up callback: wait until it changes/times out/cancels (the three are the same thing for caller: to read the latest status). */
  readonly onWake: () => void;
  timer: ReturnType<typeof setTimeout> | undefined;
}

/** polling unified state storage (one for each plugin instance; in-process memory state, empty after restart). */
export class PollStateStore {
  // Using declare + constructor assignment: The class field initializer will downgrade @oxc - project/runtime external
  // helper, and it is an undeclared dependency and will be blocked by prepack validation check (same agreement with ./
  // playback, ./lock, ./helper-process).
  /** Strictly increasing counter seed (guaranteed to get different counter even if written twice in the same millisecond). */
  declare private last: number;
  declare private readonly sections: Record<SectionName, StateLeaf>;
  declare private readonly pets: Map<string, Record<PetLeafName, StateLeaf>>;
  /**
   * Pending waiter. Global collection: wake up any leaves after they are written - it is intentional to wake everyone
   * up once written, in order to make the implementation simple (the desktop has one window and one pet, and it will
   * be enlarged according to the number of windows).
   */
  declare private readonly waiters: Set<Waiter>;

  constructor() {
    this.last = 0;
    this.sections = {
      balance: emptyLeaf(),
      workStatus: emptyLeaf(),
      notify: emptyLeaf(),
      config: emptyLeaf(),
      // Third-party right-click menu item (register table snapshot of src/host/menu): Write it when the third-party
      // register/covers the menu, and both ends construct "more" in the right-click menu accordingly. For the shape
      // data see readMenuItems of shared/menu.
      menu: emptyLeaf(),
      // The jump intention after the desktop pet clicks the session bubble (`POST /focus-session`): the page switches
      // to the session accordingly. One-time signal: with ts, the consumer will judge the weight according to it, and
      // the page can still be replayed once when it is loaded later than written.
      focusSession: emptyLeaf(),
    };
    this.pets = new Map();
    this.waiters = new Set();
  }

  /** Next counter. */
  private next(): number {
    // No need to use 0,1,2... Auto-increment: The host will reset to zero after restarting, but the front-end still
    // has the old value, and the comparison will be permanently invalid.
    // Date.now() is naturally monotonous and does not go backwards after restarting. Collisions in the same
    // millisecond will use +1 handle.
    this.last = Math.max(Date.now(), this.last + 1);
    return this.last;
  }

  /**
   * Write a global leaf (balance/work status/notification/configuration change signal). Replace the leaf object as a
   * whole instead of changing the field in place: The reference obtained by `read()` will not be half-new or half-old.
   */
  writeSection(name: SectionName, data: unknown): void {
    this.sections[name] = { counter: this.next(), data };
    this.wakeWaiters();
  }

  /** Write a pet leaf (the pet entry will be automatically created if it does not exist, all slots will be built together, and the shape will be constant). */
  writePet(petId: string, leaf: PetLeafName, data: unknown): void {
    let entry = this.pets.get(petId);
    if (!entry) {
      entry = {
        say: emptyLeaf(),
        anim: emptyLeaf(),
        position: emptyLeaf(),
        throw: emptyLeaf(),
        lock: emptyLeaf(),
        sleep: emptyLeaf(),
      };
      this.pets.set(petId, entry);
    }
    entry[leaf] = { counter: this.next(), data };
    this.wakeWaiters();
  }

  /**
   * Current S (response body of GET /state). sections is a shallow copy, and pets is a new object - the leaf object
   * itself is shared, but the write is always replaced as a whole, so the consumer will not read the half-written
   * leaf.
   */
  read(): PollState {
    return { counter: this.last, sections: { ...this.sections }, pets: Object.fromEntries(this.pets) };
  }

  /**
   * Wait until `last` differs from `since` , the timeout expires, or the caller cancels.
   *
   * All three paths tell the caller to fetch the latest state with `read()` , so the callback takes no arguments.
   *
   * @returns A cancellation function that clears the timer and removes the waiter.
   */
  wait(args: { since: number; timeoutMs: number; onWake: () => void }): () => void {
    const waiter: Waiter = { since: args.since, onWake: args.onWake, timer: undefined };
    this.waiters.add(waiter);
    // timeoutMs = 0 → wake up immediately next tick (equivalent to "return immediately", route does not require special judgment)
    waiter.timer = setTimeout(
      () => {
        this.dropWaiter(waiter);
        waiter.onWake();
      },
      Math.max(0, args.timeoutMs),
    );
    // Do not allow this timer to host main process verify (host should not wait for it when exiting; keep the event loop alive under node:test)
    if (process.env.NODE_TEST_CONTEXT === undefined) waiter.timer.unref?.();
    return () => this.dropWaiter(waiter);
  }

  /**
   * End all pending waits (plugin unmount / host exit path). No distinguishing flags are given when waking up: the
   * caller cleanup immediately accordingly, rather than leaving a pending response.
   */
  cancelAll(): void {
    for (const waiter of [...this.waiters]) {
      this.dropWaiter(waiter);
      waiter.onWake();
    }
  }

  /** The current number of waiters (for testing/observation: to verify that there is no leakage). */
  waiterCount(): number {
    return this.waiters.size;
  }

  /**
   * Wake up all expired waiters (the only call points are the two write methods, and must be after the leaves are
   * written). Skip of `since === this.last` : The kind of waiter is already up to date, and waking it up is equivalent
   * to idling. Must be written after `this.sections[name] = …` : placing it in next() will cause the callback to be
   * executed before the assignment, and the caller will read the old state.
   */
  private wakeWaiters(): void {
    if (this.waiters.size === 0) return;
    for (const waiter of [...this.waiters]) {
      if (waiter.since === this.last) continue;
      this.dropWaiter(waiter);
      waiter.onWake();
    }
  }

  /** Remove a waiter (clear timer + remove from set). */
  private dropWaiter(waiter: Waiter): void {
    if (waiter.timer !== undefined) {
      clearTimeout(waiter.timer);
      waiter.timer = undefined;
    }
    this.waiters.delete(waiter);
  }
}
