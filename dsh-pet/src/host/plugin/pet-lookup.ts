/**
 * Pet positioning and access guard: Press ? pet = to find the instance, press surface to determine if the lock is
 * occupied, and give a failure response that can be returned directly.
 *
 * Does not read media outside the configuration, only passes the onChange synchronization lock status to S.
 * Dependencies are explicitly passed in by apply (see input type), and the module does not read globals or create
 * singletons.
 * @module dsh-pet/src/host/plugin/pet-lookup
 */
import { LockStore } from '../lock.ts';
import { PoseStore } from '../pose.ts';
import { SURFACE_TEXT, displayCovers, normalizeSurface, type Surface } from '../surface.ts';
import { type RouteResult } from '../http.ts';
import { failResult } from '../routes/result.ts';
import { findPetInstance, readAllConfig } from '../config.ts';
import { pickSleepText, SleepStore, sleepTextsOf } from '../sleep.ts';
import type { HostSetup } from './setup.ts';

/** Input for pet positioning and access guards: assembly period objects and earlier factories. */
export type PetLookupInput = {} & Pick<HostSetup, 'state' | 'configPaths'>;

/**
 * Create pet location and access guards.
 */
export function createPetLookup(deps: PetLookupInput) {
  const { configPaths, state } = deps;
  // Occupied lock (Item 4 of issue #122): One lock in the memory state + TTL, this pet is exclusive during the
  // third-party linkage period - except for the lock holder, the random chain, whisper, balance, and working status
  // will all give way. It does not have a timer of its own: expiration is lazy, and the `expiresAt` in the leaf is the
  // only truth. The renderer releases the static state accordingly; here it is only responsible for synchronizing the
  // state changes into the `pets.<id>.lock` of S.
  const lock = new LockStore({
    onChange: (petId, data) => state.writePet(petId, 'lock', data),
  });

  // Live snapshot (issue #122 Article 1): Report when the desktop renderer changes, and third parties can use GET /
  // pose to read it. The web page does not go here - its location is generated for each page, and the Cordis service
  // `petApi7340` within the page is used.
  const pose = new PoseStore();

  // Sleeping state: The memory session state of the same layer as the occupied lock. The state changes are
  // synchronized into S and `pets.<id>.sleep` . The three animation names are selected by the host and put into the
  // leaves, and the renderer plays them accordingly; the host uses them to block automatic sources and manual
  // triggers.
  const sleep = new SleepStore({
    onChange: (petId, data) => state.writePet(petId, 'sleep', data),
  });

  /**
   * This entry's sleeping refusal line. The lines can only be configured with one source (the default value is
   * assets/config.jsonc, and the merge layer is responsible for fallback); an empty pool indicates that the
   * configuration is damaged, and undefined is returned at this time. It is better not to speak than to copy another
   * copy in the code.
   */
  const refuseText = (petId: string): string | undefined => {
    try {
      const found = findPetInstance(readAllConfig(configPaths), petId);
      return pickSleepText(sleepTextsOf(found?.conf ?? {}).refuse);
    } catch {
      return undefined; // Unreadable configuration (corrupted installation): Refuse to follow instructions, just no lines
    }
  };

  /**
   * Sleep gate (manual trigger shared with third-party calls): While sleeping → play a rejection line and return
   * `sleeping` ; otherwise, release and return to null.
   *
   * Give way when the lock is held: When taking the lock, the pet will be woken up first, and it cannot go here under
   * normal circumstances; leaving it is the short fallback of the race state "before the lock leaf returns to the
   * renderer" (the host has accepted the lock, and the renderer status has not caught up yet). Refuse to write lines
   * into `say` and `anim: false` - the animation will not be changed during sleep, only bubbles will be played.
   */
  const sleepBlocked = (petId: string): RouteResult | null => {
    if (!sleep.sleeping(petId)) return null;
    if (lock.locked(petId)) return null;
    const text = refuseText(petId);
    if (text !== undefined) state.writePet(petId, 'say', { text, anim: false });
    return failResult('sleeping', '桌宠正在睡觉，先叫醒它');
  };

  /**
   * Parameter level verification of `?surface=` (default/invalid → `bad-request` ). Place it before reading the disk:
   * the request that must fail will not touch the disk; if it passes, the narrowed value will be given.
   */
  const surfaceParam = (params: URLSearchParams): { ok: true; want: Surface } | { ok: false; res: RouteResult } => {
    const want = normalizeSurface(params.get('surface'));
    if (want !== null) return { ok: true, want };
    return { ok: false, res: failResult('bad-request', SURFACE_TEXT) };
  };

  /**
   * The alignment check between `?surface=` and the pet `display` : does not satisfy → `pet-not-displayed` , and the
   * actual display is returned to the caller as it is; released back to null. This is pre-verification, not
   * face-to-face distribution - the instructions are still written into the same leaf, and the content at both ends is
   * exactly the same.
   */
  const surfaceMismatch = (pet: Record<string, unknown>, petId: string, want: Surface): RouteResult | null => {
    const display = String(pet.display ?? '');
    if (displayCovers(want, display)) return null;
    return failResult('pet-not-displayed', petId + ' 的显示模式是 ' + display + '，不满足 surface=' + want, {
      display,
    });
  };

  /**
   * surface verification after the decision function (shared by / anim, / broadcast, / bubble/clear, / position, /
   * throw): The pet parsing of these items lives in their respective decision modules, so press petId to check again
   * and get the instance display . The position is consistent with lockBlocked - after the decision function and
   * before any side effect, the order is "body → pet → surface → lock".
   */
  const surfaceBlocked = (
    cfg: Record<string, Record<string, unknown>>,
    petId: string,
    params: URLSearchParams,
  ): RouteResult | null => {
    const p = surfaceParam(params);
    if (!p.ok) return p.res;
    return surfaceMismatch(findPetInstance(cfg, petId)?.pet ?? {}, petId, p.want);
  };

  /**
   * pet parameter analysis at the route layer (for / lock, / lock/release, / whisper, / chat; the same set of
   * verification for other action endpoints is in their respective decision-making modules, and the conventions are
   * consistent): required and must actually exist.
   *
   * Two types of failures are reported separately: not given / empty string → `pet-required` ; given but not in the
   * configuration → `unknown-pet` . Never return to the first one in the list by default - the placement point will
   * drift with the user/pet operation, failure will not be reported, and third parties have no way of predicting it.
   *
   * `cfg` passes lazy reading: pet does not need to touch the disk when the string is empty (the "configuration
   * unreachable" assertion of routes.test.ts relies on this sequence to verify). `opts.surface` is only enabled for
   * endpoints that will produce renderer visible effects; GET of /lock/release and /chat is not enabled - the release
   * must always be successful, and the read memory has nothing to do with which end it is displayed on.
   */
  const requirePet = (
    params: URLSearchParams,
    cfg: () => Record<string, Record<string, unknown>>,
    opts?: { surface?: boolean },
  ):
    | { ok: true; petId: string; entry: string; conf: Record<string, unknown>; pet: Record<string, unknown> }
    | { ok: false; res: RouteResult } => {
    const fail = (reason: 'pet-required' | 'unknown-pet', message: string): { ok: false; res: RouteResult } => ({
      ok: false,
      res: failResult(reason, message),
    });
    const petId = String(params.get('pet') ?? '').trim();
    if (!petId) return fail('pet-required', 'pet 必填：要指定操作哪只桌宠');
    // surface is divided into two steps: parameter level verification before reading the disk (requests that must fail do not touch the disk), and display mode verification after the pet is found.
    let want: Surface | null = null;
    if (opts?.surface === true) {
      const p = surfaceParam(params);
      if (!p.ok) return { ok: false, res: p.res };
      want = p.want;
    }
    // A search gives both "existence" and "ownership entry" (entry is the asset root, / chat is used to read the
    // memory bucket) + entry configuration (/ chat is used to get chatMemoryRounds) - what the caller gets is the
    // value in the snapshot during verification, and there is no need to check it again.
    const found = findPetInstance(cfg(), petId);
    if (!found) return fail('unknown-pet', '没有这只桌宠：' + petId);
    if (want !== null) {
      const mismatch = surfaceMismatch(found.pet, petId, want);
      if (mismatch) return { ok: false, res: mismatch };
    }
    return { ok: true, petId, entry: found.entry, conf: found.conf, pet: found.pet };
  };

  /**
   * Action endpoint occupation validation check (shared by / anim, / broadcast, / position, / throw, / bubble/clear):
   * Release back to null. When there is no lock, press "lock is brought or not" to shunt: not brought → released
   * (existing caller has zero changes); brought but not found → `lock-lost` . The position is after the decision
   * function: petId needs to be parsed first to know which pet lock to ask, and there is no side effect at that time.
   */
  const lockBlocked = (petId: string, params: URLSearchParams): RouteResult | null => {
    const g = lock.gate(petId, String(params.get('lock') ?? ''));
    if (g.ok) return null;
    return failResult(g.reason, g.message, g.reason === 'lock-lost' ? { cause: g.cause } : undefined);
  };
  return { lock, pose, sleep, sleepBlocked, sleepRefusalText: refuseText, surfaceBlocked, requirePet, lockBlocked };
}
/** Pet positioning and access guard output (for downstream factories on demand Pick). */
export type PetLookup = ReturnType<typeof createPetLookup>;
