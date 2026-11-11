/**
 * "Freeloader" occupied locks: lock acquisition, heartbeat renewal, takeover after refresh, and lock release at the
 * end.
 *
 * The semantics of the lock are "This pet is under my command during this period": after getting it, the host's
 * autonomous behavior will stop, and third parties cannot snatch it. When refreshing the page, JS on the old page was
 * directly destroyed and there was no time to release the lock, so the lock number was recorded in sessionStorage -
 * the same tab page is still there after refreshing. I will renew it next time when the show starts. If it can be
 * renewed, it means that it was originally mine.
 * @module dsh-pet/src/client/baifan/lock
 */
import { CFG } from './constants.ts';
import type { Transport } from './transport.ts';

/** sessionStorage contains the key prefix of the lock number (separated by pet). */
const LOCK_KEY = 'dsh-pet-baifan/lock/';

/** The reason why the lock was removed: the user dragged it away/expired/was snatched by other plugins. */
export type LockLoss = 'lock-lost' | 'lock-required' | null;

/** "Interrupted by user" use this exception to jump out to avoid taking the "error" path. */
export class Halted extends Error {}

/** Read the last lock number obtained on this tab page. */
function readStored(petId: string): string | null {
  try {
    return sessionStorage.getItem(LOCK_KEY + petId);
  } catch {
    return null;
  }
}

/** Write/clear the lock number of this tab; privacy mode or disabling storage will not affect the performance. */
function writeStored(petId: string, lock: string | null): void {
  try {
    if (lock === null) sessionStorage.removeItem(LOCK_KEY + petId);
    else sessionStorage.setItem(LOCK_KEY + petId, lock);
  } catch {
    // Forget it if you can’t save it: What’s lost is the convenience of “take over after refreshing”, and the lock itself will work as usual.
  }
}

/**
 * Lockmaking Manager.
 *
 * @param transport - interface call.
 * @param petId - Which pet to occupy.
 * @param alive - Should this show continue? (The retry loop must be exited immediately after the show ends.)
 * @param toast - prompt bar.
 * @returns lock acquisition, renewal, lock release and status reading.
 */
export function createLock(transport: Transport, petId: string, alive: () => boolean, toast: (text: string) => void) {
  /** Current lock ID; null means unlocked. */
  let lockId: string | null = null;
  /** Heartbeat found that the lock is gone. */
  let lost = false;
  /** Heartbeat timer. */
  let timer = 0;

  /** Lock failure is judged here uniformly, so as not to write it down for each call point. */
  function noteFailure(reason: unknown): void {
    if (reason === 'lock-lost' || reason === 'lock-required') lost = true;
  }

  /** Lock acquisition: First try to refresh the old lock left behind, and then create a new one. If it is occupied, wait for it to expire. */
  async function acquire(): Promise<void> {
    const path = '/lock?pet=' + encodeURIComponent(petId) + '&surface=web';

    // 1) Try "my own old lock" first (left after refreshing the page)
    const stored = readStored(petId);
    if (stored !== null) {
      const renewed = await transport.call('POST', path, { lockId: stored });
      if (renewed.ok === true) {
        lockId = String(renewed.lockId);
        lost = false;
        return;
      }
      writeStored(petId, null);
    }

    // 2) New
    const created = await transport.call('POST', path, { ttl: CFG.lockTtl });
    if (created.ok === true) {
      lockId = String(created.lockId);
      lost = false;
      writeStored(petId, lockId);
      return;
    }

    const reason = created.reason;
    if (reason === 'pet-not-displayed') {
      throw new Error('This pet is not displayed in the browser (display=' + String(created.display) + '）');
    }
    if (reason !== 'locked') throw new Error('Could not acquire the lock:' + String(reason ?? 'unknown'));

    // 3) Occupied: It may be that the previous session has not expired. Wait a minute, don't immediately sentence him to death.
    const expiresAt = typeof created.expiresAt === 'number' ? created.expiresAt : 0;
    const waitMs = Math.min(CFG.lockWaitMs, Math.max(0, expiresAt - Date.now()) + 2000);
    toast('上一场还没收干净，等它过期…');
    const deadline = performance.now() + waitMs;
    for (;;) {
      if (!alive()) throw new Halted();
      if (performance.now() > deadline) break;
      await new Promise((resolve) => window.setTimeout(resolve, 1500));
      if (!alive()) throw new Halted();
      const retry = await transport.call('POST', path, { ttl: CFG.lockTtl });
      if (retry.ok === true) {
        lockId = String(retry.lockId);
        lost = false;
        writeStored(petId, lockId);
        return;
      }
      if (retry.reason !== 'locked') throw new Error('Could not acquire the lock:' + String(retry.reason ?? 'unknown'));
    }
    throw new Error('The pet is busy with another action. Try again shortly.');
  }

  /** Heartbeat: Renewal and exploration by the way; if lost is lost, the pursuit cycle will end naturally on the next tick. */
  function startRenew(): void {
    stopRenew();
    timer = window.setInterval(() => {
      void (async () => {
        if (!alive() || lockId === null || lost) return;
        try {
          const r = await transport.call('POST', '/lock?pet=' + encodeURIComponent(petId) + '&surface=web', { lockId });
          // If it cannot be renewed, it is lost (expired / towed away / robbed) - no need to wait TTL
          if (r.ok !== true) {
            noteFailure(r.reason);
            lost = true;
          }
        } catch {
          // Network jitter does not count as lock loss: try again next tick
        }
      })();
    }, CFG.renewMs);
  }

  /** Heartbeat stopped. */
  function stopRenew(): void {
    if (timer !== 0) window.clearInterval(timer);
    timer = 0;
  }

  /** Release the lock (for closing); it doesn’t matter if you can’t release it, TTL will become invalid upon reaching the point. */
  async function release(): Promise<void> {
    const lease = lockId;
    lockId = null;
    if (lease === null) return;
    try {
      await transport.call('POST', '/lock/release?pet=' + encodeURIComponent(petId), { lockId: lease });
    } catch {
      // Leave it to TTL
    }
    writeStored(petId, null);
  }

  /**
   * Try your best to release the lock when the page is about to leave (refresh/close the tab).
   *
   * fetch will most likely be interrupted at this time, so use sendBeacon: it will be sent by the browser, and the
   * page will be sent even if it dies. I can’t let go of TTL and the “Take Over the Old Lock” fallback that will be
   * released next time.
   */
  function releaseOnPageHide(): void {
    const lease = lockId;
    if (lease === null) return;
    lockId = null;
    writeStored(petId, null);
    try {
      if (navigator.sendBeacon !== undefined) {
        const body = JSON.stringify({ lockId: lease });
        navigator.sendBeacon(
          '/dsh-pet-7340/lock/release?pet=' + encodeURIComponent(petId),
          new Blob([body], { type: 'application/json' }),
        );
        return;
      }
    } catch {
      // Return to TTL
    }
  }

  return {
    acquire,
    /** Current lock ID; null means unlocked. */
    id: (): string | null => lockId,
    /** Heartbeat found that the lock was lost. */
    isLost: (): boolean => lost,
    noteFailure,
    release,
    releaseOnPageHide,
    startRenew,
    stopRenew,
  };
}

/** The public side of the lock manager. */
export type Lock = ReturnType<typeof createLock>;
