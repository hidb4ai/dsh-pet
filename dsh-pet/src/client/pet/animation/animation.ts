/**
 * Self-broadcast animation chain: A/B double buffering source change, blob lifecycle, playback request receipt, and
 * determination of "what to do after this segment is played."
 *
 * Only touch the video element and its own internal state; the React state (anim / once / seq / bubble / orientation)
 * is not changed in this module. The parts that need to be changed are returned in the form of {@link EndedCue} /
 * {@link FreezeCue} and are executed by the component. This must always be true: there is only one pending source
 * change at the same time (the generation number discards late loads), and the receipt is reported before any return.
 * @module dsh-pet/src/client/pet/animation/animation
 */
import { isEventAnim } from '../../../shared/pickers.ts';
import { decideEndedCue, type EndedCue, type FreezeCue } from './cues.ts';
import type { ReportableStatus } from '../../../shared/playback.ts';
import type { Animations } from '../../../shared/types.ts';
import type { WorkStatusSnapshot } from '../../../shared/work-status.ts';
import { createAssetLoader, type AssetLoader } from './asset-loader.ts';
import { animationAssetUrl } from './assets.ts';
import { thumbExt } from './media.ts';

export type { EndedCue, FreezeCue };

/** The reason for source change failure and interruption falls into the `reason` field of the receipt. */
const REASON_ASSET_LOAD = 'asset-load';
const REASON_PLAY_REJECTED = 'play-rejected';
const REASON_DECODE = 'decode-error';
const REASON_SUPERSEDED = 'superseded';
const REASON_FROZEN = 'frozen';

/** Resource timeout (ms): DSH WebServer and occasionally stalled. If the resource times out, this source change will be discarded. */
const ASSET_FETCH_TIMEOUT_MS = 10_000;

/** Log timestamp: The same format as other pet logs, making it easier to compare the same event. */
const stamp = (petId: string): string => new Date().toTimeString().slice(0, 8) + ' pet=' + petId;

/** Pending source swap: generation number used to discard late load results. */
interface PendingSwap {
  anim: string;
  once: boolean;
  gen: number;
}

/** Animation chain dependencies: all use value functions to avoid capturing snapshots during the rendering period. */
export interface OwnAnimationDeps {
  /** A/B double buffered A element. */
  videoA: () => HTMLVideoElement | null;
  /** A/B double-buffered B element. */
  videoB: () => HTMLVideoElement | null;
  /** The resolved configuration of this pet: asset root, id and animation pool are all taken from it. */
  cfg: () => { id: string; assetRoot?: string; animations: Animations };
  /** Current animation name. */
  currentAnim: () => string;
  /** Working state leaf; empty when linkage is not enabled. */
  workStatus: () => WorkStatusSnapshot | null | undefined;
  /** The current orientation determines the mirror image. */
  facing: () => 'left' | 'right';
  /** Report the true status of third-party playback request. */
  report: (playbackId: string, status: ReportableStatus, reason?: string) => void;
  /** Consume the playback request number (clear the React status to avoid effect running again). */
  clearCuePlayback: () => void;
  /** The new animation is in place: the components are here to add Q bounce and movement drivers. */
  onFrontReady: (el: HTMLVideoElement) => void;
  /** The judgment result of the foreground completion; the component changes the React state accordingly. */
  onEnded: (cue: EndedCue) => void;
  /** Whether the user is pressing the pet (the animation chain is not advanced during dragging). */
  isDragging: () => boolean;
  /** Is it locked and frozen at the moment of mounting? */
  initiallyFrozen: boolean;
  /** asset loader; default implementation with timeout is used. */
  loader?: AssetLoader;
}

/** Animation chain’s external capabilities. */
export interface OwnAnimation {
  /** Change source playback; `cuePlaybackId` non-empty means this is a third-party playback request, and a receipt is required. */
  switchTo: (next: string, once: boolean, cuePlaybackId: string | null) => void;
  /** Determination of the end of the foreground broadcast; the receipt is reported here, and the React status is changed by the component according to cue. */
  handleEnded: (event?: Event) => EndedCue;
  /** Turn off the foreground loop and hang up ended: the looping state animation will stop after it finishes playing. */
  stopLoopingFront: () => void;
  /** Transfer the complete address to be used for the next source change (url form of third-party playback request). */
  setCueUrl: (url: string) => void;
  /** Freeze/unfreeze; only playback control and receipt are done, bubble and animation selection are handed over to components. */
  setFrozen: (next: boolean) => FreezeCue | null;
  /** Whether it is currently frozen (validation check of random chain and automatic source). */
  isFrozen: () => boolean;
  /** Foreground element; progress service reads it. */
  frontVideo: () => HTMLVideoElement | null;
  /** The playback request number being played; the self-playing animation is `null`. */
  playingPlayback: () => string | null;
  /** unmount cleanup: interrupt the request in transit, release blob, and cannot be used again. */
  dispose: () => void;
}

