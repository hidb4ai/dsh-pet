/**
 * To-do reminder loop: select a to-do item at regular intervals and let the currently visible desktop pet say
 * something.
 *
 * It does not determine the rhythm and text (returned to ../todo/policy), nor does it read or write files
 * (returned to ../todo/store). Each tick can only say one at most to avoid flushing the screen when multiple entries
 * expire at the same time; write S before recording lastRemindedAt, so it will not be repeated after restarting. When
 * there is no visible pet or it is occupied by a third party, it will be skipped and not advanced - the next tick
 * after the conditions are met will be filled in immediately, and this reminder will not be lost.
 * @module dsh-pet/src/host/plugin/todo-reminders
 */
import { pickVoiceSurface } from '../surface.ts';
import { pickReminder, reminderText } from '../todo/policy.ts';
import type { TodoStore } from '../todo/store.ts';
import type { LockStore } from '../lock.ts';
import type { PollStateStore } from '../state.ts';
import type { HostSetup } from './setup.ts';
import type { PetLookup } from './pet-lookup.ts';
import type { HostContext } from './context.ts';

/** Patrol search interval (ms): It can be one level smaller than the shortest reminder interval (5 minutes), it does not need to be more dense. */
const TICK_MS = 60 * 1000;

/** Reminder bubble dwell time (ms): a little longer than the default 10 seconds. Things you owe are worth a second look. */
const BUBBLE_DURATION_MS = 15 * 1000;

/** Minimum ability required for one shot (same shape as full input, easy to test avatars). */
export interface TodoReminderTickDeps {
  /** To-do storage: read the list and remember the reminder time. */
  todos: Pick<TodoStore, 'list' | 'markReminded'>;
  /** Currently effective pet list (resolved configuration is flat). */
  effectivePetList: () => Record<string, unknown>[];
  /** Occupation lock: Pets occupied by a third party will not be disturbed during this beat. */
  lock: Pick<LockStore, 'locked'>;
  /**
   * Don’t disturb a sleeping pet: The reminder is to “talk to it”. Even if you talk to it while it is asleep, it can’t
   * hear you. Try another one that is awake. By default, no sleep is considered (the old caller and test double do not
   * need to be changed).
   */
  isSleeping?: (petId: string) => boolean;
  /** polling status: Reminder is written to `pets.<id>.say`. */
  state: Pick<PollStateStore, 'writePet'>;
  /** Log export. */
  log: Pick<HostSetup['log'], 'info' | 'warn'>;
  /** Time source; test injects a fixed clock. */
  now?: () => number;
  /** Is there any terminal online (long polling is hanging). If not, no reminder: No one saw it after writing it into S, and the schedule was pushed forward in vain. */
  hasListener?: () => boolean;
  /** To-do broadcast switch (`main.voiceTodoEnabled` in resolved configuration): When turned off, `voiceTo` will not be written, only bubbles will be played. */
  isVoiceTodoEnabled: () => boolean;
}

/** Reminder loop input. */
export type TodoReminderInput = {
  /** host context (the one apply received). */
  ctx: HostContext;
  /** The number of terminals currently hanging long polling: >0 means someone can see this reminder. */
  waiterCount: () => number;
} & Pick<PetLookup, 'lock'> &
  Pick<PetLookup, 'sleep'> &
  Pick<TodoReminderTickDeps, 'todos' | 'effectivePetList' | 'state' | 'log' | 'isVoiceTodoEnabled'>;
/**
 * Choose a pet that will be responsible for this reminder: the ones visible on the web page will be given priority,
 * followed by the desktop; those occupied by third parties will be skipped.
 *
 * @param pets - The pet list after the finished configuration is flattened.
 * @param isLocked - Whether the pet is occupied.
 * @returns pet id; no available return null.
 * @internal
 */
