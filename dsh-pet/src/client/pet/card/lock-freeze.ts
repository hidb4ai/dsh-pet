/**
 * Freezing driver that occupies the lock: converts the lock leaves of / state into frozen flips, and is responsible
 * for automatically thawing at the point. It is not responsible for what to do after flipping: the stop-and-go
 * position, bubble closing, and animation selection are all passed in as callback by PetCard. Dependency injection
 * react and animation chain setFrozen; the defrost timer is only held in this module. Invariant: The frozen state can
 * only be changed by two paths: lock leaf and local unfreeze. Both of them clear the timer first and then flip.
 * @module dsh-pet/src/client/pet/card/lock-freeze
 */
import type { LockState } from '../../../shared/state.ts';
import type { FreezeCue } from '../animation/cues.ts';
import type * as ReactNS from 'react';

/** A callback to be executed for a flip. */
export interface FreezeHandlers {
  /** Freeze takes effect: stop self-broadcasting and close task bubble. */
  onFrozen(): void;
  /** Thawing takes effect: restore to the animation being played. */
  onResumed(): void;
}

/** Each render input provided by PetCard. */
export interface LockFreezeInput extends FreezeHandlers {
  /** The lock leaf of this pet; `undefined` means that the host has never written. */
  lock?: LockState;
  /** Number of lock leaf changes. */
  lockTick: number;
  /** Freeze switch of the animation chain; what is returned is this flip, null means this is the original value. */
  setFrozen(frozen: boolean): FreezeCue | null;
}

/** Freeze the external writing surface of the driver. */
export interface LockFreeze {
  /** Local defrost immediately and clear the defrost timer; the user takes over the pet time adjustment. */
  release(): void;
}

/** Injected react capability. */
export interface LockFreezeRuntime {
  /** Reference; used to hold the unfreeze timer. */
  useRef: <T>(initial: T) => ReactNS.MutableRefObject<T>;
  /** side effect; recalculate the deadline when the leaf or tick changes. */
  useEffect: (effect: ReactNS.EffectCallback, deps?: ReactNS.DependencyList) => void;
}

/**
 * Calculate the freeze deadline from the lock leaf.
 *
 * You may get stale leaves after refreshing: If expiresAt has passed, it is assumed that there is no lock, and you
 * cannot just look at locked.
 *
 * @param lock - Lock leaves.
 * @param nowMs - The current time ( ms ), injected by the caller for testing.
 * @returns The absolute time to expire (ms); 0 means there is currently no lock.
 */
export function freezeDeadline(lock: LockState | undefined, nowMs: number): number {
  const expiresAt = lock?.locked === true ? lock.expiresAt : 0;
  return expiresAt > nowMs ? expiresAt : 0;
}

/** Perform a flip; cue is null, indicating that the state is originally this value. */
function dispatchCue(cue: FreezeCue | null, handlers: FreezeHandlers): void {
  if (cue === null) return;
  if (cue.kind === 'frozen') handlers.onFrozen();
  else handlers.onResumed();
}

/**
 * Create freeze-driven hook and call each PetCard once.
 *
 * @param rt - Injected react capabilities.
 * @returns receives hook that locks the leaf; the unfreeze timer is cleared together with the card unmount.
 */
export function createLockFreeze(rt: LockFreezeRuntime) {
  const { useEffect, useRef } = rt;

  return function useLockFreeze(input: LockFreezeInput): LockFreeze {
    /** Thaw timer; it must be cleared before recalculation and local unfreezing, otherwise the old timer will be unfrozen in advance. */
    const timerRef = useRef<number | null>(null);

    /** Clear the defrost timer; call safety again. */
    const clearTimer = () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    useEffect(() => {
      clearTimer();
      const now = Date.now();
      const expiresAt = freezeDeadline(input.lock, now);
      dispatchCue(input.setFrozen(expiresAt > now), input);
      if (expiresAt <= now) return clearTimer;
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        dispatchCue(input.setFrozen(false), input);
      }, expiresAt - now);
      return clearTimer;
      // Callbacks read refs and stable setters. Depending on their render-time identities would continually reset the thaw timer and prevent lock expiry.
      // eslint-disable-next-line react-hooks/exhaustive-deps -- Only the state leaf and tick trigger updates.
    }, [input.lockTick, input.lock]);

    return {
      release: () => {
        clearTimer();
        dispatchCue(input.setFrozen(false), input);
      },
    };
  };
}
