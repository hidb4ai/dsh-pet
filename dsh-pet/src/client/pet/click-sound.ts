/**
 * Click sound effect: single instance audio, press the key and click throttling, if the playback fails, it will be
 * silent (there should be no error if there is no sound). The switch is driven by the finished configuration: it is
 * kept silent until the configuration is loaded to prevent the user from making a sound after closing the settings
 * page. It is a module-level singleton (not one for each pet), and it will only ring once if it is opened multiple
 * times at the same time.
 * @module dsh-pet/src/client/pet/click-sound
 */
import { ROUTE_PATH } from '../../shared/constants.ts';

/** Sound effect file address. */
const CLICK_SOUND_URL = ROUTE_PATH + '/sound/click-duck.wav';
/** Volume: The same level as other prompt tones, so as not to steal the conversation content. */
const CLICK_SOUND_VOLUME = 0.5;
/** Connected dots throttling: only rings once within 100 ms to prevent connected dots from turning into noise. */
const CLICK_SOUND_THROTTLE_MS = 100;

/** audio instance of reuse, created when playing for the first time. */
let clickAudio: HTMLAudioElement | null = null;
/** The timestamp of the last real playback (ms). */
let lastClickSoundAt = 0;
/** Click the sound effect switch; keep the sound muted until the configuration is loaded. */
let clickSoundEnabled = false;

/**
 * Turn on or off click sound effects.
 *
 * @param enabled - `clickSoundEnabled` in finished configuration.
 */
export function setClickSoundEnabled(enabled: boolean): void {
  clickSoundEnabled = enabled;
}

/** Play click sound; returns silently when switch is off, throttling, or audio is unavailable. */
export function playClickSound(): void {
  if (!clickSoundEnabled) return;
  const now = Date.now();
  if (now - lastClickSoundAt < CLICK_SOUND_THROTTLE_MS) return;
  lastClickSoundAt = now;
  try {
    clickAudio ??= new Audio(CLICK_SOUND_URL);
    clickAudio.volume = CLICK_SOUND_VOLUME;
    clickAudio.currentTime = 0;
    void clickAudio.play().catch(() => {});
  } catch {
    /* Audio not available, silently ignored. */
  }
}
