/**
 * Open multiple containers: pull the resolved configuration once, grow polling / state leaves, and then
 * distribute the instructions to the corresponding pet cards. It only distributes "Configuration → Rendering List" and
 * "Leaf → Each Pet". It does not explain the leaf semantics and does not draw DOM. It must always be true: only the
 * baseline is remembered in the first pull, and counter changes are distributed after that; an error is explicitly
 * reported when the configuration shape is abnormal, and the empty list clear is never used.
 * @module dsh-pet/src/client/pet/multi
 */
import type { FunctionComponent, ReactNode } from 'react';
import { petBridge } from '../settings/bridge.ts';
import { flattenConfigPets, isWebVisible } from '../../shared/config.ts';
import { decideBalanceNotice } from '../../shared/balance/index.ts';
import { ROUTE_PATH } from '../../shared/constants.ts';
import { readFocusSession } from '../../shared/focus-session.ts';
import { readMenuItems } from '../../shared/menu.ts';
import {
  fetchState,
  flattenCounters,
  readAnim,
  readBalance,
  readLock,
  readPosition,
  readSay,
  readSleep,
  readThrow,
  readWorkStatus,
  resolveLeafPath,
  takeChanged,
} from '../../shared/state.ts';
import { fontStackOf } from '../../shared/fonts.ts';
import type { Pet } from '../../shared/types.ts';
import type { BalanceState } from '../../shared/balance/index.ts';
import type {
  LockState,
  PetFacing,
  PetLeafName,
  PollState,
  PositionMode,
  SayCue,
  SectionLeafName,
  SleepState,
  StateLeaf,
} from '../../shared/state.ts';
import type { MenuMoreItem } from '../../shared/menu.ts';
import type { PetCollisionSlot } from '../../shared/physics.ts';
import type { WorkStatusSnapshot } from '../../shared/work-status.ts';
import type { PetCardProps } from './card/props.ts';
import type { PetRuntime, RuntimePet } from './types.ts';
import { setClickSoundEnabled } from './click-sound.ts';
import { setSurface, setVoiceConfig, setVoiceNotifyEnabled } from '../../shared/voice.ts';
import { runStatePoll } from './state-poll.ts';
import { setMenuItems } from '../menu-service.ts';
import { setStateSnapshot } from '../state-service.ts';
import { jumpToSession, notifyFromFrame } from '../notify.ts';
import { speakWorkStatus } from '../voice-notify.ts';
import { STATE_FALLBACK_MS, STATE_WAIT_MS } from './timings.ts';

/**
 * Create multiple open containers.
 *
 * @param rt - Injected react capability.
 * @param Card - Card assembly for a single pet.
 * @returns container component.
 */
