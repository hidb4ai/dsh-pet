/**
 * Work status broadcast: When the state enters the "system notification popup" state, read out the desktop pet's lines.
 *
 * Only follows the DSH web page, and the desktop transparent window does not participate - the same boundary as
 * client/notify.ts: system notifications only pop up on the web page, and the working status is broadcast in the same
 * way. Do not write `say` leaves, do not touch `voiceTo` : This is a matter of working status, not bubble. The lines
 * only take the `workStatusTexts` of that state, not the `task` (task details, often dialogue fragments or paths).
 * @module dsh-pet/src/client/voice-notify
 */
import { petBridge } from './settings/bridge.ts';
import { isPageActive } from './notify.ts';
import { isVoiceNotifyEnabled, speakNotice } from '../shared/voice.ts';
import { WORK_STATUS_INDEX, type WorkStatusSnapshot, type WorkStatusState } from '../shared/work-status.ts';
import type { Pet } from '../shared/types.ts';

/** The system notification will pop up: waiting for your confirmation / completion / error. The remaining states only play animations and make no sound. */
const SPOKEN_STATES: readonly WorkStatusState[] = ['waiting', 'success', 'error'];

/** The state that was recited last time; the same state will not be recited if it is written repeatedly. It will be reset to null when it is idle. It can be recited again next time. */
let lastSpoken: WorkStatusState | null = null;

/**
 * Determine whether and what to recite for this beat.
 *
 * Only take the lines in the configuration, do not read `task` : `task` is the task details (often a dialogue fragment
 * or file path), and it sounds like reading a log; what is needed here is a sentence spoken by the pet itself.
 *
 * @param snap - Working status snapshot; only `state` is used.
 * @param pets - List of currently flat pets; take the line group of the first pet, and only read it once for multiple
 * pets.
 * @param prev - the state read last time.
 * @returns The lines to be read; when the state does not change, the state does not make a sound, or the state has no
 * lines, it returns to undefined.
 */
export function decideWorkStatusLine(
  snap: WorkStatusSnapshot,
  pets: readonly Pet[],
  prev: WorkStatusState | null,
): string | undefined {
  if (snap.state === null || snap.state === prev) return undefined;
  if (!SPOKEN_STATES.includes(snap.state)) return undefined;
  const cfg = pets[0];
  if (cfg === undefined) return undefined;
  const group = Array.isArray(cfg.workStatusTexts) ? cfg.workStatusTexts[WORK_STATUS_INDEX[snap.state]] : undefined;
  if (!Array.isArray(group) || group.length === 0) return undefined;
  return group[Math.floor(Math.random() * group.length)];
}

/**
 * The working status of consumption one-shot: read only when the state is changed and the system notification will pop
 * up for the new state.
 *
 * @param snap - The working status snapshot just read.
 */
export function speakWorkStatus(snap: WorkStatusSnapshot): void {
  const line = decideWorkStatusLine(snap, petBridge.current, lastSpoken);
  // lastSpoken advances as usual when the switch is turned off: a past state will not be recited after it is turned back on.
  lastSpoken = snap.state;
  if (line === undefined || !isVoiceNotifyEnabled()) return;
  // The same orientation as the system notification: the user does not read when looking at this page - the animation and overhead bubble have already given the information.
  if (isPageActive()) return;
  speakNotice(line);
}

/** Clear the deduplicate status so that you can still read the next time you enter the same state.  @internal */
export function resetSpokenState(): void {
  lastSpoken = null;
}
