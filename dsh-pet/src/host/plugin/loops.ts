/**
 * Polling loop: The balance is refreshed regularly and whisper is triggered regularly, and stops when the plugin is
 * unmounted.
 *
 * It does not implement number retrieval and text (owned by balance-poll / chat-memory), but is only
 * responsible for rhythm and lifecycle.
 * @module dsh-pet/src/host/plugin/loops
 */
import { findPetInstance, flattenPetList, readAllConfig } from '../config.ts';
import { isDisplayed } from '../surface.ts';
import { automaticWhisperSchedule } from '../whisper-policy.ts';
import type { BalancePoll } from './balance-poll.ts';
import type { ChatMemory } from './chat-memory.ts';
import type { PetLookup } from './pet-lookup.ts';
import type { HostSetup } from './setup.ts';
import type { HostContext } from './context.ts';

/** Fallback value of sleep talking cycle (seconds): Use this when eventsRefreshSec.sleepTalk is missing/invalid in the configuration. */
const SLEEP_TALK_DEFAULT_SEC = 60;

/** The gap between two adjacent ones in the staggered queue (ms): only when the pets that are photographed at the same time speak in sequence will the bubbling and voice be staggered. */
const WHISPER_STAGGER_MS = 10_000;

/** The upper limit of the off-peak queue is: 6 × 10 s = 60 s, which just covers the shortest period, and the queue will not chase and run away. */
const WHISPER_QUEUE_MAX = 6;

/** Input to polling loop. */
export type LoopsInput = {
  /** host context (the one apply received). */
  ctx: HostContext;
} & Pick<BalancePoll, 'balancePeriodSec'> &
  Pick<HostSetup, 'configPaths'> &
  Pick<ChatMemory, 'lastWhisperAt'> &
  Pick<PetLookup, 'lock'> &
  Pick<PetLookup, 'sleep'> &
  Pick<HostSetup, 'log'> &
  Pick<ChatMemory, 'publishWhisper'> &
  Pick<ChatMemory, 'publishSleepTalk'> &
  Pick<BalancePoll, 'refreshBalance'> &
  Pick<HostSetup, 'standaloneAiPolicy'> &
  Pick<BalancePoll, 'whisperPeriodSec'>;