export function createPetMulti(
  rt: Pick<PetRuntime, 'h' | 'useState' | 'useEffect' | 'useRef'>,
  Card: FunctionComponent<PetCardProps>,
): () => ReactNode {
  const { h, useState, useEffect, useRef } = rt;

  return function PetMulti() {
    const [pets, setPets] = useState<Pet[]>([]);
    const [ready, setReady] = useState(false);
    // Collision site: Each PetCard register slot, pure ref synchronization, does not trigger re-rendering.
    const arenaRef = useRef<{ slots: Record<string, PetCollisionSlot> }>({ slots: {} });
    // Balance status: The container is pulled uniformly, and PetCard is shared; the two tick drive animation and text description respectively.
    const [balance, setBalance] = useState<BalanceState | null>(null);
    const [balanceTick, setBalanceTick] = useState(0);
    const [balanceNoticeTick, setBalanceNoticeTick] = useState(0);
    // Is the current balance requested manually by the user? If the manual request is unconditional, the switch can only be turned off automatically.
    const [balanceManual, setBalanceManual] = useState(false);
    // The last reason for unavailability has been prompted. Automatic polling will only be done when the reason changes.
    const noticeKeyRef = useRef<string | null>(null);
    // The balance results are unified entry point; ref is saved to keep the dependency of / state effect [ ready ].
    // explicit indicates whether to trigger manually this time.
    const applyBalanceRef = useRef<(state: BalanceState, explicit: boolean) => void>(() => {});
    applyBalanceRef.current = (state, explicit) => {
      setBalance(state);
      setBalanceManual(explicit); // Manual marking is delivered together with this data and will be overwritten every time it arrives.
      if (state.ok) {
        setBalanceTick((t) => t + 1); // Success: Play the state animation and pop the balance bubble.
        return;
      }
      const { show, key } = decideBalanceNotice(state, noticeKeyRef.current, explicit);
      noticeKeyRef.current = key;
      if (show) setBalanceNoticeTick((t) => t + 1); // Pop up text description bubble (no animation played) The unregistered service provider is a configuration fact,
      // which has been explained by bubble; other reasons are still reported explicitly as usual.
      if (state.reason !== 'unsupported') {
        console.error(
          '[dsh-pet] Balance query failed reason=' + state.reason + (state.message ? ' ' + state.message : ''),
        );
      }
    };
    // Working status: The container is uniformly polling sections.workStatus, and the snapshot and tick drive each pet to play the state animation.
    const [workStatus, setWorkStatus] = useState<WorkStatusSnapshot | null>(null);
    const [workStatusTick, setWorkStatusTick] = useState(0);
    // Talk: The container distributes pets .< id >. say by pet to the corresponding PetCard .

    // The font family is written as documentElement: the dialog window and score pop-up window are hung under body and cannot be inherited from the pet root container.
    useEffect(() => {
      const family = pets[0]?.font?.family;
      if (family === undefined) return;
      document.documentElement.style.setProperty('--dsh-pet-font-family', fontStackOf(family));
    }, [pets]);

    useEffect(() => {
      let alive = true;
      /** Unique fill point: finished aggregate → renderlist; entry-level fields are only blown in by flattenConfigPets. */
      const applyMerged = (merged: Record<string, Record<string, unknown>>): void => {
        const main = (merged as { main?: Record<string, unknown> } | null)?.main;
        // Shape verification: Explicitly throw an error when responding to an exception. Never use an empty list to clear existing pets.
        if (typeof main !== 'object' || main === null) {
          throw new Error('The configuration response is not a merged aggregate; check host version compatibility');
        }
        // Click the sound effect switch read-only main entry, non-true will be muted.
        setClickSoundEnabled(main.clickSoundEnabled === true);
        // This page is the web page: when you press the leaf to play, only the sentence voiceTo =' web ' will be recognized.
        setSurface('web');
        // The voice and volume have the same source: the missing field is "use default voice/maximum volume", which is not the default value on the terminal.
        setVoiceConfig(main.voiceName, main.voiceVolume);
        setVoiceNotifyEnabled(main.voiceNotifyEnabled);
        const flattened = flattenConfigPets(merged);
        petBridge.current = flattened;
        // The "Add Pet" template takes pets[0] of the main entry.
        petBridge.template = Array.isArray(main.pets) ? ((main.pets as Pet[])[0] ?? undefined) : undefined;
        setPets(flattened);
      };
      /** Pull the resolved configuration: the output of host readAllConfig, client zero check zero fallback. */
      const loadMerged = async (): Promise<Record<string, Record<string, unknown>>> => {
        // cache: ' no-store ' has the same conventions as fetchState to avoid "repulling after version change" to get the old value.
        const r = await fetch(ROUTE_PATH + '/config', { cache: 'no-store' });
        if (!r.ok) throw new Error('config HTTP ' + r.status);
        const body = (await r.json()) as Record<string, unknown>;
        // Business failure is also 200: The body of ok:false is not a finished configuration, do not use it to flatten it (it will silently degrade to the default configuration)
        if (body.ok === false) throw new Error('config: ' + String(body.reason ?? 'failed'));
        return body as Record<string, Record<string, unknown>>;
      };
      (async () => {
        try {
          const merged = await loadMerged();
          if (!alive) return;
          applyMerged(merged);
          setReady(true);
        } catch (e) {
          console.error('[dsh-pet] Configuration loading failed', e); // If the resolved value fails to be pulled, an error must be reported explicitly and not hidden silently.
        }
      })();
      // After saving or synchronizing the settings page, re-flatten it with the authoritative resolved value; directly use the response body of the write interface when passing in merged.
      petBridge.reload = (merged) => {
        void (async () => {
          try {
            const next = merged ?? (await loadMerged());
            if (!alive) return;
            applyMerged(next);
          } catch (e) {
            console.error('[dsh-pet] Configuration reload failed; retaining the current render list', e); // Explicit error, no clear existing pet.
          }
        })();
      };
      return () => {
        alive = false;
        petBridge.reload = () => {};
      };
    }, []);

    // overlay only renders display as pets of web or both.
    const visiblePets = pets.filter((p) => isWebVisible(p.display));

    // Unified polling / state: Each leaf = { counter , data }, the first pull only remembers the baseline, and then
    // the counter changes are distributed. Commands such as speaking have nothing to do with pet switches, so polling
    // is not clipped for function switches.
    const [sayTick, setSayTick] = useState(0);
    const sayRef = useRef<Record<string, SayCue & { seq: number }>>({});
    const [animCueTick, setAnimCueTick] = useState(0);
    const animCueRef = useRef<
      Record<string, { name?: string; url?: string; seq: number; playbackId?: string; facing?: PetFacing }>
    >({});
    const [posCueTick, setPosCueTick] = useState(0);
    const posCueRef = useRef<
      Record<string, { x: number; y: number; mode: PositionMode; duration: number; seq: number }>
    >({});
    const [throwCueTick, setThrowCueTick] = useState(0);
    const throwCueRef = useRef<Record<string, { angle: number; power: number; seq: number }>>({});
    // The occupied lock is a state rather than an instruction: PetCard reads it to decide to freeze, and press expiresAt to release it automatically.
    const [lockTick, setLockTick] = useState(0);
    const lockRef = useRef<Record<string, LockState>>({});
    // Sleeping is the same state: the three-segment name is selected by the host, and the card starts playing → looping → up accordingly.
    const [sleepTick, setSleepTick] = useState(0);
    const sleepRef = useRef<Record<string, SleepState>>({});
    // Third-party menu items are only read once when the right-click menu is opened and do not participate in rendering.
    const menuItemsRef = useRef<MenuMoreItem[]>([]);
    /** Processed jump session time: the first pull and the subsequent increment may point to the same signal, which only jumps once. */
    const lastFocusTsRef = useRef(0);
    useEffect(() => {
      if (!ready) return;
      let alive = true;
      let baseline: Record<string, number> | null = null;
      /** Jumping the session is a one-time signal: the replay and replay windows are both in the pure function of shared (see focus-session.ts). */
      const applyFocusSession = (data: unknown): void => {
        const cue = readFocusSession(data, Date.now(), lastFocusTsRef.current);
        if (cue === null) return;
        lastFocusTsRef.current = cue.ts;
        jumpToSession(cue.sessionId);
      };
      /** Segmented leaf → consumer side effect; the unknown name has been blocked by resolveLeafPath. */
      const applySection = (name: SectionLeafName, leaf: StateLeaf): void => {
        switch (name) {
          case 'config':
            // The configuration has been changed elsewhere (the only writing party is POST /pet-display), pull it
            // again and flatten it. Leaf data is just a signal, the configuration body is too big to fit into /state.
            petBridge.reload();
            return;
          case 'balance': {
            const hit = readBalance(leaf);
            if (hit) applyBalanceRef.current(hit.state, hit.manual);
            return;
          }
          case 'workStatus': {
            const snap = readWorkStatus(leaf);
            if (snap) {
              setWorkStatus(snap);
              setWorkStatusTick((t) => t + 1); // Triggered by any change, including returning to idle. Work status report: same level as system notification, also
              // only sounds on the web page; do not write say leaf.
              speakWorkStatus(snap);
            }
            return;
          }
          case 'notify':
            // System notification: Single slot, host decides which one to keep, there are switches and permission gates inside.
            notifyFromFrame(leaf.data);
            return;
          case 'menu':
            // The third-party menu snapshot only updates ref and does not trigger rendering; the same copy is given to the menu image on the page for petApi7340.menuEvents to read.
            menuItemsRef.current = readMenuItems(leaf.data, 'web');
            setMenuItems(menuItemsRef.current);
            return;
          case 'focusSession':
            // The desktop pet clicks on the session bubble: the host writes the intention in this leaf, and the page switches to the session accordingly.
            applyFocusSession(leaf.data);
            return;
        }
      };

      /** Pet Leaf → The command slot of this pet; the serial number is incremented, and the card knows "Written again" accordingly. */
      const applyPetLeaf = (name: PetLeafName, petId: string, leaf: StateLeaf): void => {
        switch (name) {
          case 'say': {
            const said = readSay(leaf);
            if (!said) return;
            sayRef.current[petId] = { ...said, seq: (sayRef.current[petId]?.seq ?? 0) + 1 };
            setSayTick((t) => t + 1);
            return;
          }
          case 'anim': {
            // counter will be incremented every time it is written, and even clicking twice will distribute it twice.
            const hit = readAnim(leaf);
            if (!hit) return;
            animCueRef.current[petId] = {
              name: hit.name,
              url: hit.url,
              playbackId: hit.playbackId,
              facing: hit.facing,
              seq: (animCueRef.current[petId]?.seq ?? 0) + 1,
            };
            setAnimCueTick((t) => t + 1);
            return;
          }
          case 'position': {
            const hit = readPosition(leaf);
            if (!hit) return;
            posCueRef.current[petId] = { ...hit, seq: (posCueRef.current[petId]?.seq ?? 0) + 1 };
            setPosCueTick((t) => t + 1);
            return;
          }
          case 'throw': {
            const hit = readThrow(leaf);
            if (!hit) return;
            throwCueRef.current[petId] = { ...hit, seq: (throwCueRef.current[petId]?.seq ?? 0) + 1 };
            setThrowCueTick((t) => t + 1);
            return;
          }
          case 'lock': {
            // The occupation lock is a state rather than a command: the card releases itself by pressing expiresAt.
            const hit = readLock(leaf);
            if (!hit) return;
            lockRef.current[petId] = hit;
            setLockTick((t) => t + 1);
            return;
          }
          case 'sleep': {
            // Sleeping is also a state: the card plays "Start→Loop→Get Up" according to three names, and returns to a random chain after waking up.
            const hit = readSleep(leaf);
            if (!hit) return;
            sleepRef.current[petId] = hit;
            setSleepTick((t) => t + 1);
            return;
          }
        }
      };

      /** Apply a polling state: only the baseline is recorded in the first pull, and then distributed one by one according to counter changes. */
      const applyState = (s: PollState) => {
        // The latest shot is reserved for the same page consumer (petApi7340.getState): it reads the same object and does not occupy the connection.
        setStateSnapshot(s);
        if (baseline === null) {
          baseline = flattenCounters(s); // The first pull only remembers the baseline and does not render. Jumping a session is a one-time signal: the entry
          // written when the page is not open will be swallowed up by the first pull baseline. Here, it will be filled in
          // according to the writing time.
          applyFocusSession(s.sections.focusSession?.data);
          // The menu item is the current state rather than the event. The first pull must also be installed, otherwise the third-party menu will remain empty after refreshing.
          menuItemsRef.current = readMenuItems(s.sections.menu?.data, 'web');
          setMenuItems(menuItemsRef.current);
          // Sleeping is also a state rather than an event: when refreshing the page, the host still remembers that it
          // is sleeping, and the first pull must be made up once; otherwise, the page shows that it is awake, and the
          // host does not write back the "already sleeping" leaf, and can only be restored after the host restarts.
          for (const [petId, entry] of Object.entries(s.pets)) {
            const hit = entry?.sleep?.data == null ? null : readSleep(entry.sleep);
            if (hit) sleepRef.current[petId] = hit;
          }
          setSleepTick((t) => t + 1);
          return;
        }
        for (const { path, leaf } of takeChanged(s, baseline)) {
          if (leaf.data === null) continue;
          const target = resolveLeafPath(path);
          // Unrecognized paths (new leaves, keys written incorrectly elsewhere) are silently skipped.
          if (target === null) continue;
          if (target.where === 'section') applySection(target.name, leaf);
          else applyPetLeaf(target.name, target.petId, leaf);
        }
      };
      // Self-scheduling polling in pet/state-poll.ts: Only pulling and distribution are provided here.
      void runStatePoll({
        fetch: (options) =>
          fetchState(
            undefined,
            options === undefined ? undefined : { since: options.since, timeoutMs: options.timeoutMs },
          ),
        onState: applyState,
        waitMs: STATE_WAIT_MS,
        fallbackMs: STATE_FALLBACK_MS,
        isAlive: () => alive,
      });
      return () => {
        alive = false;
      };
    }, [ready]);

    return ready
      ? visiblePets.map((p) => {
          // Working status linkage is not enabled: it is disconnected at the distribution point, and the downstream (animation recovery, playback determination, bubble) does not need to be judged once each.
          const workOn = p.workStatusEnabled;
          return h(Card, {
            key: p.id,
            cfg: p as RuntimePet,
            balance,
            balanceTick,
            balanceNoticeTick,
            balanceManual,
            workStatus: workOn ? workStatus : null,
            workStatusTick: workOn ? workStatusTick : 0,
            onFocusSession: jumpToSession,
            say: sayRef.current[p.id],
            sayTick,
            animCue: animCueRef.current[p.id],
            animCueTick,
            posCue: posCueRef.current[p.id],
            posCueTick,
            throwCue: throwCueRef.current[p.id],
            throwCueTick,
            lock: lockRef.current[p.id],
            lockTick,
            sleep: sleepRef.current[p.id],
            sleepTick,
            menuItemsRef,
            arena: arenaRef,
          });
        })
      : null;
  };
}
