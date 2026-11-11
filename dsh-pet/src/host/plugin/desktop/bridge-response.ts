/**
 * Shape conversion of pipeline response: translate a route result ({@link RouteResult}) into the response body of
 * Helper.
 *
 * It only does shape conversion, not counting business, and does not read or write disks; the conventions for the two
 * consumptions (asset takes the file path, and the rest takes body) are collected here, so it can be separated from
 * the Electron and HTTP assertions. Asset branch constant 200——404/400 has been expressed by text branch.
 * @module dsh-pet/src/host/plugin/desktop/bridge-response
 */
import type { BridgeResponse } from '../../helper/bridge.ts';
import type { RouteResult } from '../../http.ts';

/** Type string of plain text response; shared by `text` and `none`. */
const TEXT_UTF8 = 'text/plain; charset=utf-8';

/** JSON response type string. */
const JSON_UTF8 = 'application/json; charset=utf-8';

/**
 * Translate route results into piped responses.
 *
 * @param id - The number of this request, the response must be brought back intact (coexisting requests on the
 * pipeline are matched by it).
 * @param result - Business processing results.
 * @returns response body; `none` results in empty 204.
 */
export function toBridgeResponse(id: number, result: RouteResult): BridgeResponse {
  if (result.kind === 'file') {
    // The asset only gives the absolute path, and the main process reads the disk by itself: dozens of MB videos do not enter the pipeline.
    return { id, status: 200, contentType: result.contentType, file: result.file };
  }
  if (result.kind === 'text') {
    return { id, status: result.status, contentType: TEXT_UTF8, body: result.body };
  }
  if (result.kind === 'none') {
    // No response required: abort signal is not transmitted on the pipe side, and it cannot reach here normally; the minimum guarantee is 204.
    return { id, status: 204, contentType: TEXT_UTF8, body: '' };
  }
  // Business failure is 200 + { ok : false , reason }: transparent transmission as it is, without changing the status code.
  return { id, status: result.status, contentType: JSON_UTF8, body: JSON.stringify(result.obj) };
}
