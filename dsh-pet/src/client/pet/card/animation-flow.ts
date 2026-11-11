/**
 * Animation flow: whisper linkage, random chain roll, recovery state cycle after interaction, and landing of judgment
 * after broadcast. It is not responsible for the judgment itself (the branch after playing is at animation/cues, and
 * the next segment is selected at animation/next-animation), nor does it hold the animation chain. Depends on the card
 * runtime and current working status; the working status uses ref mirroring, because the callback is completed later
 * than the status update. Invariant: During the freezing period, random chain and state recovery are not performed; the
 * serial number must be incremented after changing the source, otherwise the replay of the same segment will not take
 * effect.
 * @module dsh-pet/src/client/pet/card/animation-flow
 */
import { pick, pickSlot, rollKind } from '../../../shared/pickers.ts';
import type { SleepState } from '../../../shared/state.ts';
import { WORK_STATUS_INDEX } from '../../../shared/work-status.ts';
import { decideNextAnimation } from '../animation/next-animation.ts';
import { createSleepMachine } from './sleep-machine.ts';
import type { CardHub } from './hub.ts';
import type { EndedCue } from '../animation/cues.ts';
import type { WorkStatusSnapshot } from '../../../shared/work-status.ts';
import type * as ReactNS from 'react';

/** The external action surface of animation flow. */
export interface AnimationFlow {
  /** The status is changed according to the completion judgment; the receipt and validation check have been processed in the animation chain. */
  applyEndedCue(cue: EndedCue): void;
  /** Roll the weighted dice to select the next self-playing animation. */
  pickNext(): void;
  /** The non-final working state returns to the state cycle; when there is no recoverable state, it returns to false. */
  resumeWorkStatusAnim(): boolean;
  /** Say something: Whisper animation and bubble play. The animation and bubble duration are independent of each other. */
  speak(text: string, image?: string, url?: string, duration?: number, anim?: boolean): void;
  /** The sleeping state written by the application host: enter → start playing; exit → start playing. */
  applySleep(state: SleepState): void;
  /** Are you sleeping at this moment (including the transition between falling asleep and waking up). */
  sleeping(): boolean;
  /** Current sleep stage; awake is null. Click on the path to distinguish between "fall asleep transition" and "real sleep". */
  sleepPhase(): 'start' | 'loop' | 'end' | null;
}

/** Injected react capability. */
export interface AnimationFlowRuntime {
  /** Reference; mirror of working state. */
  useRef: <T>(initial: T) => ReactNS.MutableRefObject<T>;
}

/** Time prefix for log lines. */
const stamp = (): string => new Date().toTimeString().slice(0, 8);

/** A log with time and pet id. */
const log = (petId: string, message: string): void => {
  console.log('[dsh-pet] ' + stamp() + ' pet=' + petId + ' ' + message);
};

/**
 * hook making animation stream.
 *
 * @param rt - Injected react capabilities.
 * @returns receives hook in runtime and working status; ref is read in the callback, and the old value will not be
 * read.
 */
