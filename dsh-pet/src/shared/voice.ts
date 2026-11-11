/**
 * End-side voice broadcast: Press `say` to decide whether to read this sentence, and synthesis request and playback.
 *
 * Both ends have their own decisions: whichever end the `voiceTo` in the leaf points to, only that end will make a
 * sound; default = no one reads it. On the web page, there is an additional "page visible" - the page that is cut to
 * the background is not viewed by anyone, and the sound is just an interruption. The beginning and end of each
 * sentence are {@link subscribeVoiceUtterance} broadcasted: the speaking bubble determines when to close it. Not
 * responsible for synthesis and caching: those on the host side (`/voice/speak`).
 * @module dsh-pet/src/shared/voice
 */
import { ROUTE_PATH } from './constants.ts';
import type { VoiceTarget } from './state.ts';

/** Current voice; empty string = not specified, the host uses the default voice. */
let voiceName = '';
/** Playback volume coefficient (0–1, 1 = maximum volume); shared by both ends, only affects playback and does not affect the synthesized audio. */
let voiceVolume = 1;
/** Working status broadcast switch; this is read only when the resolved configuration is clearly true. */
let notifyEnabled = false;
/** Is this terminal a web page or a desktop terminal? `null` = It has not been declared yet, and it will not be played at this time. */
let surface: VoiceTarget | null = null;
/** Interface base address: The web page has the same origin prefix, and the desktop side has changed from `setVoiceBase` to bridge address. */
let voiceBase = ROUTE_PATH;
/** Whether the configuration is ready; the web page is set by `setVoiceConfig`, and the desktop is lazy loaded when playing for the first time. */
let configLoaded = false;
/** Current broadcast status; bubble displays icon accordingly. */
let voiceState: VoiceState = 'idle';
/** Status subscriber: The speech bubbles at both ends render icons accordingly. */
const stateListeners = new Set<(state: VoiceState) => void>();
/** The subscriber who announces the start/end of the broadcast: the talk bubble hangs accordingly with cleanup. */
const utteranceListeners = new Set<(event: VoiceUtteranceEvent) => void>();
/** Broadcast sequence number; it will be incremented every time it is decided to read a sentence. It is used to let bubble discard the late "previous sentence has been played". */
let utteranceSeq = 0;

/** There are four states of voice broadcast to the outside world; it is only used for display and does not accept external drivers. `failed` = This synthesis failed. */
export type VoiceState = 'idle' | 'loading' | 'ready' | 'failed';

/**
 * The start and end events of a sentence broadcast.
 *
 * `text` is the original text on bubble, not the truncated text sent to synthesis - bubble needs to click it to
 * recognize the sentence: multiple pets on the same page share the singleton state of this module. If you don't
 * recognize the sentence, the other person's sentence will be counted on yourself.
 */
export type VoiceUtteranceEvent =
  | { readonly kind: 'start'; readonly seq: number; readonly text: string }
  | { readonly kind: 'end'; readonly seq: number; readonly text: string };

/**
 * The upper limit of the synthesis result of the client (ms).
 *
 * A little wider than the total timeout on the host side (28 s): Let the host timeout first and report structural
 * failure. The client is just a fallback to prevent the bubble from never stopping when the upstream hangs.
 */
const SPEAK_TIMEOUT_MS = 30_000;

/**
 * The upper limit of waiting for a sentence to be played (ms).
 *
 * A little wider than the bubble's own upper limit of suspension (50 s): a normal single sentence is much smaller than
 * it. If it has not yet been cleaned up, it means that the playback line has been broken. At this time, press cleanup
 * to handle it, so that the bubble will not hang permanently.
 */
export const PLAYBACK_WAIT_MAX_MS = 60_000;

/** Timeout signal of synthesis request; automatic broadcast and manual playback request share the same conventions. */
function speakSignal(): AbortSignal {
  return AbortSignal.timeout(SPEAK_TIMEOUT_MS);
}

/** Switch the status and notify the subscriber; no repeated notifications with the same value. */
function setVoiceState(next: VoiceState): void {
  if (voiceState === next) return;
  voiceState = next;
  for (const listener of stateListeners) listener(next);
}

/**
 * Read the current broadcast status; the desktop side gets it directly when redrawing the bubble (it does not have the
 * subscribe mechanism of react).
 * @returns `idle` / `loading` / `ready` .
 */
export function getVoiceState(): VoiceState {
  return voiceState;
}

/**
 * subscribe broadcast status; when subscribe, the current value will be received immediately.
 * @param listener - status change callback.
 * @returns unsubscribe; must be called when component unmount/bubble is closed.
 */
