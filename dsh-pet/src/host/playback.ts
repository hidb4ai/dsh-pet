/**
 * Public exit of playback receipt: status determination, path analysis and record table.
 *
 * Only re-export, logical separation ./playback/. It must always be true: the record is only reported and advanced by
 * the renderer, and the host does not guess the playback result.
 * @module dsh-pet/src/host/playback
 */
export {
  MAX_PLAYBACK_WAIT_MS,
  PLAYBACK_KEEP_MS,
  REPORTABLE_STATUSES,
  TERMINAL_STATUSES,
  isPlaybackStatus,
  isReportableStatus,
  isTerminalStatus,
} from './playback/status.ts';
export type { PlaybackStatus } from './playback/status.ts';
export { parsePlaybackPath, parseWaitQuery } from './playback/parse.ts';
export type { WaitParse } from './playback/parse.ts';
export { PlaybackStore } from './playback/store.ts';
export type { PlaybackRecord, ReportOutcome, WaitArgs } from './playback/store.ts';
