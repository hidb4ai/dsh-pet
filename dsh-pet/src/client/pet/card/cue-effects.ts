/**
 * Instruction processing: There is one consumption function for each of the seven instructions of balance, balance
 * unavailable, working status, talk, playback request, position, and throw. It is not responsible for determining
 * conventions (balance state, working status index, and playback branch belong to shared and animation chain
 * respectively), nor does it hold the driver. Depends on the card running time and the current frame props; each
 * instruction comes with a guard of "whether this beat has been consumed". Invariant: Only when the counter changes
 * does it take action; when the occupancy lock takes effect, the whole shot is automatically discarded, and explicit
 * instructions are not blocked.
 * @module dsh-pet/src/client/pet/card/cue-effects
 */
import { balanceEventIndex, balancePercent } from '../../../shared/balance/index.ts';
import { pickSlot, poolIncludes } from '../../../shared/pickers.ts';
import { WORK_STATUS_INDEX } from '../../../shared/work-status.ts';
import { playSayVoice } from '../../../shared/voice.ts';
import type { CardHub } from './hub.ts';
import type { PetCardProps } from './props.ts';
import type * as ReactNS from 'react';

/** Injected react capability. */
export interface CueEffectsRuntime {
  /** side effect; seven consumption functions share one effect. */
  useEffect: (effect: ReactNS.EffectCallback, deps?: ReactNS.DependencyList) => void;
  /** Reference; guarding respective consumed counters. */
  useRef: <T>(initial: T) => ReactNS.MutableRefObject<T>;
}

/** Time prefix for log lines. */
const stamp = (): string => new Date().toTimeString().slice(0, 8);

/** A line of logs with time: The client has a unified prefix, which is convenient for grep. */
const log = (message: string): void => {
  console.log('[dsh-pet] ' + stamp() + ' ' + message);
};

/**
 * Manufacturing instruction processed for hook.
 *
 * @param rt - Injected react capabilities.
 * @returns receives hook runtime with props; internally only one dispatch is registered, effect.
 */