export function subscribeVoiceState(listener: (state: VoiceState) => void): () => void {
  stateListeners.add(listener);
  listener(voiceState);
  return () => {
    stateListeners.delete(listener);
  };
}

/**
 * subscribe The beginning and end of each sentence broadcast; historical status is not reissued, only subsequent
 * events are reported.
 *
 * @param listener - event callback: `start` means that you have decided to read this sentence (synthesis starts),
 * `end` means that the playback is completed, synthesis failed or timed out - all three endings will be reported once,
 * and bubble does not need to determine the timeout by itself.
 * @returns unsubscribe; must be called when the card is unmounted or the bubble is closed.
 */
export function subscribeVoiceUtterance(listener: (event: VoiceUtteranceEvent) => void): () => void {
  utteranceListeners.add(listener);
  return () => {
    utteranceListeners.delete(listener);
  };
}

/** Broadcast a reporting event; a single subscriber throwing an error cannot block other subscribers. */
function emitUtterance(event: VoiceUtteranceEvent): void {
  for (const listener of utteranceListeners) listener(event);
}

/**
 * Replace the interface base address; the desktop side adjusts it once when loading the module (the `file://` page
 * cannot use relative paths).
 * @param base - Address with prefix, such as `dsh-pet-bridge://dsh-pet/dsh-pet-7340` .
 */
export function setVoiceBase(base: unknown): void {
  if (typeof base === 'string' && base) voiceBase = base;
}

/**
 * Declare whether this end is the web page or the desktop end; each end should be adjusted once at startup. Do not
 * press the `say` leaf to play when there is no announcement - I would rather have no sound than speak for the other
 * end.
 * @param next - `web` / `desktop` ; other values are ignored.
 */
export function setSurface(next: unknown): void {
  if (next === 'web' || next === 'desktop') surface = next;
}

/**
 * Record the voice and volume in the resolved configuration; adjust it once when the web page reads `/config`
 * . Once called, the configuration is deemed to be ready, and subsequent playback will no longer need to be done by
 * yourself.
 *
 * @param name - voice id (non-character strings are not specified).
 * @param volume - Volume coefficient (0–1); default or non-numeric value plays at maximum volume.
 */
export function setVoiceConfig(name: unknown, volume?: unknown): void {
  voiceName = typeof name === 'string' ? name : '';
  voiceVolume = clampVolume(volume);
  configLoaded = true;
}

/**
 * Record working status broadcast switch; adjust it once when the web page reads `/config` .
 *
 * @param on - `main.voiceNotifyEnabled` in off-the-shelf configuration; only strictly `true` is considered enabled.
 */
export function setVoiceNotifyEnabled(on: unknown): void {
  notifyEnabled = on === true;
}

/** Whether the working status broadcast is turned on. */
export function isVoiceNotifyEnabled(): boolean {
  return notifyEnabled;
}

/** Converg the volume to 0–1; non-numeric values are treated as maximum volume (1) - dirty configuration should not quietly change the sound to 0. */
function clampVolume(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 1;
}

/** Lazy loading of resolved configuration; failure will be handled as "no broadcast", and only tried once (to avoid sending requests for each sentence). */
async function loadConfigOnce(): Promise<void> {
  if (configLoaded) return;
  try {
    const response = await fetch(voiceBase + '/config', { cache: 'no-store' });
    const body = (await response.json()) as { main?: Record<string, unknown> } | null;
    const main = body?.main;
    voiceName = typeof main?.voiceName === 'string' ? main.voiceName : '';
    voiceVolume = clampVolume(main?.voiceVolume);
    setVoiceNotifyEnabled(main?.voiceNotifyEnabled);
    // Set only if successful: Unable to pull (bridge is not ready/momentary failure), leave it to the next sentence to
    // try again - otherwise, one failure will permanently mute this end.
    configLoaded = true;
  } catch {
    /* If it cannot be pulled, keep it closed: I would rather have no sound than random broadcast. */
  }
}

/**
 * Press `say` to play the leaf: the player will read the name after the leaf is called.
 *
 * Two doors: whether the leaf has named the local page → whether the page on the web page is visible. Whether to read
 * or not is decided by the host when writing the leaf.
 *
 * @param say - Which sentence should be read: `text` text, `voiceTo` which end should be read.
 */
export function playSayVoice(say: { readonly text: string; readonly voiceTo?: VoiceTarget }): void {
  const isMine = say.voiceTo !== undefined && say.voiceTo === surface;
  if (!say.text || !isMine) {
    setVoiceState('idle');
    return;
  }
  if (surface === 'web' && typeof document !== 'undefined' && document.hidden) {
    setVoiceState('idle');
    return;
  }
  void speakWhenReady(say.text); // No await: Playback is bypass and cannot block bubbles and animations
}

