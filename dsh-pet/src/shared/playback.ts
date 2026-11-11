/**
 * Glossary of playback status: host acceptance (`accepted`), the four statuses that renderer can report, and which are
 * the final statuses. Both ends share the same definition: the state machine of the host and the receipt on the
 * browser side are taken from this, to avoid writing a set of literals each and ending up mismatching. Not a state
 * machine: the transition rules are in host `playback` , where there are only words.
 * @module dsh-pet/src/shared/playback
 */

/** Playback status: `accepted` is written by the host, and the rest is reported by the renderer. */
export type PlaybackStatus = 'accepted' | 'playing' | 'ended' | 'failed' | 'cancelled';

/** The renderer is allowed to report status (`accepted` is the host acceptance status, and the renderer is not allowed to write). */
export type ReportableStatus = 'playing' | 'ended' | 'failed' | 'cancelled';

/** Final state: cannot be changed after reaching it. */
export const TERMINAL_STATUSES: readonly PlaybackStatus[] = ['ended', 'failed', 'cancelled'];

/** The set of statuses that renderer can report. */
export const REPORTABLE_STATUSES: readonly ReportableStatus[] = ['playing', 'ended', 'failed', 'cancelled'];
