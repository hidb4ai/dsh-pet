/**
 * "Press and hold to talk" controls: four states of the microphone button, recording, and recognition result
 * placement.
 *
 * It is a separate module because it has independent failure modes and lifecycles: microphone rejected, muted, host
 * not recognized, network failure are different, and it has a four-state state machine and two timers - there is no
 * common change reason with "uploading pictures, taking screenshots". DOM is not created, the pop-up window is opened
 * and closed, and is not sent; the elements and prompt lines are handed in by the caller (chat/dom).
 * @module dsh-pet/src/shared/chat/hear-control
 */
import {
  MAX_RECORD_MS,
  MIN_RECORD_MS,
  SILENCE_PEAK,
  canRecord,
  hearAudio,
  startRecording,
  toBase64,
  type HearOutcome,
  type HearRecorder,
} from '../hear.ts';

/** Four states in the recording stage: `starting` is the short section waiting for microphone authorization, and `transcribing` is waiting for the recognition result. */
type HearState = 'idle' | 'starting' | 'recording' | 'transcribing';

/** There are three ways to use the prompt line: permanent display, folding, and automatic folding after display. */
export interface HearHint {
  /** Displayed permanently until hide. */
  show: (text: string) => void;
  hide: () => void;
  /** Display and automatically close after a short period of time. */
  flash: (text: string) => void;
}

/** The control requires an element with a callback. */
export interface HearControlOptions {
  /** Microphone button: The status is drawn on its `data-hear`, and the pointer event is also bound by this module. */
  readonly micBtn: HTMLButtonElement;
  /** The landing point of the recognition result: the text is inserted at the cursor. */
  readonly input: HTMLTextAreaElement;
  /** Both progress and failure prompts go to this line. */
  readonly hint: HearHint;
  /** Recalculate the input box size after inserting text. */
  readonly resizeInput: () => void;
  /** Identification address; an empty string indicates that this entry point is not recognized. */
  readonly hearUrl: string;
}

/** The control only exposes four actions to the outside world. */
export interface HearControl {
  /** Start recording; if recording fails, give a reason and do nothing while recording. */
  start: () => void;
  /** cleanup; do nothing when not recording. */
  stop: () => void;
  /** Whether it is really collecting at this moment: press the shortcut key to decide whether it is on or off. */
  isHearing: () => boolean;
  /** Stop the ongoing recording and clear the timer; called when closing the pop-up window. */
  dispose: () => void;
}

/**
 * Create a hold-to-talk control.
 *
 * @param opts - microphone button, input box, prompt line, size recalculation and identification address.
 * @returns has three actions: start, cleanup and release.
 */
