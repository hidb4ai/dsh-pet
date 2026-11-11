/**
 * unmount cleanup: remove the monitor, stop the timer, end the pending wait, the order cannot be exchanged.
 *
 * No startup is performed (startHelper alone at the end of the assembly), and the resource handle is not held.
 * @module dsh-pet/src/host/plugin/lifecycle
 */
import type { PetLookup } from './pet-lookup.ts';
import type { DesktopHelper } from './desktop-helper.ts';
import type { DownloadReport } from './download-report.ts';
import type { WorkStatusBridge } from './work-status-bridge.ts';
import type { HostSetup } from './setup.ts';
import type { HostContext } from './context.ts';

/** unmount sanitized input. */
export type LifecycleInput = {
  /** host context (the one apply received). */
  ctx: HostContext;
} & Pick<PetLookup, 'lock'> &
  Pick<DesktopHelper, 'markDisposed'> &
  Pick<HostSetup, 'playback'> &
  Pick<HostSetup, 'state'> &
  Pick<DownloadReport, 'stopDownloadSlotTimer'> &
  Pick<DesktopHelper, 'stopHelper'> &
  Pick<WorkStatusBridge, 'stopWorkStatusFlush'>;

/** register unmount cleanup; the returned cleanup function is collected by ctx.effect. */
export function registerLifecycle(deps: LifecycleInput): void {
  const { ctx, lock, markDisposed, playback, state, stopDownloadSlotTimer, stopHelper, stopWorkStatusFlush } = deps;
  // Cleaning up with the plugin lifecycle: desktop Helper recycling (no longer pulled up after the asynchronous
  // download is completed) + ending all pending waits (if the receipt and / state long polling do not end, plugin
  // reloading will leave a batch of hanging responses, and each will have to wait until timeout before cleanup).
  ctx.effect(() => () => {
    markDisposed();
    // The rewriting timer of working status: it has no meaning after unmounting (the leaves are cleanup together with long polling), clear it to avoid hanging
    stopWorkStatusFlush();
    // Download log "clear slot" timer: Same as above, it has no meaning after unmounting.
    stopDownloadSlotTimer();
    // Lock occupation: When unmounting, remove all locks and write the leaves once - otherwise, the renderer will wait
    // until TTL reaches the point before releasing the static state (the leaves must be written before state.cancelAll
    // (): after that, the pending waiters have been cleaned up).
    lock.releaseAll();
    playback.cancelAll();
    state.cancelAll();
    stopHelper('dsh-host-stop');
  });
}