/** register polling loop; the returned cleanup function is collected by ctx.effect. */
export function registerLoops(deps: LoopsInput): void {
  const {
    ctx,
    balancePeriodSec,
    configPaths,
    lastWhisperAt,
    lock,
    log,
    publishWhisper,
    publishSleepTalk,
    refreshBalance,
    sleep,
    standaloneAiPolicy,
    whisperPeriodSec,
  } = deps;
  // Balance cycle refresh: host side only timer. The configuration eventsRefreshSec.balance is re-read every cycle,
  // and the next tick is changed to keep up. Skip query when there are no balance-enabled pets: respect configuration
  // and not waste external API calls.
  ctx.effect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    function arm(sec: number): void {
      if (disposed) return;
      timer = setTimeout(() => void tick(), Math.max(1000, sec * 1000));
    }
    async function tick(): Promise<void> {
      let sec: number;
      try {
        const cfg = readAllConfig(configPaths);
        sec = balancePeriodSec(cfg);
        // There are no pets that are "awake and have balance enabled" → Do not check (save external calls): A sleeping
        // pet cannot see or hear, and pulling it will only waste an external API; if the configuration is changed or
        // wakes up, the next tick will naturally follow.
        const pets = flattenPetList(cfg);
        if (pets.some((p) => p.balanceEnabled === true && !sleep.sleeping(String(p.id ?? '')))) {
          await refreshBalance();
        } else {
          log.info('[dsh-pet] Skipping scheduled balance refresh: no awake pet has balance enabled');
        }
      } catch (e) {
        // An error is thrown when reading the configuration = the installation is damaged (readAllConfig is only
        // thrown when the built-in default is missing/damaged, and if the user layer is damaged, it will only alert
        // and fall back): No more rearrangement - retrying every 30 minutes is meaningless, and will occupy a resident
        // timer in vain. Leave a line warn: This path will permanently stop the balance cycle. Not logging is
        // indistinguishable from "checked but no change".
        log.warn(
          '[dsh-pet] Scheduled balance configuration read failed; refresh stopped until DSH restarts:' +
            (e instanceof Error ? e.message : String(e)),
        );
        return;
      }
      arm(sec);
    }
    void tick(); // Pull once at startup, without waiting for the first cycle
    return () => {
      disposed = true;
      if (timer !== null) clearTimeout(timer);
    };
  }, 'dsh-pet: balance poll');

  // whisper cycle: host side scheduling. One tick = read the configuration once + queue the pets that have reached the
  // "point" into the off-peak queue; next tick is arranged according to the shortest period. Use fixed beat +
  // pet-by-pet comparison to compare lastWhisperAt instead of one timer for each pet: pets are added and deleted with
  // the configuration, and the cycle changes with the entries. The fixed beat can naturally keep up, and there is no
  // need to maintain a lifecycle of a bunch of timers.
  ctx.effect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    /** Pets to be released (FIFO); only one will be released at a time, separated by {@link WHISPER_STAGGER_MS}. */
    const pending: string[] = [];
    /** The waiting handle between two adjacent ones in the queue is counted separately from the shooting timer, and both must be cleared when unmounting. */
    let drainTimer: ReturnType<typeof setTimeout> | null = null;

    /** Is there already one being generated? Only one is allowed at the same time, otherwise both will still write bubbles at the same time. */
    let pumping = false;

    /**
     * Take a release from the queue, wait for it to be written, and then send the next one at an interval.
     *
     * The interval is calculated from "the text is actually written into the state", not from the initial counting:
     * the time taken for a single generation fluctuates between 3-15 seconds, and the fixed interval calculated from
     * the initial counting will be eaten by the slower one, and the two will collide together.
     */
    async function pump(): Promise<void> {
      if (disposed || pumping || drainTimer !== null) return;
      const petId = pending.shift();
      if (petId === undefined) return;
      pumping = true;
      try {
        // kind = whisper Let the generated side press voiceWhisperEnabled to decide whether to bring voiceTo.
        await publishWhisper(petId, undefined, undefined, 'whisper');
      } catch {
        // A single pet failed to block the following pets: the reason has been recorded in the log by publishWhisper.
      } finally {
        pumping = false;
      }
      if (disposed || pending.length === 0) return;
      drainTimer = setTimeout(() => {
        drainTimer = null;
        void pump();
      }, WHISPER_STAGGER_MS);
    }

    function arm(sec: number): void {
      if (disposed) return;
      timer = setTimeout(() => void tick(), Math.max(1000, sec * 1000));
    }
    function tick(): void {
      let next = 300;
      try {
        const cfg = readAllConfig(configPaths);
        const now = Date.now();
        let min = Infinity;
        // Account for each shot: how many animals were checked, how many were on point, how many were not on point, and how many were skipped (with reasons). Only used for logging, scheduling behavior remains unchanged.
        let checked = 0;
        let due = 0;
        let notDue = 0;
        const skipped: string[] = [];
        for (const pet of flattenPetList(cfg)) {
          const petId = String(pet.id ?? '');
          if (!petId) continue;
          // petId is flattened from the same cfg, so it must hit (findPetInstance and flattenPetList search the same
          // set); if not found, it may only be due to the drift of the two conventions - skip this beat, do not guess
          // or fallback main.
          const found = findPetInstance(cfg, petId);
          if (!found) continue;
          checked += 1;
          const schedule = automaticWhisperSchedule(
            standaloneAiPolicy(),
            pet.whisperEnabled === true,
            whisperPeriodSec(found.conf),
          );
          if (!schedule.enabled) {
            // The two types of "not enabled" are recorded separately: the pet turns off by itself, and the standalone mode AI is not ready, and the processing methods are completely different.
            skipped.push(
              petId + ': ' + (pet.whisperEnabled === true ? 'standalone AI is not ready' : 'whisperEnabled=false'),
            );
            continue;
          }
          // Pets that are not displayed in the configuration are not generated: if the user selects "display none",
          // then they do not need to use it. Continuing to adjust the model in the background is purely a waste of
          // money (#237). Place before min: Invisible pets should not hold up the entire shot cycle. Do not advance
          // lastWhisperAt - the same conventions as the occupied lock, and the next tick will be added immediately
          // after it becomes visible again.
          const display = String(pet.display ?? '');
          if (!isDisplayed(display)) {
            skipped.push(petId + ': display=none');
            continue;
          }
          const sec = schedule.periodSec;
          min = Math.min(min, sec);
          if (now - (lastWhisperAt.get(petId) ?? 0) < sec * 1000) {
            notDue += 1;
            continue;
          }
          // Occupied lock: Skip this beat when this pet is occupied - neither generated nor supplemented (whisper is a
          // transient event, discarded after expiration), and does not advance lastWhisperAt: As soon as the lock is
          // released, the next tick should be said as usual. Only this per-pet source is blocked; the global segment
          // (balance / workStatus) is ignored by the renderer - skipping writing by the host will also mute other
          // pets.
          if (lock.locked(petId)) {
            skipped.push(petId + ': skipped because the pet is locked');
            continue;
          }
          // Sleeping: neither generated nor advanced lastWhisperAt - add the next tick immediately after waking up, which has the same conventions as occupying the lock.
          if (sleep.sleeping(petId)) {
            skipped.push(petId + ': sleeping');
            continue;
          }
          // The queue has an upper limit: when there are many pets and the cycle is short, it is better to say a few words less in this tick than to chase the next tick at the wrong peak.
          if (pending.length >= WHISPER_QUEUE_MAX) {
            skipped.push(petId + ': stagger queue is full');
            continue;
          }
          due += 1;
          // Note during scheduling: queuing does not change the period semantics, only one sentence is still sent every sec seconds.
          lastWhisperAt.set(petId, now);
          log.info(`[dsh-pet] Whisper due pet=${petId} (interval ${sec}s); queued`);
          pending.push(petId);
        }
        void pump(); // The pets that have been photographed will be released one by one.
        if (Number.isFinite(min)) next = min;
        // One-line summary of each tick: whether the schedule is still running, how long the next tick is, and why it was skipped, all in this line (300 s per line, the amount can be ignored)
        log.info(
          `[dsh-pet] Whisper scheduling: checked=${checked}, due=${due}, notDue=${notDue}, skipped=${skipped.length}` +
            (due > 1 ? `; ${due} pets scheduled ${WHISPER_STAGGER_MS / 1000}s apart` : '') +
            (skipped.length > 0 ? `（${skipped.join('；')}）` : '') +
            `; next tick in ${next}s`,
        );
      } catch (e) {
        // An error is thrown when reading the configuration = the installation is damaged (same as the balance timer):
        // no more rearrangement, don’t occupy the resident handle in vain. But you must leave one line warn: this path
        // will make automatic whisper stop permanently.
        log.warn(
          '[dsh-pet] Whisper configuration read failed; automatic whispers stopped until DSH restarts:' +
            (e instanceof Error ? e.message : String(e)),
        );
        return;
      }
      arm(next);
    }
    void tick(); // Generate once at startup, not waiting for the first cycle
    return () => {
      disposed = true;
      if (timer !== null) clearTimeout(timer);
      if (drainTimer !== null) clearTimeout(drainTimer);
    };
  }, 'dsh-pet: whisper poll');

  // Sleep talking cycle: only for sleeping pets, ranked according to eventsRefreshSec.sleepTalk of their respective
  // entries. The same form as whisper (fixed beat + pet-by-pet comparison lastAt), pet additions and deletions and
  // periodic changes can naturally keep up.
  ctx.effect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    /** petId → The last time you talked in your sleep; it is not clear when you wake up. The next time you fall asleep, it will naturally continue according to the cycle. */
    const lastTalkAt = new Map<string, number>();
    function arm(sec: number): void {
      if (disposed) return;
      timer = setTimeout(() => void tick(), Math.max(1000, sec * 1000));
    }
    function tick(): void {
      let next = SLEEP_TALK_DEFAULT_SEC;
      try {
        const cfg = readAllConfig(configPaths);
        const now = Date.now();
        let min = Infinity;
        for (const petId of sleep.ids()) {
          const found = findPetInstance(cfg, petId);
          if (!found) continue;
          const sec = sleepTalkPeriodSec(found.conf);
          min = Math.min(min, sec);
          if (now - (lastTalkAt.get(petId) ?? 0) < sec * 1000) continue;
          lastTalkAt.set(petId, now);
          // No await: It takes a few seconds to generate, don’t delay the scheduling
          void publishSleepTalk(petId).catch(() => {});
        }
        if (Number.isFinite(min)) next = min;
      } catch (e) {
        // Reading configuration error = installation damage: stop this loop and leave a line of log (same conventions as the other two loops)
        log.warn(
          '[dsh-pet] Dream speech configuration read failed; scheduler stopped until DSH restarts:' +
            (e instanceof Error ? e.message : String(e)),
        );
        return;
      }
      arm(next);
    }
    void tick();
    return () => {
      disposed = true;
      if (timer !== null) clearTimeout(timer);
    };
  }, 'dsh-pet: sleep talk poll');
}

/** Sleep talking period (seconds): Entry level eventsRefreshSec.sleepTalk, if not read, press 60 fallback (same conventions as configuration comments). */
function sleepTalkPeriodSec(conf: Record<string, unknown>): number {
  const table = conf.eventsRefreshSec as Record<string, unknown> | undefined;
  const sec = Number(table?.sleepTalk);
  return Number.isFinite(sec) && sec > 0 ? sec : SLEEP_TALK_DEFAULT_SEC;
}
