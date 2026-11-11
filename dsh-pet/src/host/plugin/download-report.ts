/**
 * Report the download progress of desktop Helper: write the download fragment into the polling snapshot, and
 * automatically clear it after timeout.
 *
 * The download is not initiated, only the progress is forwarded. Dependencies are explicitly passed in by apply (see
 * input type), and the module does not read globals or create singletons.
 * @module dsh-pet/src/host/plugin/download-report
 */
import { TASK_TEXT_MAX, type HostWorkStatusState } from '../work-status.ts';
import type { WorkStatusBridge } from './work-status-bridge.ts';
import type { HostSetup } from './setup.ts';

/** Dependencies for download progress reporting, including assembly-time objects and earlier factories. */
export type DownloadReportInput = {} & Pick<HostSetup, 'EXTERNAL_WORK_SESSION'> &
  Pick<HostSetup, 'nextExternalWorkSeq'> &
  Pick<WorkStatusBridge, 'publishWorkStatus'> &
  Pick<HostSetup, 'workStatus'>;

/**
 * Create download progress report.
 */
export function createDownloadReport(deps: DownloadReportInput) {
  const { EXTERNAL_WORK_SESSION, nextExternalWorkSeq, publishWorkStatus, workStatus } = deps;
  /**
   * Retain the final Electron-download status for this many milliseconds: long enough to read ready/failed, but short
   * enough not to obscure subsequent work states. Terminal bubbles also dismiss after 10 seconds in the renderer.
   */
  const DOWNLOAD_SLOT_CLEAR_MS = 12 * 1000;

  let downloadSlotTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Write a Electron download log and enter working status: Desktop version users do not have a console. This is the
   * only place where they can see "what is downloading in the background". Borrow external write slot `api` (no new
   * section); first setState and then setTask (when the entry does not exist, setTask directly returns false), seq
   * must be incremented (in the same state and seq is not updated, setState short-circuit), the copy is as follows
   * TASK_TEXT_MAX truncation.
   */
  const reportDownload = (text: string, state: HostWorkStatusState, terminal = false): void => {
    const points = Array.from(text);
    const task = points.length > TASK_TEXT_MAX ? `${points.slice(0, TASK_TEXT_MAX).join('')}…` : text;
    workStatus.setState(EXTERNAL_WORK_SESSION, state, nextExternalWorkSeq());
    workStatus.setTask(EXTERNAL_WORK_SESSION, task);
    publishWorkStatus();
    if (!terminal) return;
    if (downloadSlotTimer !== null) clearTimeout(downloadSlotTimer);
    downloadSlotTimer = setTimeout(() => {
      downloadSlotTimer = null;
      if (workStatus.clear(EXTERNAL_WORK_SESSION)) publishWorkStatus();
    }, DOWNLOAD_SLOT_CLEAR_MS);
    downloadSlotTimer.unref?.(); // Don’t nail this timer into the host’s event loop (you shouldn’t wait for it when exiting)
  };

  /** Stop the pending slot clearing timer (called when the plugin is unmounted). */
  const stopDownloadSlotTimer = (): void => {
    if (downloadSlotTimer !== null) {
      clearTimeout(downloadSlotTimer);
      downloadSlotTimer = null;
    }
  };
  return { reportDownload, stopDownloadSlotTimer };
}
/** Download progress report output (for downstream factories on demand Pick). */
export type DownloadReport = ReturnType<typeof createDownloadReport>;
