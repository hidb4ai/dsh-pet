/**
 * Sleeping state machine: Translate a set of three-segment names written by the host into actions on the animation
 * chain, and check the random chain when sleeping.
 *
 * Just "which section to play and which step to go to"; after the playback is determined, animation-flow is
 * transferred to consumeEnded() of this module, and the random chain returned after waking up is determined by
 * pickNext passed in by the caller. Does not depend on React. Invariant: start (once) must be played before entering
 * and then loop (unlimited playback) is played; end is not played when exiting during sleep transition. There is no
 * ended in the loop segment - if it is received, it means that the foreground has been pushed out by other animations,
 * and loop must be renamed instead of replaying the foreground.
 * @module dsh-pet/src/client/pet/card/sleep-machine
 */
import type { SleepState } from '../../../shared/state.ts';
import type { CardHub } from './hub.ts';

/** Sleep stages: `start` transition to sleep, `loop` sleep cycle, `end` transition to wake up. */
export type SleepPhase = 'start' | 'loop' | 'end';

/** State machine to the outside: sleep / cleanup / query. */
export interface SleepMachine {
  /** Apply the leaf written by host: enter to play start, exit to play end (if you exit during the sleep transition, it will be directly invalid and end will not be played). */
  apply(state: SleepState): void;
  /** Determination after broadcasting: Return true = This time ended is returned to the sleep management, the caller directly calls return; false = Processed as usual. */
  consumeEnded(): boolean;
  /** Are you sleeping at this moment (including the transition between falling asleep and waking up). */
  sleeping(): boolean;
  /** Current stage; awake is null. */
  phase(): SleepPhase | null;
}

/**
 * Build a sleep state machine.
 *
 * @param hub - Card sharing runtime (take animation and write entry point and bubble slot).
 * @param pickNext - The action of returning to the random chain after waking up (provided by the animation flow to
 * avoid the reverse import of this module).
 * @param log - One-line log export (format consistent with animation stream).
 */
export function createSleepMachine(
  hub: CardHub,
  pickNext: () => void,
  log: (petId: string, message: string) => void,
): SleepMachine {
  let current: { set: { start: string; loop: string; end: string }; phase: SleepPhase } | null = null;

  /** Change a section: `once` determines whether to trigger ended after playing (the loop section must be false). */
  const play = (name: string, once: boolean): void => {
    hub.card.actions.setOnce(once);
    hub.card.actions.setAnim(name);
    hub.card.actions.bumpSeq();
  };

  const apply = (state: SleepState): void => {
    const petId = hub.cfg().id;
    if (state.sleeping) {
      if (current !== null) return; // Already sleeping (including transition): Leaf rewrites once and should not be played again from the beginning
      hub.stopMotion();
      // The same conventions as the occupied lock: close the task status bubble when you enter sleep (do not fill in the light when you wake up, and wait for the next status change to align again)
      hub.bubbles.hideWork();
      current = { set: { start: state.start, loop: state.loop, end: state.end }, phase: 'start' };
      log(petId, 'Sleep -> [' + state.start + ']');
      play(state.start, true);
      return;
    }
    // Wake up: Play "wake up" only when you are actually asleep; originally awake = idempotent no-op
    if (current === null || current.phase === 'end') return;
    // Being woken up during the transition to falling asleep: Cancel this fall asleep and do not play "get up" - it
    // did not really fall asleep. Nothing is played here: click on the path and it will play by itself. Click to
    // respond; when the menu wakes up, the current "Start" will naturally return to the random link after playing.
    if (current.phase === 'start') {
      current = null;
      log(petId, 'Sleep entry interrupted: skip the wake animation');
      return;
    }
    current.phase = 'end';
    log(petId, 'Wake -> [' + current.set.end + ']');
    play(current.set.end, true);
  };

  return {
    apply,
    consumeEnded: (): boolean => {
      if (current === null) return false;
      if (current.phase === 'start') {
        current.phase = 'loop';
        play(current.set.loop, false); // Loop segment: not triggering ended
        return true;
      }
      if (current.phase === 'loop') {
        // The foreground may be blocked by external animation while sleeping (explicit playback request,
        // hostInstruction): ended falling here means that what is being played is not a loop segment. Only replaying
        // the foreground will continue the one-time animation that was pushed in into an infinite loop, and the loop
        // segment must be renamed.
        play(current.set.loop, false);
        return true;
      }
      // phase === ' end ': After waking up and transitioning, return the random chain
      current = null;
      pickNext();
      return true;
    },
    sleeping: (): boolean => current !== null,
    phase: (): SleepPhase | null => current?.phase ?? null,
  };
}