/**
 * Start broadcasting after the configuration is ready; the first call on the desktop will pull `/config` .
 *
 * @param text - the entire sentence to be read.
 * @param canPlayHidden - Whether to continue playing when the page is hidden; the default is `false` (muted when
 * hidden).
 */
async function speakWhenReady(text: string, canPlayHidden = false): Promise<void> {
  await loadConfigOnce();
  const seq = ++utteranceSeq;
  // Report first and then set loading: The bubble depends on this event to suspend and close the timing. If it is a step later, it may have closed.
  emitUtterance({ kind: 'start', seq, text });
  setVoiceState('loading');
  try {
    await speak(text, canPlayHidden);
  } finally {
    // Success, failure, and timeout all go here: bubble is waiting for this cleanup. If it fails once, it will hang forever.
    emitUtterance({ kind: 'end', seq, text });
  }
}

/**
 * Read a system prompt that has nothing to do with bubbles (working status broadcast).
 *
 * Whether to read or not is determined by the caller. It shares the same single slot with other automatic
 * announcements - the next sentence cuts out the previous one.
 *
 * @param text - the entire sentence to be read; empty string is skipped directly.
 */
export function speakNotice(text: string): void {
  if (text === '') return;
  // Allow background playback: The user is in other applications when it needs to make a sound.
  void speakWhenReady(text, true);
}

/**
 * Wait until this sentence is actually finished.
 *
 * `play()` 's Promise is resolve when it "starts broadcasting", while bubble wants to "end broadcasting": the
 * difference between the two is the whole reason why bubble is closed in advance. So here we wait for the cleanup
 * signal and use {@link PLAYBACK_WAIT_MAX_MS} fallback.
 *
 * @param audio - The element being played.
 * @param objectUrl - blob address to be released during cleanup.
 */
function waitForPlaybackEnd(audio: HTMLAudioElement, objectUrl: string): Promise<void> {
  return new Promise<void>((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const finish = (): void => {
      if (settled) return; // ended and pause will arrive one after another and only end once
      settled = true;
      if (timer !== null) clearTimeout(timer);
      URL.revokeObjectURL(objectUrl);
      resolve();
    };
    timer = setTimeout(finish, PLAYBACK_WAIT_MAX_MS);
    timer.unref?.(); // Same strategy as host-side timer: don’t nail this wait into the event loop
    audio.onended = finish;
    audio.onerror = finish;
    audio.onpause = finish; // Upvoted by the next sentence or paused by the user: it is also counted as cleanup, bubble should not wait for an audio that will not sound.
  });
}

/** Automatically broadcast the audio that is currently ringing: when a new sentence comes in, cut off the old one first, so that the saved string after turning off the screen and waking up will not sound overlapping. */
let autoAudio: HTMLAudioElement | null = null;
/** Automatically broadcast generation number: During synthesis, it may be overridden by an updated sentence, and the old result returned is discarded directly. */
let autoSeq = 0;

/** Whether the current sentence is allowed to continue playing when the page is hidden; change it with autoAudio and not make it a global switch. */
let autoAudioCanPlayHidden = false;

/**
 * Turn off the current automatic broadcast.
 *
 * Use pause instead of directly discarding the reference: `waitForPlaybackEnd` has been hung up. `onpause` cleanup,
 * the bubble can be closed as usual, and it will not wait for an audio that has stopped ringing.
 */
function stopAutoAudio(): void {
  const audio = autoAudio;
  // The mark must be cleared unconditionally: it must be cleared even when there is no audio, otherwise the next sentence will be biased by the allowed value of the previous sentence.
  autoAudio = null;
  autoAudioCanPlayHidden = false;
  if (audio === null) return;
  try {
    audio.pause();
  } catch {
    /* Player destroyed: ignore */
  }
}

// The page is muted when it is hidden (switch to background/screen off): it will not be replayed when it comes back. Notification broadcasts have their own background permission and are not affected by this article.
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && !autoAudioCanPlayHidden) stopAutoAudio();
  });
}

/**
 * Request synthesis and playback; if any step fails, it will fall to `failed` (leave a mute speaker on the bubble
 * instead of no icon at all).
 *
 * @param text - the entire sentence to be read.
 * @param canPlayHidden - Whether to continue playing when the page is hidden; default `false` .
 */
