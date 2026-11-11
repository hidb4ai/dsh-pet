/**
 * Determination of playback status: valid status, final status and reportable set, as well as record retention time.
 * The vocabulary is at `shared/playback.ts` , shared by both ends; here we only answer "Can this state still change"
 * and bring the host's retention policy. It must always be true: the final state set and the reportable set are
 * mutually exclusive, and the final state cannot be changed again. See contracts API.md and openapi.yaml.
 * @module dsh-pet/src/host/playback/status
 */
import { REPORTABLE_STATUSES, TERMINAL_STATUSES, type PlaybackStatus } from '../../shared/playback.ts';

export { REPORTABLE_STATUSES, TERMINAL_STATUSES, type PlaybackStatus };

/** Final state record retention time (ms): Allow the caller to have time to find the final state and then clean it up. */
export const PLAYBACK_KEEP_MS = 60 * 1000;

/**
 * `?timeout=` upper limit (ms): the capped length of waiting time to prevent the caller from hanging the connection.
 * The value is conservative: DSH WebServer. Whether an idle timeout is set for long-term held responses has not yet
 * been verified, so it will be set to 10 s first.
 */
export const MAX_PLAYBACK_WAIT_MS = 10 * 1000;

/** Set for final state determination. */
const TERMINAL = new Set<string>(TERMINAL_STATUSES);

/** The set for judgment can be reported. */
const REPORTABLE = new Set<string>(REPORTABLE_STATUSES);

/** Is this state a final state? */
export const isTerminalStatus = (s: string): boolean => TERMINAL.has(s);

/** Is this character string a valid status name (including accepted on the host side) - use it for the validity check of `?wait=`. */
export const isPlaybackStatus = (s: string): boolean => s === 'accepted' || REPORTABLE.has(s);

/** Whether this status is allowed to be reported by the renderer. */
export const isReportableStatus = (s: string): boolean => REPORTABLE.has(s);
