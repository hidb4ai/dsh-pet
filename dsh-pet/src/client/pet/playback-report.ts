/**
 * Status receipt of third-party playback request: host only knows about acceptance. The actual playback result is only
 * known by the browser side, so it must be reported truthfully here. The three final states of `playing` / `cancelled`
 * / `failed` each have their own reasons. host converges the queue accordingly without making secondary inferences. If
 * it fails, only warn will not be thrown: losing the receipt will not affect the user's viewing of the animation.
 * @module dsh-pet/src/client/pet/playback-report
 */
import { ROUTE_PATH } from '../../shared/constants.ts';
import type { ReportableStatus } from '../../shared/playback.ts';
import { postAction } from '../../shared/state.ts';

/** playback request status: renderer only reports one of these four types, and the vocabulary is in `shared/playback.ts`. */

/** Request shape for one receipt. */
export interface PlaybackReportRequest {
  url: string;
  body: Record<string, unknown>;
}

/**
 * Spell receipt request.
 *
 * @param playbackId - host Assigned playback numbers.
 * @param status - Final state or `playing` .
 * @param reason - Final state reason (`superseded` / `decode-error` / `asset-load` , etc.), does not affect URL.
 * @returns can directly hand over the address and request body of `postAction` .
 */
export function playbackReportRequest(
  playbackId: string,
  status: ReportableStatus,
  reason?: string,
): PlaybackReportRequest {
  return {
    url: ROUTE_PATH + '/playback/' + encodeURIComponent(playbackId) + '/report',
    body: reason === undefined ? { status } : { status, reason },
  };
}

/**
 * Create receipt function.
 *
 * @param o - Receipt context: `petId` is only used for failure logs and does not participate in addresses.
 * @returns reports the playback request status once; do not adjust the self-play animation.
 */
export function makePlaybackReporter(o: { petId: string }) {
  return (playbackId: string, status: ReportableStatus, reason?: string): void => {
    const request = playbackReportRequest(playbackId, status, reason);
    void postAction(request.url, request.body).then((ok: boolean) => {
      if (!ok) {
        console.warn(
          '[dsh-pet] Playback report not delivered pet=' + o.petId + ' id=' + playbackId + ' status=' + status,
        );
      }
    });
  };
}