async function speak(text: string, canPlayHidden = false): Promise<void> {
  const token = ++autoSeq;
  stopAutoAudio();
  try {
    const response = await fetch(voiceBase + '/voice/speak', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, ...(voiceName ? { voice: voiceName } : {}) }),
      signal: speakSignal(),
    });
    if (token !== autoSeq) return;
    if (!response.ok || !(response.headers.get('content-type') ?? '').includes('audio')) {
      setVoiceState('failed');
      return;
    }
    const objectUrl = URL.createObjectURL(await response.blob());
    if (token !== autoSeq) {
      URL.revokeObjectURL(objectUrl);
      return;
    }
    const audio = new Audio(objectUrl);
    audio.volume = voiceVolume;
    // The page is hidden during synthesis: this sentence is not replayed and is discarded directly - unless this sentence comes with background permission (notification class).
    if (!canPlayHidden && typeof document !== 'undefined' && document.hidden) {
      URL.revokeObjectURL(objectUrl);
      setVoiceState('idle');
      return;
    }
    // The audio is ready. ready: The speaker indicates "This sentence has voice" and is not bound to the playback progress.
    setVoiceState('ready');
    autoAudioCanPlayHidden = canPlayHidden;
    autoAudio = audio;
    try {
      await audio.play(); // It only means the start of broadcast: If the broadcast fails, it will fall into failed, and there is no need to wait for cleanup.
    } catch {
      URL.revokeObjectURL(objectUrl);
      if (autoAudio === audio) {
        autoAudio = null;
        autoAudioCanPlayHidden = false;
      }
      setVoiceState('failed');
      return;
    }
    // The bubble is closed by the end event, so it must wait until the broadcast is finished: stopping at "already broadcast" will cause the bubble to disappear 1.5 seconds earlier.
    await waitForPlaybackEnd(audio, objectUrl);
    if (autoAudio === audio) autoAudio = null;
  } catch {
    /* Including timeout: the bubble has been displayed. If it fails, the rendering cannot be interrupted. Only the icon is changed to a silent speaker. */
    // The failure of the old request is too late to overwrite the new sentence status: the generation number has changed, which means that this sentence has been rejected.
    if (token === autoSeq) setVoiceState('failed');
  }
}

/** Manually playback the audio that is ringing during the request; cut out the old one before the new one to avoid overlapping the two sentences. */
let manualAudio: HTMLAudioElement | null = null;

/** Manual playback request is exposed to the outside world; `idle` = not playing (including interrupted), `failed` = synthesis failed. */
export type SpeakPhase = 'idle' | 'loading' | 'playing' | 'failed';

/** Generation number of manual playback request: The new playback request will invalidate the phase callback of the old request to prevent the old callback from clearing the new state. */
let manualSeq = 0;

/**
 * Manually announce a sentence (for the speaker button on the dialogue panel).
 *
 * The user specifies the playback request, and plays the synthesis after getting the text; the voice and volume take
 * the configured values.
 *
 * @param text - the text to be read.
 * @param onPhase - Stage callback: `loading` when requesting synthesis, `playing` when the audio is ready to start
 * playing, `idle` after playing, `failed` when it fails or times out.
 */
export function speakText(text: string, onPhase?: (phase: SpeakPhase) => void): void {
  if (!text) return;
  void playManual(text, onPhase);
}

/** Request synthesis and play manual playback request; failure is silent and does not interrupt panel interaction. */
async function playManual(text: string, onPhase?: (phase: SpeakPhase) => void): Promise<void> {
  const token = ++manualSeq;
  await loadConfigOnce();
  if (manualAudio) {
    manualAudio.pause();
    manualAudio = null;
  }
  if (token !== manualSeq) return; // I was clicked again while waiting for configuration: this time I gave way directly.
  onPhase?.('loading');
  try {
    const response = await fetch(voiceBase + '/voice/speak', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, ...(voiceName ? { voice: voiceName } : {}) }),
      signal: speakSignal(),
    });
    if (token !== manualSeq) return;
    if (!response.ok || !(response.headers.get('content-type') ?? '').includes('audio')) {
      onPhase?.('failed');
      return;
    }
    const objectUrl = URL.createObjectURL(await response.blob());
    if (token !== manualSeq) return;
    const audio = new Audio(objectUrl);
    audio.volume = voiceVolume;
    audio.onended = () => {
      URL.revokeObjectURL(objectUrl);
      if (manualAudio === audio) {
        manualAudio = null;
        onPhase?.('idle');
      }
    };
    audio.onerror = () => URL.revokeObjectURL(objectUrl);
    manualAudio = audio;
    onPhase?.('playing');
    await audio.play();
  } catch {
    /* Including timeout: There is still text in the panel, no error is played to interrupt reading, and the button is only changed to a failed state. */
    if (token === manualSeq) onPhase?.('failed');
  }
}
