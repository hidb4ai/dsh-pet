/**
 * Sleeping: `POST /sleep?pet=` puts it to sleep, `POST /wake?pet=` wakes it up.
 *
 * The host only does two things: select a set of animation names and write them into `pets.<id>.sleep` , and remove
 * this pet from the automatic source; the timing of playing start → loop → end is the responsibility of the renderer
 * (only it knows when the video is finished). The three-part name is fixed here, and the renderer no longer chooses it
 * by itself - otherwise different sets will be broadcast at both ends. Failure is always HTTP 200 + failed entity;
 * method errors are given real status codes by the protocol constructor.
 * @module dsh-pet/src/host/routes/sleep
 */
import { readAllConfig } from '../config.ts';
import { pickSleepNames, pickSleepText, sleepTextsOf } from '../sleep.ts';
import type { PetRouteDeps, RouteInput } from './types.ts';
import type { RouteResult } from '../http.ts';
import { failResult, methodNotAllowed, okResult } from './result.ts';

/** Sleeping area: undefined is returned for misses, and response is returned for hits. */
export async function handleSleepRoutes(deps: PetRouteDeps, input: RouteInput): Promise<RouteResult | undefined> {
  const { configPaths, lock, requirePet, sleep, state } = deps;
  const { method, rest, url } = input;
  // Each of the two branches writes once to determine the equality of the literal: check-openapi. According to this writing method, collect the route implemented by the host.
  const isSleep = rest === 'sleep';
  const isWake = rest === 'wake';
  if (!isSleep && !isWake) return undefined;
  if (method !== 'POST') return methodNotAllowed();

  try {
    const who = requirePet(url.searchParams, () => readAllConfig(configPaths));
    if (!who.ok) return who.res;

    const texts = sleepTextsOf(who.conf);
    if (rest === 'wake') {
      // It is always safe to wake up: when it is locked, it has already been woken up by the lock. Here, the idempotent answer is ok
      const changed = sleep.wake(who.petId);
      // Lines for waking up: the same conventions as falling asleep (randomly pick a line from the configuration, only play bubbles without changing the animation)
      const text = pickSleepText(texts.end);
      if (text !== undefined) state.writePet(who.petId, 'say', { text, anim: false });
      return okResult({ ok: true, sleeping: false, changed });
    }

    // Lock before going to sleep: lock = third party takes over, and has woken it up when taking the lock; no more sleep is allowed during the occupation period
    if (lock.locked(who.petId)) {
      return failResult('locked', '这只桌宠正被占用，不能睡觉');
    }
    // Falling asleep: the whole set + randomly select one from each section; if the entry does not have a sleeping animation, it will be explicitly rejected and will not be punished by standing silently.
    const names = pickSleepNames(who.conf.animations);
    if (names === null) {
      return failResult('no-sleep-animations', '这只宠物没有配置睡觉动画（animations.sleep）');
    }
    // Already sleeping: keep the original set (repeated calls should not play the animation from the beginning), still return ok to let the caller retry idempotently.
    const changed = sleep.enter(who.petId, names);
    // The falling asleep line is only played once when you actually go to sleep (idempotent repeated calls should not repeat the speech)
    if (changed) {
      const text = pickSleepText(texts.start);
      if (text !== undefined) state.writePet(who.petId, 'say', { text, anim: false });
    }
    const active = sleep.setOf(who.petId) ?? names;
    return okResult({ ok: true, sleeping: true, changed, start: active.start, loop: active.loop, end: active.end });
  } catch (e) {
    return failResult('generate-error', e instanceof Error ? e.message : String(e));
  }
}
