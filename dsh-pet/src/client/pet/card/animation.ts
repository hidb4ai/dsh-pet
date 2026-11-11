/**
 * Animation chain assembly of a pet card: construct OwnAnimation, change sources according to the status, and register
 * the read-only service during the mounting period. It is not responsible for movement and floating layer:
 * positioning, dragging, extrusion and the value of the late binding slot of the assembly root. This module only
 * determines "when to read". The unmount sequence is fixed: unmount monitoring → log out pose/progress → dispose
 * animation chain → stop three sets of motion.
 * @module dsh-pet/src/client/pet/card/animation
 */
import { createOwnAnimation, type OwnAnimation, type OwnAnimationDeps } from '../animation/animation.ts';
import { registerPose } from '../../pose.ts';
import { registerProgress } from '../../progress.ts';
import { boxToRatio, centerToBox, clampReachableBox, derivePetMetrics } from '../motion/geometry.ts';
import type { CardLive } from './live.ts';
import type { CardStateApi } from './state.ts';
import type { RuntimePet } from '../types.ts';
import type { LockState } from '../../../shared/state.ts';
import type { WorkStatusSnapshot } from '../../../shared/work-status.ts';
import type * as ReactNS from 'react';

/** Injected react capability. */
export interface CardAnimationRuntime {
  /** side effect. */
  useEffect: (effect: ReactNS.EffectCallback, deps?: ReactNS.DependencyList) => void;
  /** Quote; animation chain is only created once. */
  useRef: <T>(initial: T) => ReactNS.MutableRefObject<T>;
}

/** Inputs to animation chain assembly; all are value functions or stable references. */
export interface CardAnimationInput {
  /** Card status: animation name, serial number and orientation are taken from it. */
  card: CardStateApi;
  /** Latest value of resolved configuration. */
  cfgRef: ReactNS.MutableRefObject<RuntimePet>;
  /** The latest value of the working status: it needs to be read after the broadcast is completed, and the callback is later than the status update. */
  workStatusRef: ReactNS.MutableRefObject<WorkStatusSnapshot | null>;
  /** Assemble root binding groove. */
  live: ReactNS.MutableRefObject<CardLive>;
  /** Whether to add a Q bounce after the new first frame is in place (click to set it interactively). */
  pendingSquash: ReactNS.MutableRefObject<boolean>;
  /** Double buffered front element. */
  videoA: () => HTMLVideoElement | null;
  /** Double-buffered background elements. */
  videoB: () => HTMLVideoElement | null;
  /** playback request receipt: Only the browser side knows the actual playback result. */
  report: OwnAnimationDeps['report'];
  /** The lock leaf at the moment of mounting: only used to determine whether the animation chain is initially frozen. */
  lock?: LockState;
  /** Consume the playback request number to avoid effect from running again. */
  setCuePlayback: (id: string | null) => void;
  /** This pet id: The register read-only service uses it during the mount period. */
  petId: string;
}

/**
 * Create animation link configuration hook.
 *
 * @param rt - Injected react capabilities.
 * @returns receives the hook of the assembly input and returns the animation chain instance of this card.
 */
