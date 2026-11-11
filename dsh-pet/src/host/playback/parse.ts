/**
 * Analysis of receipt path and waiting query: / playback /< id >, / playback /< id >/ report, ? wait =& timeout =.
 *
 * store is not read, and the status is not judged; invalid input returns undefined, and the route layer returns 400.
 * This must always be true: the parsing result only depends on the input parameters and does not depend on the calling
 * timing.
 * @module dsh-pet/src/host/playback/parse
 */
import { MAX_PLAYBACK_WAIT_MS, isPlaybackStatus } from './status.ts';
import type { PlaybackStatus } from './status.ts';

/**
 * Path analysis: `playback/<id>` (query) and `playback/<id>/report` (report).
 *
 * Regularly anchored at both ends, only these two shapes are recognized: the rest (`playback/`, `playback/a/b` ,
 * `playbackx/a` ) will all return undefined, and will be handed over to the downstream branches to report errors
 * according to their respective conventions. Never "try your best to guess a id" here.
 */
export function parsePlaybackPath(rest: string): { playbackId: string; isReport: boolean } | undefined {
  const m = /^playback\/([^/]+)(\/report)?$/.exec(rest);
  if (!m) return undefined;
  return { playbackId: m[1] ?? '', isReport: m[2] === '/report' };
}

/** Analytical conclusion of `?wait=&timeout=`. */
export type WaitParse =
  /** Neither is passed → return immediately (fallback / debugging / just want to know the current status). */
  | { kind: 'none' }
  /** Pending waiting. */
  | { kind: 'ok'; wait: PlaybackStatus[]; timeoutMs: number }
  /** Invalid parameter → route returns 400 (with clear reason, no silent fallback). */
  | { kind: 'error'; error: string };

/**
 * Parse `?wait=<state[,state]>` and `?timeout=<ms>` (required in pairs, see openapi.yaml for rules).
 *
 * wait supports comma lists: there are three final states. Just waiting for ended will wait for the entire timeout in
 * vain, so let the caller tell itself which ones it is waiting for. timeout only accepts non-negative integers from
 * 0.. MAX_PLAYBACK_WAIT_MS, `0` is valid (next tick returns immediately).
 */
export function parseWaitQuery(waitRaw: string | null, timeoutRaw: string | null): WaitParse {
  if (waitRaw === null && timeoutRaw === null) return { kind: 'none' };
  if (waitRaw === null || timeoutRaw === null) {
    return { kind: 'error', error: 'wait and timeout must be used together' };
  }
  const wait = waitRaw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');
  const bad = wait.find((s) => !isPlaybackStatus(s));
  if (wait.length === 0 || bad !== undefined) {
    return { kind: 'error', error: `invalid wait status: ${bad ?? waitRaw}` };
  }
  if (!/^\d+$/.test(timeoutRaw)) {
    return { kind: 'error', error: `invalid timeout (expect 0..${MAX_PLAYBACK_WAIT_MS})` };
  }
  const timeoutMs = Number(timeoutRaw);
  if (!Number.isFinite(timeoutMs) || timeoutMs > MAX_PLAYBACK_WAIT_MS) {
    return { kind: 'error', error: `invalid timeout (expect 0..${MAX_PLAYBACK_WAIT_MS})` };
  }
  // Go through isPlaybackStatus item by item before narrowing it down: wait is an external input and cannot rely on the caller to follow the rules.
  return { kind: 'ok', wait: wait as PlaybackStatus[], timeoutMs };
}