export function createCueEffects(rt: CueEffectsRuntime) {
  const { useEffect, useRef } = rt;

  return function useCueEffects(hub: CardHub, props: PetCardProps): void {
    const { balance, balanceManual, balanceNoticeTick, balanceTick } = props;
    const { animCue, animCueTick, posCue, posCueTick, say, sayTick, throwCue, throwCueTick } = props;
    const { workStatus, workStatusTick } = props;

    const prevBalanceRef = useRef(0);
    const prevNoticeRef = useRef(0);
    const prevWorkRef = useRef(0);
    // Debug log: Previous state, null means idle, undefined means it has not been triggered after startup.
    const prevWorkStateRef = useRef<string | null | undefined>(undefined);
    const prevSayRef = useRef(0);
    const prevAnimRef = useRef(0);
    const prevPosRef = useRef(0);
    const prevThrowRef = useRef(0);

    /**
     * Balance event: play the event animation according to the state and pop the bubble. Manually request unconditional
     * bombing, automatic polling is required to be turned on and have a percentage; when falling asleep, the whole
     * shot will be automatically discarded from the source, otherwise it will topple the sleeping position.
     */
    const consumeBalance = (): void => {
      const cfg = hub.cfg();
      const card = hub.card;
      if (balanceTick === 0 || balanceTick === prevBalanceRef.current) return;
      prevBalanceRef.current = balanceTick;
      // Occupied lock: automatic balance is not checked, manual request is as usual; tick will be judged after consumption, and the period of occupation will be regarded as past.
      if (hub.ownAnim.isFrozen() && !balanceManual) return;
      // One-vote veto for sleeping: no broadcast will be played while sleeping, and sleeping postures will not be interrupted by manual requests (same conventions as the desktop).
      if (hub.sleeping()) return;
      if (!balance || !balance.ok) return;
      if (!cfg.balanceEnabled && !balanceManual) return; // Automatic polling is subject to the gating switch, and manual requests pass unconditionally.
      const percent = balancePercent(balance);
      // The pop-up threshold of automatic polling: the built-in form requires a percentage; custom does not look at the percentage, and the content is designed by a third party.
      if (balanceManual || percent !== undefined || balance.shape === 'custom') hub.bubbles.showBalance();
      if (!cfg.balanceEnabled) return; // The state animation only belongs to pets with balance enabled.
      if (percent === undefined) return; // The current data source does not have percentage semantics and does not trigger the state animation.
      const pool = hub.anims().events?.balance;
      if (!pool || pool.length === 0) {
        console.error('[dsh-pet] Missing animations.events.balance; balance animations are unavailable');
        return;
      }
      const idx = balanceEventIndex(percent);
      const slot = pool[idx];
      if (!slot) {
        console.error('[dsh-pet] balance band index out of range: p=' + percent + ' idx=' + idx);
        return;
      }
      const name = pickSlot(slot, card.animRef.current); // Randomly draw 1 in the file and avoid the currently playing animation.
      log('balance pet=' + cfg.id + ' p=' + percent.toFixed(1) + '% -> [band ' + idx + '] ' + name);
      hub.stopMotion();
      card.actions.setOnce(true);
      card.actions.setAnim(name);
    };

    /** The balance is unavailable: the container counts up. This pet only plays text descriptions and does not play state animations. */
    // The same reason only prompts once for the decideBalanceNotice deduplicate of shared from the container. Just press tick here.
    const consumeBalanceNotice = (): void => {
      const cfg = hub.cfg();
      if (!cfg.balanceEnabled && !balanceManual) return; // Automatic polling is subject to the gating switch, and manual requests pass unconditionally.
      if (balanceNoticeTick === 0 || balanceNoticeTick === prevNoticeRef.current) return;
      prevNoticeRef.current = balanceNoticeTick;
      // Occupied lock: automatic source is not viewed, manual request is normal; sleep is vetoed, manual request is not played.
      if (hub.ownAnim.isFrozen() && !balanceManual) return;
      if (hub.sleeping()) return;
      if (!balance || balance.ok) return;
      hub.bubbles.showBalance();
    };

    /** Working status linkage: play the animation according to the state and pop up the text bubble; when idle, close the bubble and stop after playing. */
    const consumeWorkStatus = (): void => {
      const cfg = hub.cfg();
      const card = hub.card;
      if (workStatusTick === 0 || workStatusTick === prevWorkRef.current) return;
      prevWorkRef.current = workStatusTick;
      // Occupied lock: The working state is from automatic source and does not respond when the lock is in effect; the
      // current state is realigned by the freeze driver when thawing. Do not block host writing: sections.workStatus
      // is shared by all pets and is ignored by the renderer according to the pet.
      if (hub.ownAnim.isFrozen()) return;
      // Sleeping: the same does not respond to the working state (no animation change, no text); after waking up, it will be realigned by the next state change.
      if (hub.sleeping()) return;
      if (!workStatus || workStatus.state === null) {
        log(
          'pet=' +
            cfg.id +
            ' ' +
            (prevWorkStateRef.current ?? 'null') +
            '->null: finish this clip, return to idle and dismiss the bubble',
        );
        prevWorkStateRef.current = null;
        // When idle, change the working animation in the loop to "stop after playing": otherwise ended will never
        // trigger, the animation chain will not get the advancement signal, and the pet will always be stuck on the
        // working animation.
        if (poolIncludes(hub.anims().events?.workStatus ?? [], card.animRef.current)) hub.ownAnim.stopLoopingFront();
        hub.bubbles.resetWork();
        return;
      }
      const pool = hub.anims().events?.workStatus;
      if (!pool || pool.length === 0) {
        console.error('[dsh-pet] Missing animations.events.workStatus; work-state animations are unavailable');
        return;
      }
      const idx = WORK_STATUS_INDEX[workStatus.state];
      const slot = pool[idx];
      if (slot === undefined) {
        console.error('[dsh-pet] work-status band index out of range: state=' + workStatus.state + ' idx=' + idx);
        return;
      }
      const name = pickSlot(slot, card.animRef.current); // Randomly draw 1 in the file and avoid the currently playing animation.
      log('pet=' + cfg.id + ' ' + (prevWorkStateRef.current ?? 'null') + '->' + workStatus.state + '    ' + name);
      const stateChanged = prevWorkStateRef.current !== workStatus.state;
      prevWorkStateRef.current = workStatus.state;
      hub.stopMotion();
      // bubble text: Task details take priority, otherwise a sentence will be randomly selected from workStatusTexts [state].
      const textGroup = Array.isArray(cfg.workStatusTexts) ? cfg.workStatusTexts[idx] : undefined;
      const configuredText =
        Array.isArray(textGroup) && textGroup.length > 0
          ? textGroup[Math.floor(Math.random() * textGroup.length)]
          : undefined;
      // Text is always updated, task details may change in the same status.
      hub.bubbles.updateWorkText(workStatus.task ?? configuredText ?? null);
      const terminal = workStatus.state === 'success' || workStatus.state === 'error';
      // Only light up or close the bubble when the state changes: the same state subsequent tick will not relight the final state bubble that has been automatically closed.
      if (stateChanged) hub.bubbles.lightWork(terminal);
      // Loop semantics: the final state is broadcast once; the non-final state single candidate is infinitely looped, and multiple candidates are broadcast once and then rotated by the completion decision.
      const rotating = !terminal && Array.isArray(slot) && slot.length > 1;
      card.actions.setOnce(terminal || rotating);
      card.actions.setAnim(name);
    };

    /** Speaking (whisper, command bubble, conversation reply, clear): When the serial number changes, clear or bubble is executed. */
    const consumeSay = (): void => {
      if (!say || say.seq === prevSayRef.current) return;
      prevSayRef.current = say.seq;
      if (say.kind === 'clear') {
        hub.bubbles.clearWhisper();
        return;
      }
      hub.speak(say.text, say.image, say.url, say.duration, say.anim);
      // Both ends have their own decisions: if the leaf calls the name of one end, it will read, and if the other end does not call the name or clicks the other end, it will only play the bubble.
      playSayVoice(say);
    };

    /** playback request animation: url inserts a section, and the name and menu are followed by the same set of actions. */
    const consumeAnimCue = (): void => {
      const card = hub.card;
      if (!animCue || animCue.seq === prevAnimRef.current) return;
      prevAnimRef.current = animCue.seq;
      // facing must land before changing the source, and mirror ref synchronously: change the source and read it in
      // onReady. When facing is not passed, the current orientation is maintained and left is not fallbacked.
      const explicitFacing = animCue.facing !== undefined;
      if (animCue.facing !== undefined) {
        card.actions.setFacing(animCue.facing);
        card.facingRef.current = animCue.facing;
      }
      // The url form only inserts a section: stop roaming, change the source to play once, and return to the normal
      // animation chain when the playback is completed; no menu action is performed - the naked address does not have
      // text or mobile attributes.
      if (animCue.url !== undefined) {
        hub.stopMotion();
        hub.ownAnim.setCueUrl(animCue.url);
        card.actions.setOnce(true);
        card.actions.bumpSeq(); // When the same address is broadcast twice, the status remains unchanged. Increasing the serial number forces the broadcast to be repeated again to change the source.
        card.actions.setAnim(animCue.url);
        card.actions.setCuePlayback(animCue.playbackId ?? null);
        return;
      }
      if (animCue.name === undefined) return;
      // keepFacing: Explicitly specified orientation takes precedence over the mirror correction of "text class forced to left".
      hub.playByName(animCue.name, animCue.playbackId, explicitFacing);
    };

    /** Position command: handed over to position following; when the user is pressing the pet, the driver will discard the entire shot. */
    const consumePosCue = (): void => {
      if (!posCue || posCue.seq === prevPosRef.current) return;
      prevPosRef.current = posCue.seq;
      hub.posFollow.apply(posCue.x, posCue.y, posCue.mode, posCue.duration);
    };

    /** Throw command: handed to the throw driver. */
    const consumeThrowCue = (): void => {
      if (!throwCue || throwCue.seq === prevThrowRef.current) return;
      prevThrowRef.current = throwCue.seq;
      hub.applyThrow(throwCue.angle, throwCue.power);
    };

    // Seven instructions share one effect: each one has its own consumed guard, and only the changed one actually
    // takes action. When writing seven effect separately, each rendering period closure must be subscribed again, and
    // the guard and dependency instructions are also repeated seven times.
    useEffect(() => {
      consumeBalance();
      consumeBalanceNotice();
      consumeWorkStatus();
      consumeSay();
      consumeAnimCue();
      consumePosCue();
      consumeThrowCue();
      // Guards are recreated each render but read refs and current props; adding them would rerun all seven guards each render.
      // eslint-disable-next-line react-hooks/exhaustive-deps -- Only these seven counters trigger updates.
    }, [balanceTick, balanceNoticeTick, workStatusTick, sayTick, animCueTick, posCueTick, throwCueTick]);
  };
}