export function createHearControl(opts: HearControlOptions): HearControl {
  const { micBtn, input, hint, resizeInput, hearUrl } = opts;
  let hearState: HearState = 'idle';
  let recorder: HearRecorder | null = null;
  let hearTimer = 0;
  /** Let go before getting the microphone: cleanup immediately after startRecording returns to avoid leaving the microphone on. */
  let wasReleasedEarly = false;

  /** Button appearance: painted red during the recording phase and disabled during the recognition phase (to avoid clicking it twice). */
  const paint = (): void => {
    if (hearState === 'starting' || hearState === 'recording') micBtn.dataset.hear = 'recording';
    else delete micBtn.dataset.hear;
    micBtn.disabled = hearState === 'transcribing';
  };

  /** The reason why it cannot be recorded now; when it can be recorded, it will give an empty string. */
  const blockedReason = (): string => {
    if (!canRecord()) return '当前地址不支持录音：用 https 或 localhost 打开才有麦克风';
    if (hearUrl === '') return '这个入口没有接上识别地址';
    return '';
  };

  /** Connect the recognition result at the cursor (replace the current selection), and return the focus to the input box. */
  const insertText = (text: string): void => {
    const from = input.selectionStart ?? input.value.length;
    const to = input.selectionEnd ?? from;
    input.value = input.value.slice(0, from) + text + input.value.slice(to);
    const caret = from + text.length;
    input.setSelectionRange(caret, caret);
    resizeInput();
    // The desktop side relies on focusin to replenish the system keyboard focus to the main process (DOM focus on X11 is not equal to the keyboard focus)
    input.focus();
  };

  /** Translate the reason for failure into adult language; attach the message given by the host to facilitate troubleshooting in the log. */
  const describeFailure = (outcome: Extract<HearOutcome, { ok: false }>): string => {
    if (outcome.reason === 'unsupported') return '这个宿主没开语音识别';
    if (outcome.reason === 'bad-request') return '音频没通过宿主校验';
    if (outcome.reason === 'network') return '识别请求失败：' + outcome.message;
    return '识别失败：' + (outcome.message || '未知原因');
  };

  /** cleanup: stop collection → judge as false touch → judge as mute → send host → text falls into the input box. If it fails, it will only prompt and the entered text will not be affected. */
  const stop = async (): Promise<void> => {
    const current = recorder;
    if (!current) return;
    recorder = null;
    window.clearInterval(hearTimer);
    // Accidental touch (press and release): silently discard. Keep the pop-ups and not the prompts - recording for
    // tens of milliseconds has nothing to do with the quality of the microphone. Reporting "no sound heard" will only
    // lead people in the wrong direction.
    if (current.elapsedMs() < MIN_RECORD_MS) {
      current.cancel();
      hearState = 'idle';
      paint();
      hint.hide();
      return;
    }
    hearState = 'transcribing';
    paint();
    hint.show('识别中…');
    try {
      const clip = await current.stop();
      if (clip === null) {
        hint.flash('没录到声音');
        return;
      }
      if (clip.peak < SILENCE_PEAK) {
        // The microphone is on but there is no signal (the device is muted/the headphones are not put on): Don’t give up the recognition once in vain.
        hint.flash('没听到声音，检查一下麦克风');
        return;
      }
      if (!input.isConnected) return; // The pop-up window has been closed while waiting for the result.
      const outcome = await hearAudio(hearUrl, toBase64(clip.wave));
      if (!input.isConnected) return;
      if (!outcome.ok) {
        hint.flash(describeFailure(outcome));
        return;
      }
      const text = outcome.text.trim();
      if (text === '') {
        hint.flash('没听清，再说一次');
        return;
      }
      hint.hide();
      insertText(text);
    } catch (e) {
      hint.flash('录音出错：' + (e instanceof Error ? e.message : String(e)));
    } finally {
      hearState = 'idle';
      paint();
    }
  };

  /** Start recording: Ask for the microphone first, and then start timing when you get it. */
  const start = async (): Promise<void> => {
    const blocked = blockedReason();
    if (blocked !== '') {
      hint.flash(blocked);
      return;
    }
    if (hearState !== 'idle') return;
    // Return the focus: press and hold to speak without looking at the focus. Once the input box touches the keyboard,
    // the v that falls in will become character. After recognition, insertText will refocus and press Enter to send as
    // usual.
    if (document.activeElement === input) input.blur();
    hearState = 'starting';
    wasReleasedEarly = false;
    paint();
    hint.show('正在打开麦克风…');
    try {
      recorder = await startRecording();
    } catch (e) {
      hearState = 'idle';
      paint();
      hint.flash('打不开麦克风：' + (e instanceof Error ? e.message : String(e)));
      return;
    }
    if (wasReleasedEarly) {
      void stop();
      return;
    }
    hearState = 'recording';
    paint();
    hearTimer = window.setInterval(() => {
      const rec = recorder;
      if (!rec) return;
      if (rec.elapsedMs() >= MAX_RECORD_MS) {
        void stop(); // Automatically cleanup when the upper limit is reached, no need to wait to let go
        return;
      }
      const total = Math.floor(rec.elapsedMs() / 1000);
      hint.show('录音中 ' + Math.floor(total / 60) + ':' + String(total % 60).padStart(2, '0') + ' · 松开结束');
    }, 200);
  };

  micBtn.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault(); // Don’t take the focus away from the input box, and don’t trigger the selection
    try {
      // Capture pointer: When you let go, the mouse may have moved out of the button or even out of the window, relying on it to receive pointerup
      micBtn.setPointerCapture(e.pointerId);
    } catch {
      /* The pointer is no longer in focus (window out of focus/synthesis event): if you can’t let go, wait for the upper limit of 24 seconds fallback */
    }
    void start();
  });
  /** If you let go or the pointer is snatched away by the system (cutting the window), it will be considered finished; while you are still waiting for the microphone, make a note of it, and cleanup immediately when it comes back. */
  const onRelease = (): void => {
    if (hearState === 'starting') {
      wasReleasedEarly = true;
      return;
    }
    if (hearState === 'recording') void stop();
  };
  micBtn.addEventListener('pointerup', onRelease);
  micBtn.addEventListener('pointercancel', onRelease);

  return {
    start: () => void start(),
    stop: () => void stop(),
    isHearing: () => hearState === 'recording',
    dispose: () => {
      window.clearInterval(hearTimer);
      // The microphone must be released immediately when closing the pop-up window: it is discarded directly during recording without waiting for recognition.
      if (recorder) {
        recorder.cancel();
        recorder = null;
      }
      hearState = 'idle';
    },
  };
}