export function createCardAnimation(rt: CardAnimationRuntime) {
  const { useEffect, useRef } = rt;

  return function useCardAnimation(input: CardAnimationInput): OwnAnimation {
    const { card, cfgRef, live, pendingSquash, petId, workStatusRef } = input;

    // The animation chain is only created once (put into ref): it holds the A/B slot, generation number and blob, and cross-rendering reconstruction will clear these states.
    const ownAnimRef = useRef<OwnAnimation | null>(null);
    ownAnimRef.current ??= createOwnAnimation({
      videoA: input.videoA,
      videoB: input.videoB,
      cfg: () => cfgRef.current,
      currentAnim: () => card.animRef.current,
      workStatus: () => workStatusRef.current,
      facing: () => card.facingRef.current,
      report: input.report,
      clearCuePlayback: () => input.setCuePlayback(null),
      onFrontReady: (el) => {
        // When you click Q, you have to wait for the new animation to be in place before pressing, and the new first frame is pressed.
        if (pendingSquash.current) {
          pendingSquash.current = false;
          live.current.squash.start(el);
        }
        if (live.current.walk.hasPending()) live.current.walk.start(el);
      },
      onEnded: (cue) => live.current.flow?.applyEndedCue(cue),
      isDragging: () => live.current.drag.isActive(),
      initiallyFrozen: input.lock?.locked === true && input.lock.expiresAt > Date.now(),
    });
    const ownAnim = ownAnimRef.current;
    live.current.ownAnim = ownAnim;

    const { anim, cuePlayback, once, seq } = card.state;

    // State-driven playback.
    useEffect(() => {
      ownAnim.switchTo(anim, once, cuePlayback);
      // eslint-disable-next-line react-hooks/exhaustive-deps -- Source identity is anim/once/seq/cuePlayback; ownAnim is stable.
    }, [anim, once, seq, cuePlayback]);

    useEffect(() => {
      // The identity of the slot object is stable (useRef once), and the field is updated in place every time it is rendered; a copy is captured for cleaning to avoid reading . current.
      const services = live.current;
      // When the viewport changes, the root node position must be recalculated according to the new size, otherwise
      // the pet will stop at the old proportion after changing the window size; after recalculating, press the visible
      // lower limit again, and the pet will self-heal when the window is shrunk and squeezed out of the viewport.
      const onResize = () =>
        card.actions.setCustomPos((prev) => {
          if (!prev) return prev;
          // Read cfgRef instead of card.state in the closure: This effect is only registered once, and the snapshot during rendering is the initial size.
          const { size } = cfgRef.current;
          const { halfW, halfH, bottomPad } = derivePetMetrics(size);
          const viewport = { width: window.innerWidth, height: window.innerHeight };
          const half = { w: halfW, h: halfH };
          const box = centerToBox(prev, viewport, half);
          // A new object must be returned: if the viewport changes, it must be re-rendered. Returning the same reference React will be skipped and the position will not be recalculated.
          return { ...boxToRatio(clampReachableBox(box, viewport, { size, bottomPad }), viewport, half) };
        });
      window.addEventListener('resize', onResize);
      // Register the real-time position and orientation of the pet on this page to the read-only service petApi7340
      // (see ../pose); consumers read the closure on demand, and can get the current value during dragging and
      // throwing, not a snapshot.
      const unregisterPose = registerPose(petId, () => {
        const center = live.current.center();
        return {
          x: center.x / window.innerWidth,
          y: center.y / window.innerHeight,
          facing: card.facingRef.current,
        };
      });
      // The playback progress goes to the same Cordis entry point (see ../progress); reading video in the foreground and back will jump during A/B switching.
      const unregisterProgress = registerProgress(petId, () => {
        const el = ownAnim.frontVideo();
        const playbackId = ownAnim.playingPlayback();
        const anim = card.animRef.current;
        if (el === null) {
          // The element has not been attached to the first frame. Give a parsable zero value and do not let the caller get undefined.
          return { playbackId, anim, currentTime: 0, duration: 0, paused: true, buffering: false };
        }
        // duration is NaN before the metadata is ready, which is unified to 0.
        const duration = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : 0;
        return {
          playbackId,
          anim,
          currentTime: el.currentTime,
          duration,
          paused: el.paused,
          buffering: el.readyState < 3 || el.seeking,
        };
      });
      return () => {
        window.removeEventListener('resize', onResize);
        unregisterPose(); // unmount means removal: Silent failure is safer than reading stale values.
        unregisterProgress();
        ownAnim.dispose(); // Interrupt the asset request in transit and release blob. This instance cannot be reused thereafter.
        services.stopMove();
        services.drag.stopFollow();
        services.flight.stop();
        services.squash.stop();
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps -- Run once per mount/unmount; the closure reads refs and stable props.
    }, []);

    return ownAnim;
  };
}