/**
 * Create an animation chain.
 *
 * @param deps - elements, configurations and callbacks.
 * @returns source change, broadcast completion determination, freeze control and cleaning.
 */
export function createOwnAnimation(deps: OwnAnimationDeps): OwnAnimation {
  /** Current front desk slot: 0 = A, 1 = B. */
  let front = 0;
  /** Pending source change; `null` = No source change waiting for the first frame. */
  let pending: PendingSwap | null = null;
  /** Change the source generation number, it will only increase but not decrease. */
  let gen = 0;
  /** The playback request address to be consumed is taken away at once. */
  let cueUrl: string | null = null;
  /** The playback request number being played. */
  let playing: string | null = null;
  /** Freeze flag: Only automatic sources are blocked, explicit commands are as normal. */
  let frozen = deps.initiallyFrozen;
  /** The blob addresses of the two slots respectively. When changing the source, release the old one first. */
  const blobUrl: { a: string | null; b: string | null } = { a: null, b: null };
  const loader = deps.loader ?? createAssetLoader(ASSET_FETCH_TIMEOUT_MS);
  /** Mount flag: Late loading results after unmount are discarded directly. */
  let mounted = true;

  const slotOf = (index: number): 'a' | 'b' => (index === 0 ? 'a' : 'b');
  const elementOf = (index: number): HTMLVideoElement | null => (index === 0 ? deps.videoA() : deps.videoB());

  const frontVideo = (): HTMLVideoElement | null => elementOf(front);

  /** Report and clear the "now playing" number; it is unclear when `keep` is true (the same number continues to play). */
  const reportOnce = (playbackId: string, status: ReportableStatus, reason?: string): void => {
    if (playing === playbackId) playing = null;
    deps.report(playbackId, status, reason);
  };

  const switchTo = (next: string, nextOnce: boolean, cuePlaybackId: string | null): void => {
    // One-time consumption playback request number: clear will make another trip to effect, and that trip will fall into the anti-replication branch.
    if (cuePlaybackId !== null) deps.clearCuePlayback();
    // The url handover bit is also taken at once, and must be earlier than any return: otherwise when the
    // anti-duplication branch returns early, it will be left until the next ordinary source change, and that animation
    // will be broadcast to this address by mistake.
    const cfg = deps.cfg();
    const url = cueUrl;
    cueUrl = null;
    if (next === '') return;
    if (pending !== null && pending.anim === next && pending.once === nextOnce) {
      // To prevent re-hits, the playback request must have a receipt to avoid the caller waiting for timeout.
      if (cuePlaybackId !== null) {
        playing = cuePlaybackId;
        deps.report(cuePlaybackId, 'playing');
      }
      return;
    }
    if (isEventAnim(cfg.animations.events, next)) {
      console.log('[dsh-pet] ' + stamp(cfg.id) + ' switch ' + next + ' once=' + nextOnce);
    }
    const swapGen = (gen += 1);
    pending = { anim: next, once: nextOnce, gen: swapGen };
    const targetIndex = front === 0 ? 1 : 0;
    const el = elementOf(targetIndex);
    if (el === null) return;
    el.loop = !nextOnce;
    el.muted = true;
    el.autoplay = true;
    el.playsInline = true;
    el.onended = nextOnce ? (event: Event) => deps.onEnded(handleEnded(event)) : null;
    // If element-level decoding fails, only one receipt will be added, and the playback control will not be changed; it will be cleared together with onended when changing sources.
    el.onerror = cuePlaybackId === null ? null : () => reportOnce(cuePlaybackId, 'failed', REASON_DECODE);
    // fetch + blob takes the entire file at once, bypassing video streaming and loading the occasional stalled on DSH WebServer.
    const assetUrl = animationAssetUrl({
      cueUrl: url,
      assetRoot: cfg.assetRoot ?? '',
      id: cfg.id,
      anim: next,
      ext: thumbExt(),
    });
    loader.load(assetUrl, {
      onObjectUrl: (objectUrl) => {
        if (!mounted) {
          loader.release(objectUrl); // Unmounted: No unclaimed addresses are left.
          return;
        }
        if (pending?.gen !== swapGen) {
          loader.release(objectUrl); // Overwritten by updated switch: this load is invalid.
          return;
        }
        const slot = slotOf(targetIndex);
        const previous = blobUrl[slot];
        if (previous !== null) loader.release(previous);
        blobUrl[slot] = objectUrl;
        el.src = objectUrl;
        el.load();
      },
      onError: (error) => {
        if (!mounted) return; // abort after unmount: silent.
        if (pending?.gen !== swapGen) return; // Overwritten by updated switch.
        pending = null; // Release pending source changes to prevent subsequent clicks from being trapped in the anti-reuse loop.
        if (cuePlaybackId !== null) reportOnce(cuePlaybackId, 'failed', REASON_ASSET_LOAD);
        console.warn(
          '[dsh-pet] Asset loading failed pet=' +
            cfg.id +
            ' anim=' +
            next +
            '：' +
            (error instanceof Error ? error.message : String(error)) +
            '(source switch already disposed)',
        );
      },
    });
    const onReady = (): void => {
      el.removeEventListener('loadeddata', onReady);
      if (pending?.gen !== swapGen) return;
      const outgoing = elementOf(front);
      el.classList.add('is-front');
      if (outgoing !== null && outgoing !== el) {
        outgoing.classList.remove('is-front');
        // If a video that has been downgraded to the background continues to play, the remaining onended will interrupt the current foreground animation: clear handler and stop playing.
        outgoing.onended = null;
        outgoing.onerror = null;
        outgoing.pause();
        // If the replaced playback request has not finished playing, cancelled will be returned truthfully (the supplement is for non-playback request interruptions such as clicks and drags).
        if (playing !== null && playing !== cuePlaybackId) reportOnce(playing, 'cancelled', REASON_SUPERSEDED);
      }
      front = front === 0 ? 1 : 0;
      pending = null;
      playing = cuePlaybackId;
      el.style.transform = deps.facing() === 'right' ? 'scaleX(-1)' : '';
      el.play()
        .then(() => {
          // Only the cashing of play() means that the painting has actually started, and loadeddata only means that it can be decoded.
          if (cuePlaybackId !== null) deps.report(cuePlaybackId, 'playing');
        })
        .catch(() => {
          if (cuePlaybackId !== null) reportOnce(cuePlaybackId, 'failed', REASON_PLAY_REJECTED);
        });
      deps.onFrontReady(el);
    };
    el.addEventListener('loadeddata', onReady);
  };

  const handleEnded = (event?: Event): EndedCue => {
    // ended that only recognizes foreground elements: Even if there are residual events in the background, they will be discarded to prevent the current animation from being interrupted.
    const endedOn = event === undefined ? null : (event.currentTarget as HTMLVideoElement | null);
    if (endedOn !== null && !endedOn.classList.contains('is-front')) return { kind: 'ignore' };
    // The receipt is placed before the drag guard: "End of playback" is a fait accompli and should not be affected by the animation chain advancement logic.
    const done = playing;
    if (done !== null) {
      playing = null; // If you clear it first and then report it, subsequent source changes will not treat it as interrupted.
      deps.report(done, 'ended');
    }
    if (deps.isDragging()) return { kind: 'ignore' };
    // Not advancing when frozen: Each branch below will change sources according to the current working status, and the validation check of effect cannot stop it.
    if (frozen) return { kind: 'ignore' };
    const cue = decideEndedCue({
      animations: deps.cfg().animations,
      current: deps.currentAnim(),
      workState: deps.workStatus()?.state,
    });
    const petId = deps.cfg().id;
    if (cue.kind === 'work-rotate') {
      console.log(
        '[dsh-pet] ' + stamp(petId) + ' workStatus animation rotation: ' + deps.currentAnim() + ' -> ' + cue.anim,
      );
    } else if (cue.kind === 'work-replay') {
      console.log('[dsh-pet] ' + stamp(petId) + ' Continuing workStatus loop: ' + deps.currentAnim());
    } else if (cue.kind === 'event-done') {
      console.log('[dsh-pet] ' + stamp(petId) + ' Event animation ended anim=' + deps.currentAnim());
    }
    return cue;
  };

  return {
    switchTo,
    handleEnded,
    stopLoopingFront: () => {
      const el = frontVideo();
      if (el === null) return;
      el.loop = false;
      el.onended = (event: Event) => deps.onEnded(handleEnded(event));
    },
    setCueUrl: (url) => {
      cueUrl = url;
    },
    setFrozen: (next) => {
      if (frozen === next) return null;
      frozen = next;
      if (next) {
        frontVideo()?.pause();
        // Freezing interrupted the playing playback request: unfreezing will not pick it up, so it is cancelled instead of paused.
        if (playing !== null) reportOnce(playing, 'cancelled', REASON_FROZEN);
        return { kind: 'frozen' };
      }
      return { kind: 'resumed' };
    },
    isFrozen: () => frozen,
    frontVideo,
    playingPlayback: () => playing,
    dispose: () => {
      mounted = false;
      loader.abortAll();
      if (blobUrl.a !== null) loader.release(blobUrl.a);
      if (blobUrl.b !== null) loader.release(blobUrl.b);
      blobUrl.a = null;
      blobUrl.b = null;
    },
  };
}
