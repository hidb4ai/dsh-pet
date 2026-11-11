/**
 * In-memory host sleep state: sleeping pets are excluded from automatic actions and reject manual triggers.
 *
 * Like ./lock, this is transient session state cleared by restart, not configuration. Locks are third-party leases
 * with a TTL; sleep is user intent and ends only on wake.
 * The renderer owns playback timing and uses the three animation names published in the state leaf.
 * Invariant: entering sleep writes all three names together; waking clears the whole state.
 * @module dsh-pet/src/host/sleep
 */

/** The name of a set of sleeping actions (the host selects it and writes it into the leaf, and the renderer broadcasts it as start → loop → end). */
export interface SleepSetNames {
  /** Transition to sleep (played once) */
  readonly start: string;
  /** Sleep loop (unlimited broadcast) */
  readonly loop: string;
  /** Wake up transition (played once) */
  readonly end: string;
}

/** Write the payload of `pets.<id>.sleep`; `sleeping: false` must also be written, and the renderer relies on it to cleanup. */
export type SleepLeafData = ({ sleeping: true } & SleepSetNames) | { sleeping: false };

/** The text pool has been narrowed: non-array and non-character string items will be discarded (the configuration has been verified, only manually modified files are prevented here). */
function textPool(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item !== '') : [];
}

/**
 * Choose a random line from the pool; return undefined for an empty pool so the caller shows no bubble.
 *
 * Defaults exist only in `assets/config.jsonc` , and merging restores them for missing/invalid fields. An empty pool
 * therefore indicates broken configuration;
 * remain silent instead of duplicating fallback dialogue in code.
 */
export function pickSleepText(pool: readonly string[]): string | undefined {
  return pool.length > 0 ? pool[Math.floor(Math.random() * pool.length)] : undefined;
}

/** Parsed entry-level sleep dialogue and contextual prompts. Empty values are unconfigured; callers skip the bubble or prompt addition. */
export interface SleepTexts {
  start: string[];
  end: string[];
  refuse: string[];
}

/** Narrow sleep dialogue to usable string pools; the merge layer has already supplied defaults. */
export function sleepTextsOf(conf: Record<string, unknown>): SleepTexts {
  return {
    start: textPool(conf.sleepStartTexts),
    end: textPool(conf.sleepEndTexts),
    refuse: textPool(conf.sleepRefuseTexts),
  };
}

/** The pool is narrowed: non-array and non-character string items are discarded (the configuration has been verified, only manually modified files are prevented here). */
function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item !== '') : [];
}

/**
 * Choose one set from merged `animations.sleep` , then select each of its three clips independently.
 *
 * Select the outer set only once so entering sleep and waking use compatible poses.
 * @param animations - Merged animations from any configuration entry.
 * @param roll - Random source; tests inject deterministic values.
 * @returns Three animation names, or null when no usable set exists and sleep must be refused.
 */
export function pickSleepNames(animations: unknown, roll: () => number = Math.random): SleepSetNames | null {
  const conf = animations && typeof animations === 'object' ? (animations as Record<string, unknown>) : {};
  const sets = Array.isArray(conf.sleep) ? conf.sleep : [];
  const usable: SleepSetNames[] = [];
  for (const set of sets) {
    if (!set || typeof set !== 'object') continue;
    const entry = set as Record<string, unknown>;
    const start = strings(entry.start);
    const loop = strings(entry.loop);
    const end = strings(entry.end);
    if (!start.length || !loop.length || !end.length) continue;
    usable.push({
      start: start[Math.floor(roll() * start.length)],
      loop: loop[Math.floor(roll() * loop.length)],
      end: end[Math.floor(roll() * end.length)],
    });
  }
  if (!usable.length) return null;
  return usable[Math.floor(roll() * usable.length)];
}

/** Sleep status table (one for each plugin instance; in-process memory state, wakes up when host restarts). */
export class SleepStore {
  // Using declare + constructor assignment: The class field initializer will downgrade @oxc - project/runtime external
  // helper, which is an undeclared dependency and will be blocked by prepack validation check (same agreement with ./
  // state and ./lock).
  /** petId to the animation set selected for its current sleep session. */
  declare private readonly sets: Map<string, SleepSetNames>;
  /** Publish the state leaf after entering sleep, waking or waking all pets. */
  declare private readonly onChange: (petId: string, data: SleepLeafData) => void;

  constructor(opts?: { onChange?: (petId: string, data: SleepLeafData) => void }) {
    this.sets = new Map();
    this.onChange = opts?.onChange ?? ((): void => {});
  }

  /** Is this pet sleeping at the moment? */
  sleeping(petId: string): boolean {
    return this.sets.has(petId);
  }

  /** The set of names chosen this time for sleeping; null when not sleeping. */
  setOf(petId: string): SleepSetNames | null {
    return this.sets.get(petId) ?? null;
  }

  /**
   * Enter sleep. If already asleep, keep the current set and do not rewrite the leaf; repeated requests must not
   * restart the animation.
   * @returns Whether this call actually entered sleep.
   */
  enter(petId: string, set: SleepSetNames): boolean {
    if (this.sets.has(petId)) return false;
    this.sets.set(petId, set);
    this.onChange(petId, { sleeping: true, ...set });
    return true;
  }

  /**
   * Wake the pet.
   * @returns Whether the pet left sleep; an already-awake pet is an idempotent no-op.
   */
  wake(petId: string): boolean {
    if (!this.sets.delete(petId)) return false;
    this.onChange(petId, { sleeping: false });
    return true;
  }

  /** Wake every pet during plugin disposal or helper restart so renderers do not remain in sleeping poses. */
  wakeAll(): void {
    for (const petId of [...this.sets.keys()]) this.wake(petId);
  }

  /** Is there any pet currently sleeping (the balance will be pulled globally to decide whether to skip the entire shot based on this). */
  anySleeping(): boolean {
    return this.sets.size > 0;
  }

  /** Sleeping pet id (for testing and logging; the order is not guaranteed). */
  ids(): string[] {
    return [...this.sets.keys()];
  }
}