export function pickReminderSpeaker(
  pets: readonly Record<string, unknown>[],
  isLocked: (petId: string) => boolean,
  isSleeping: (petId: string) => boolean = () => false,
): string | null {
  let desktopOnly: string | null = null;
  for (const pet of pets) {
    const petId = String(pet.id ?? '');
    if (petId === '') continue;
    if (pet.display === 'none') continue;
    if (isLocked(petId)) continue;
    if (isSleeping(petId)) continue;
    if (pet.display === 'web' || pet.display === 'both') return petId;
    desktopOnly ??= petId;
  }
  return desktopOnly;
}

/**
 * Run for a beat: you can be reminded at most once, and the reminder time will be recorded after success.
 *
 * @param deps - Storage, pet list, locks and status writing.
 * @returns has no return value; it returns silently when there is no arrival point or there are no pets to speak.
 */
export async function tickTodoReminders(deps: TodoReminderTickDeps): Promise<void> {
  // When there is no terminal online, the whole shot is skipped and not advanced. lastRemindedAt: The next time someone connects, it will still be in the "point" state.
  if (deps.hasListener !== undefined && !deps.hasListener()) return;
  const now = deps.now?.() ?? Date.now();
  const due = pickReminder(await deps.todos.list(), now);
  if (due === null) return;
  const pets = deps.effectivePetList();
  const speaker = pickReminderSpeaker(
    pets,
    (petId) => deps.lock.locked(petId),
    (petId) => deps.isSleeping?.(petId) ?? false,
  );
  if (speaker === null) return;
  // Which end should be read: pickReminderSpeaker has been excluded from display = none, so it will not be null
  // (defensive reservation is optional); when the broadcast switch is turned off, simply do not write this key (no
  // leaf = no one reads it), the bubble will still play.
  const display = String(pets.find((pet) => String(pet.id ?? '') === speaker)?.display ?? '');
  const voiceTo = deps.isVoiceTodoEnabled() ? pickVoiceSurface(display) : null;
  deps.state.writePet(speaker, 'say', {
    text: reminderText(due.todo, now),
    duration: BUBBLE_DURATION_MS,
    ...(voiceTo ? { voiceTo } : {}),
  });
  await deps.todos.markReminded(due.todo.id, now);
  // Only remember id and remaining time: the to-do text is user content and will not be entered in the log.
  const remainingSec = due.todo.dueAt === null ? 0 : Math.round((due.todo.dueAt - now) / 1000);
  deps.log.info(`[dsh-pet] To-do reminder todo=${due.todo.id} pet=${speaker} remaining=${remainingSec}s`);
}

/**
 * register reminder loop; the returned cleanup function is collected by ctx.effect.
 *
 * @param deps - host context with a beat required capabilities.
 */
export function registerTodoReminders(deps: TodoReminderInput): void {
  const { ctx, effectivePetList, isVoiceTodoEnabled, lock, log, sleep, state, todos, waiterCount } = deps;

  /** One shot: Only log will be logged if failed, and the cycle will not be stopped. */
  const tick = async (): Promise<void> => {
    try {
      await tickTodoReminders({
        effectivePetList,
        hasListener: () => waiterCount() > 0,
        isSleeping: (petId) => sleep.sleeping(petId),
        isVoiceTodoEnabled,
        lock,
        log,
        state,
        todos,
      });
    } catch (error) {
      log.warn('[dsh-pet] To-do reminder failed:' + (error instanceof Error ? error.message : String(error)));
    }
  };

  ctx.effect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    /** Queue next tick; if it is unmounted, it will not be queued again. */
    function arm(): void {
      if (disposed) return;
      timer = setTimeout(() => void run(), TICK_MS);
    }

    /** Run one tick and then schedule next tick: Check once at startup, without waiting for the first cycle. */
    async function run(): Promise<void> {
      timer = null;
      await tick();
      arm();
    }

    void run();
    return () => {
      disposed = true;
      if (timer !== null) clearTimeout(timer);
    };
  }, 'dsh-pet: todo reminders');
}
