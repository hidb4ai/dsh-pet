/**
 * Pure selection logic: random selection, event state value, weighted dice roll, independent single test. Both ends
 * share the same copy, and the random chain must go here, otherwise the browser side and desktop Helper will
 * bifurcate. Does not depend on React / DOM.
 * @module dsh-pet/src/shared/pickers
 */
import type { Category, EventSlot, Events, Weights } from './types.ts';

/** Draw one from the pool with equal probability; exclude avoids a certain name (reduces continuous repetition). */
export const pick = <T>(pool: readonly T[], exclude?: T): T => {
  const entries = exclude ? pool.filter((n) => n !== exclude) : pool;
  // The pool is empty after exclusion (single element pool + exclusion of self): return to the original pool, and would rather repeat than return undefined
  const src = entries.length ? entries : pool;
  return src[Math.floor(Math.random() * src.length)];
};

/**
 * Choose a set of sleeping actions: the whole set is random, and the three steps the caller gets must be from the same
 * set (otherwise it will "fall asleep squatting and wake up lying down").
 *
 * @param sets - sleep set array in the configuration; if there are multiple candidates in the segment, the caller will
 * `pick` the selected set again.
 * @returns The selected suit; the empty array returns null, and the caller hides the "sleeping" entry point
 * accordingly.
 */
export const pickSleepSet = <T>(sets: readonly T[]): T | null =>
  sets.length > 0 ? sets[Math.floor(Math.random() * sets.length)] : null;

/**
 * Event state value: Character string slot is returned as is (fixed playback); array slot = candidate in the file,
 * randomly select 1 and try to avoid exclude. After exclusion, the pool is empty (single candidate and excludes
 * itself) and the original array is returned - it is better to repeat than return undefined.
 */
export const pickSlot = (slot: EventSlot, exclude?: string): string => {
  if (typeof slot === 'string') return slot;
  const entries = exclude === undefined ? slot : slot.filter((n) => n !== exclude);
  const src = entries.length ? entries : slot;
  return src[Math.floor(Math.random() * src.length)];
};

/** Whether the slot contains a certain animation name: compare the character string by name, and search the members in the array - direct includes will miss the array slot. */
export const slotIncludes = (slot: EventSlot, anim: string): boolean =>
  typeof slot === 'string' ? slot === anim : slot.includes(anim);

/** Does the event pool (state slot array) contain a certain animation name. */
export const poolIncludes = (pool: readonly EventSlot[], anim: string): boolean =>
  pool.some((slot) => slotIncludes(slot, anim));

/** Does the entire events segment contain an animation name. */
export const isEventAnim = (events: Readonly<Events> | undefined, anim: string): boolean =>
  events ? Object.values(events).some((pool) => poolIncludes(pool, anim)) : false;

/**
 * Resume broadcast decision after the working state is finished (ended): find the state that contains current, if there
 * are multiple candidate states, return to the next candidate in the state (excluding current to avoid continuous
 * draws), and let the long-term status automatically rotate; if the single candidate state or animation does not belong
 * to the pool, return to null. Both ends share the same decision-making, and the rotation behavior is strictly
 * consistent.
 */
export const nextWorkStatusAnim = (pool: readonly EventSlot[], current: string): string | null => {
  const idx = pool.findIndex((slot) => slotIncludes(slot, current));
  if (idx === -1) return null;
  const slot = pool[idx];
  if (!Array.isArray(slot) || slot.length <= 1) return null;
  return pickSlot(slot, current);
};

/** Generate random integers in the range [ min , max ). */
export const randomBetween = (min: number, max: number): number => Math.floor(min + Math.random() * (max - min));

/** Select a category in the category pool according to weight; when mirroring (to the right), exclude the noMirror category and normalize the remaining weights, and return null when the pool is empty. */
export const pickWeightedCategory = (categories: Category[], facing: string): Category | null => {
  const cats = categories.filter((c) => c.actions.length > 0);
  if (!cats.length) return null;
  const filtered = cats.filter((c) => !(c.noMirror && facing === 'right'));
  const eligible = filtered.length ? filtered : cats;
  const totalW = eligible.reduce((s, c) => s + c.weight, 0) || 1;
  let t = Math.random() * totalW;
  for (const c of eligible) {
    t -= c.weight;
    if (t <= 0) return c;
  }
  return eligible[eligible.length - 1];
};

/** Type of die roll result. */
export type RollKind = 'idle' | 'turn' | 'move' | 'action';

/** Dice roll options. */
export interface RollOptions {
  /**
   * Pet fixed (pets []. fixedEnabled): The weights of turn and move are calculated as 0, and the shares are naturally
   * classified into action. Without normalization - the absolute probability of idle remains unchanged, the simplest
   * implementation, and the degenerate configuration of idle =0 is also natural.
   */
  fixed?: boolean;
}

/**
 * Roll with weight: roll ∈ [0,1) → next animation category. (idle + turn + move) / 100 is the sum of the proportions
 * of these three levels, and the remaining probability is classified into action. When opts.fixed is true, the weight
 * of turn / move is calculated as 0, and only idle or action can be returned. Both ends share this function, and the
 * behavior of the random chain is strictly consistent.
 */
export const rollKind = (roll: number, w: Weights, opts?: RollOptions): RollKind => {
  const turn = opts?.fixed ? 0 : w.turn;
  const move = opts?.fixed ? 0 : w.move;
  const topEnd = (w.idle + turn + move) / 100;
  if (roll < w.idle / 100) return 'idle';
  if (roll < (w.idle + turn) / 100) return 'turn';
  if (roll < topEnd) return 'move';
  return 'action';
};

/**
 * Select an action from the category pool; fall back to the idle pool when no category is available. facing is used
 * for noMirror filtering and current is used to avoid consecutive repetitions.
 */
export const pickCategoryAction = (
  categories: Category[],
  idlePool: string[],
  facing: string,
  current: string,
): { id: string; name: string } => {
  const cat = pickWeightedCategory(categories, facing);
  if (!cat) return { id: 'FALLBACK', name: pick(idlePool, current) };
  return { id: cat.id, name: pick(cat.actions, current) };
};