export function createAnimationFlow(rt: AnimationFlowRuntime) {
  const { useRef } = rt;

  return function useAnimationFlow(hub: CardHub, workStatus: WorkStatusSnapshot | null): AnimationFlow {
    // The callback is finished playing later than the status update: mirror the current value to avoid the status at the moment when the closure reads register.
    const workStatusRef = useRef(workStatus);
    workStatusRef.current = workStatus;

    // Sleep is handed over to the independent state machine: here it is only assembled and forwarded (pickNext is
    // defined below, the state machine only holds a reference, and the call occurs after the broadcast is completed).
    // ref must be placed: the state machine holds the "current stage", and the local variables of the function body
    // will be rebuilt every time it is rendered, and the sleeping state is lost on the spot (the video is still in the
    // sleeping position, but the menu shows "sleeping", and clicking it does not wake it up).
    const machineRef = useRef<ReturnType<typeof createSleepMachine> | null>(null);
    const sleep = (): ReturnType<typeof createSleepMachine> =>
      (machineRef.current ??= createSleepMachine(hub, pickNext, log));
    /** Are you sleeping at this moment (including two transitions). */
    const sleeping = (): boolean => sleep().sleeping();
    /** Current sleep stage; waking up is null. */
    const sleepPhase = (): 'start' | 'loop' | 'end' | null => sleep().phase();
    /** The sleeping state written by the application host (forwarded to the state machine). */
    const applySleep = (state: SleepState): void => sleep().apply(state);
    /** Non-final working status returns to state cycle; frozen, idle and final status all return to false. */
    const resumeWorkStatusAnim = (): boolean => {
      const card = hub.card;
      // During the lock period, the state animation will not be restored from this road; the unfrozen path will be unfrozen first and then called.
      if (hub.ownAnim.isFrozen()) return false;
      // The state animation is not restored during sleep: the working status is still running, but the animation will not be watched or heard while sleeping.
      if (sleeping()) return false;
      const ws = workStatusRef.current;
      if (!ws || !ws.state || ws.state === 'success' || ws.state === 'error') return false;
      const pool = hub.anims().events?.workStatus;
      if (!pool || pool.length === 0) return false;
      const idx = WORK_STATUS_INDEX[ws.state];
      const slot = pool[idx];
      if (slot === undefined) return false;
      const name = pickSlot(slot, card.animRef.current); // Randomly draw 1 in the file and avoid the currently playing animation.
      log(hub.cfg().id, 'Restoring work-state animation after interaction: ' + name);
      // After the multi-candidate state is restored, the rotation will still be completed; the single candidate will maintain an infinite loop.
      card.actions.setOnce(Array.isArray(slot) && slot.length > 1);
      card.actions.setAnim(name);
      return true;
    };

    /** Roll the weighted dice to select the next self-playing animation. */
    const pickNext = (): void => {
      const card = hub.card;
      // Occupied lock: The only entry point of the random chain does not roll dice, and the random animation, turning, and movement are stopped together.
      if (hub.ownAnim.isFrozen()) return;
      // Sleep: The random chain stops completely (no dice rolling, no turning, no moving), wake up by end segment cleanup of applySleep
      if (sleeping()) return;
      const roll = Math.random();
      // When the pet is fixed, the "turn/movement" weight is calculated as 0 when rolling the dice; the menu playback request and explicit playback request do not go here.
      const kind = rollKind(roll, hub.cfg().animationWeights, { fixed: hub.cfg().fixedEnabled });
      // Only when the move state is thrown can the position be tried: when occupied, it will return to true (already moving), and if it cannot move, it will return to false.
      const move = kind === 'move' ? hub.tryWalk() : undefined;
      const decision = decideNextAnimation({
        kind,
        animations: hub.anims(),
        facing: card.facingRef.current,
        current: card.animRef.current,
        move,
      });
      log(
        hub.cfg().id,
        'facing=' +
          card.facingRef.current +
          ' roll=' +
          roll.toFixed(4) +
          ' -> [' +
          decision.kind +
          '] ' +
          (decision.anim ?? 'Movement in progress (do not replay)'),
      );
      if (decision.play && decision.anim !== null) card.actions.setAnim(decision.anim);
      card.actions.setOnce(true);
      card.actions.bumpSeq();
    };

    /** Click Finish to determine the status. */
    const applyEndedCue = (cue: EndedCue): void => {
      const card = hub.card;
      // The three stages of sleeping and "returning to the random chain after getting up" are both in the state machine: it says that ended is under its control this time and returns directly.
      if (sleep().consumeEnded()) return;
      if (cue.kind === 'ignore') return;
      if (cue.kind === 'work-rotate') {
        card.actions.setOnce(true); // Keep once = true and rotate after the next segment is played.
        card.actions.setAnim(cue.anim);
        card.actions.bumpSeq();
        return;
      }
      if (cue.kind === 'work-replay') {
        card.actions.setOnce(false);
        card.actions.bumpSeq();
        return;
      }
      if (cue.kind === 'event-done') {
        // The state cycle is restored immediately after the event animation preemption is played, otherwise the random chain will be mistakenly entered during a long event.
        if (resumeWorkStatusAnim()) return;
        if (hub.anims().idle.length) card.actions.setAnim(pick(hub.anims().idle, card.animRef.current));
        card.actions.setOnce(true);
        card.actions.bumpSeq();
        return;
      }
      if (cue.kind === 'turn') {
        const next = card.state.facing === 'left' ? 'right' : 'left';
        card.actions.setFacing(next);
        card.facingRef.current = next; // Sync now: Rolls flipped are filtered with new orientation. anim/once/seq will not be changed when turned over, and
        // effect will not be rerun when the source is changed: there is no explicit link back, and the random chain will stop
        // at the last frame.
        pickNext();
        return;
      }
      if (cue.kind === 'interaction-done') {
        // After the interactive animation is played: the non-final state returns to the state loop, otherwise it returns to idle.
        if (resumeWorkStatusAnim()) return;
        if (hub.anims().idle.length) card.actions.setAnim(pick(hub.anims().idle, card.animRef.current));
        card.actions.setOnce(true);
        card.actions.bumpSeq();
        return;
      }
      pickNext();
    };

    /** Say something: Whisper animation and bubble play are independent. */
    const speak = (text: string, image?: string, url?: string, duration?: number, anim?: boolean): void => {
      const card = hub.card;
      let name: string | null = null;
      // Only bubbles are played and animation is not changed when sleeping: both sleep talking and command bubbles are displayed, but the sleeping position cannot be interrupted.
      if (anim !== false && !sleeping()) {
        const pool = hub.anims().events?.whisper;
        if (!pool || pool.length === 0) {
          console.error('[dsh-pet] Missing animations.events.whisper; whisper animations are unavailable');
          return;
        }
        // Randomly draw 1 slot from the entire pool and avoid the currently playing animation; when the slot is an array, it will be randomly selected within the file.
        name = pickSlot(pick(pool, card.animRef.current), card.animRef.current);
      }
      log(
        hub.cfg().id,
        'whisper' + (name === null ? ' (no linked animation)' : ' -> [' + name + ']') + ' 「' + text + '」',
      );
      // Start animation first: animation and bubble duration are two independent parameters.
      if (name !== null) {
        hub.stopMotion();
        card.actions.setOnce(true);
        card.actions.setAnim(name);
      }
      hub.bubbles.showWhisper(text, { image, url }, duration);
    };

    return { applyEndedCue, applySleep, pickNext, resumeWorkStatusAnim, sleepPhase, sleeping, speak };
  };
}
