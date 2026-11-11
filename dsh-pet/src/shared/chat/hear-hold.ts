/**
 * Hover shortcut key for "Press and Talk": press and hold `M` to start recording, release to cleanup.
 *
 * What matters is the "press to release" period, not a single button press. Pressing the same criterion as other hover
 * keys for the first time ({@link isBareKey}: typing in the input box, contenteditable does not count), otherwise m in
 * Pinyin will be regarded as opening the record; after entering the hold state, the focus will no longer be judged -
 * the input box is blur when opening the record, and the keydown that the system continues to reissue during the
 * period must be accepted as ordered. If one is missed, character will be filled into the box. Only the judgment and
 * status are done, DOM and recording are not touched.
 * @module dsh-pet/src/shared/chat/hear-hold
 */
import { isBareKey } from '../hotkey.ts';
import type { HotkeyEvent } from '../hotkey.ts';

/** The lowercase form of the target key: the judgment and the state machine share this one to avoid writing a literal in each place. */
const HEAR_KEY = 'm';

/** Display text of shortcut keys (for settings page). Keeps the same fact as the keys {@link isHearHotkey}. */
export const HEAR_HOTKEY_HINT = 'M 键';

/**
 * Should this press be taken over by "Press and Talk": It shares the same criteria as other hover keys.
 *
 * @param e - keyboard event.
 * @returns When `M` (including uppercase letters) is pressed naked and the focus is not on the editable element, it is
 * true.
 */
export function isHearHotkey(e: HotkeyEvent): boolean {
  return isBareKey(e, HEAR_KEY);
}

/** Pre-criteria and two actions of the state machine. */
export interface HearHoldHooks {
  /**
   * Should it now respond to pressing: the mouse is parked on this pet, or the focus is on the pet's own pop-up
   * window.
   *
   * The latter one leaves the path of "focusing on non-editable elements such as the microphone button"; typing in the
   * input box is blocked by {@link isHearHotkey} .
   */
  isArmed: () => boolean;
  /** Press: Open the conversation pop-up window and start recording. */
  onPress: () => void;
  /** Release: End recording and wait for the recognition result. */
  onRelease: () => void;
}

/** Press and hold the state machine: hold one at each end, and the keyboard events will be transferred in unchanged. */
export interface HearHold {
  /** Process keydown; returning true means that this event has been eaten, and the caller must be `preventDefault`. */
  onKeyDown: (e: HotkeyEvent & { readonly repeat?: boolean }) => boolean;
  /** Process keyup; only recognize the release of the key to start recording, and ignore the rest. */
  onKeyUp: (e: Pick<HotkeyEvent, 'key'>) => void;
  /** Forced cleanup (when the window is out of focus or pet unmount cannot receive keyup); nothing will be done when it is not pressed. */
  release: () => void;
}

/**
 * Create a press and hold state machine.
 *
 * @param hooks - pre-criteria and press/release action.
 * @returns Three processors for caller wiring.
 */
export function createHearHold(hooks: HearHoldHooks): HearHold {
  let holding = false;
  /** Just compare the key name: the focus has been given to the input box during the press and hold period, and the criterion of "not in an editable element" can no longer be applied. */
  const sameKey = (key: string): boolean => String(key).toLowerCase() === HEAR_KEY;

  const release = (): void => {
    if (!holding) return;
    holding = false;
    hooks.onRelease();
  };

  return {
    onKeyDown(e) {
      // Press and hold: all the events of the same key (mainly automatic repeats) will be eaten, and the one that slips through will be entered into the input box.
      if (holding) return sameKey(e.key);
      if (e.repeat === true || !isHearHotkey(e) || !hooks.isArmed()) return false;
      holding = true;
      hooks.onPress();
      return true;
    },
    onKeyUp(e) {
      if (sameKey(e.key)) release();
    },
    release,
  };
}
