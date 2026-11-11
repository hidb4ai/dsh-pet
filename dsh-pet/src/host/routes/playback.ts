/**
 * Playback receipt: / playback /< id > query (can be suspended and waited) and / playback /< id >/ report reported.
 *
 * Playback is not driven, and recording is only reported and advanced by the renderer. Dependency (PetRouteDeps) is
 * passed in explicitly, and the module does not read global information or create status.
 * @module dsh-pet/src/host/routes/playback
 */
import { parsePlaybackPath, parseWaitQuery } from '../playback.ts';
import { type RouteResult } from '../http.ts';
import type { PetRouteDeps, RouteInput } from './types.ts';
import { failResult, invalidJson, methodNotAllowed, okResult } from './result.ts';

/** Playback receipt field: undefined is returned for misses and response is returned for hits. */
export async function handlePlaybackRoutes(deps: PetRouteDeps, input: RouteInput): Promise<RouteResult | undefined> {
  const { playback } = deps;
  const { body, method, rest, signal, url } = input;

  // Playback receipt: GET /playback /< id > query (can be suspended and waited), POST /playback /< id >/ report is
  // reported by the renderer. The record is driven by renderer reporting: host only knows "accepted". Without /
  // report, there is no real receipt, and the query will always stop at accepted. The playback record is a per-caller
  // resource (only the initiator cares, has a lifecycle, and the number increases with the caller), and does not enter
  // 1 s global broadcast. The prefix guard is written as a literal comparison so that scripts/check-openapi.mjs can
  // recognize this route (pure regular matching will not see it; do not write this comparison as it is in the
  // comments, it will be regarded as a real route).
  const playbackPath = rest === 'playback' || rest.startsWith('playback/') ? parsePlaybackPath(rest) : undefined;

  if (playbackPath) {
    const playbackId = playbackPath.playbackId;
    if (playbackPath.isReport) {
      if (method !== 'POST') return methodNotAllowed();
      let reported: unknown;
      try {
        reported = JSON.parse(body ?? 'null');
      } catch {
        return invalidJson();
      }
      const o = reported && typeof reported === 'object' ? (reported as Record<string, unknown>) : {};
      const outcome = playback.report(playbackId, o.status, o.reason);
      // Unknown receipt and invalid status are both business conclusions (the caller gave the wrong one), but still returned 200 + reason
      if (outcome === 'unknown') return failResult('unknown-playback', 'unknown playback');
      if (outcome === 'invalid') return failResult('bad-request', 'invalid status');
      // ok / ignored both return 200: the report is idempotent, and "this is already the case" is a success for the
      // reporting party (the late ended is not allowed to overwrite cancelled - the final state is protected in
      // ./playback)
      return okResult({ ok: true });
    }
    if (method !== 'GET') return methodNotAllowed();
    const record = playback.get(playbackId);
    if (!record) return failResult('unknown-playback', 'unknown playback');
    const parsed = parseWaitQuery(url.searchParams.get('wait'), url.searchParams.get('timeout'));
    if (parsed.kind === 'error') return failResult('bad-request', parsed.error);
    // Neither is passed = return immediately (fallback / debugging / caller that only wants to know the current status)
    if (parsed.kind === 'none') {
      return okResult({ ...record, matched: false });
    }
    const { wait: waitList, timeoutMs } = parsed;
    // Already in one of the waiting states → Return immediately, don’t wait in vain timeout
    if (waitList.includes(record.status)) {
      return okResult({ ...record, matched: true });
    }
    // Suspended waiting: The state enters the wait collection and wakes up immediately (matched:true); when the point
    // is reached, the record at that time is returned (matched:false).
    // When timeout =0, playback.wait will wake up on the next tick, which is equivalent to "return immediately". There
    // is no special judgment here.
    return await new Promise<RouteResult>((resolveWait) => {
      let settled = false;
      /** cleanup: only recognizes the first time (wakeup/timeout/cancel/caller disconnection may all arrive one after another) */
      const settle = (result: RouteResult): void => {
        if (settled) return;
        settled = true;
        resolveWait(result);
      };
      const cancel = playback.wait({
        playbackId,
        wait: waitList,
        timeoutMs,
        // No need to cancel when waking up: store has removed the waiter before callback (the timeout timer is also cleared)
        onWake: (r, matched) => settle(okResult({ ...r, matched })),
      });
      // The record is cleared after get (extreme race condition) → Unknown receipt will be returned immediately without hanging up
      if (cancel === undefined) {
        settle(failResult('unknown-playback', 'unknown playback'));
        return;
      }
      // caller disconnected: cancel the waiter (clear its timeout timer) to "no response" cleanup. It doesn't matter
      // if you don't pick it up if you monitor it: signal is only held by this request, and the entire reference chain
      // will be recycled after the request is completed.
      const onAbort = (): void => {
        cancel();
        settle({ kind: 'none' });
      };
      if (signal?.aborted) {
        onAbort();
        return;
      }
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  return undefined;
}
