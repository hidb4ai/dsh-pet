/**
 * Session interaction: occupation lock / lock, whisper / whisper, third-party feeding / broadcast, bubble clear /
 * bubble/clear.
 *
 * Does not determine text and tone (owned by shared/whisper). Dependency (PetRouteDeps) is passed in
 * explicitly, and the module does not read global information or create status.
 * @module dsh-pet/src/host/routes/interaction
 */
import { readAllConfig } from '../config.ts';
import { normalizeSurface, voiceTargetOfSurface } from '../surface.ts';
import {
  decideBroadcast,
  decideBubbleClear,
  normalizeBroadcastAnim,
  normalizeBroadcastDuration,
  normalizeBroadcastText,
  normalizeBroadcastVoice,
} from '../broadcast.ts';
import type { PetRouteDeps, RouteInput } from './types.ts';
import type { RouteResult } from '../http.ts';
import { failResult, invalidJson, methodNotAllowed, okResult } from './result.ts';

/** Session interaction field: undefined is returned on a miss, and a response is returned on a hit. */
export async function handleInteractionRoutes(deps: PetRouteDeps, input: RouteInput): Promise<RouteResult | undefined> {
  const { configPaths, lock, lockBlocked, memeDirsFor, publishWhisper, requirePet, sleep, state, surfaceBlocked } =
    deps;
  const { body, method, rest, url } = input;

  // Lock occupied: POST /lock ? pet = two-in-one lock acquisition / renewal (lockId given = renewal, renewal is
  // heartbeat, lost back to lock-lost), POST /lock/release ? pet = release. One lock, all-or-nothing: all silence
  // except for the lock holder during occupation. The division of labor with / playback: That one is the receipt of
  // "has the playback request been completed this time?" and this one is the lease of "who controls this time." The
  // lock occupies a leaf (pets.<id>.lock): The host cannot stop the video being played, and "complete stillness" is
  // eventually executed by the renderer. Failure is always HTTP 200 + failed entities; wrong and bad methods JSON The
  // real status code is given by the protocol constructor.
  if (rest === 'lock' || rest === 'lock/release') {
    const isRelease = rest === 'lock/release';
    if (method !== 'POST') return methodNotAllowed();
    let parsed: unknown;
    try {
      parsed = JSON.parse(body ?? 'null');
    } catch {
      return invalidJson();
    }
    const o = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    try {
      // pet is required and must actually exist (same conventions as / anim and / broadcast, see requirePet) surface
      // only verifies the lock removal: `/lock/release` must always succeed (otherwise the lock cannot be removed if
      // the pet is hidden midway)
      const who = requirePet(url.searchParams, () => readAllConfig(configPaths), { surface: !isRelease });
      if (!who.ok) return who.res;
      const petId = who.petId;
      if (isRelease) {
        const d = lock.release({ petId, lockId: o.lockId, force: o.force });
        if (!d.ok) {
          return failResult(d.reason, d.message, d.reason === 'lock-lost' ? { cause: d.cause } : undefined);
        }
        // Idempotent: If there is currently no lock, ok will be returned (the intention of "making the lock disappear" has been established in the empty state)
        return okResult({ ok: true });
      }
      const d = lock.acquire({ petId, lockId: o.lockId, ttl: o.ttl });
      if (!d.ok) {
        const extra: Record<string, unknown> = {};
        if (d.reason === 'locked') extra.expiresAt = d.expiresAt; // Tell the caller when it can retry.
        if (d.reason === 'lock-lost') extra.cause = d.cause;
        return failResult(d.reason, d.message, extra);
      }
      // Lock = third party takes over, so to take the lock, wake up the sleeping pet: otherwise it will be commanded
      // in a sleeping position, and each command will have to go through the special judgment of "hold the lock and
      // give way" again. Wake up the write-only once leaf, and the renderer will broadcast "up" as usual.
      sleep.wake(petId);
      return okResult({ ok: true, lockId: d.lockId, petId: d.petId, expiresAt: d.expiresAt });
    } catch (e) {
      // Configuration read failure, etc. (corrupt installation) → fails explicitly, not silently (same conventions as other action endpoints)
      return failResult('generate-error', e instanceof Error ? e.message : String(e));
    }
  }

  // whisper: POST /whisper ? pet = Immediately let the desktop pet say a new word and return { ok , text , image ?}.
  // The text is still written into pets.<id>.say of S (the same leaf as the command bubble and conversation reply),
  // and is brought back with the response. Manual semantics are not affected by whisperEnabled gating: that field only
  // turns off the automatic period. ? image = Specify which picture to use this time (right-click the "Picture" menu
  // and click on a specific picture): not in the pool → unknown-image, determined by publishWhisper, only moved here.
  if (rest === 'whisper') {
    if (method !== 'POST') return methodNotAllowed();
    try {
      // pet is required and must actually exist: an empty string will cause the persona/picture to be fetched
      // according to the main entry, the generated result will be written into `pets[""].say` that no one consumes,
      // and ok:true will be returned (money is spent, words are lost, the caller thinks it is successful).
      const who = requirePet(url.searchParams, () => readAllConfig(configPaths), { surface: true });
      if (!who.ok) return who.res;
      // Whoever clicked it read it: The request surface has been verified by displayCovers in requirePet, and it is
      // used to specify one end; both / any is not enough to specify one end, so leave it blank and leave it to the
      // generation function to derive it according to display.
      const want = normalizeSurface(url.searchParams.get('surface'));
      const r = await publishWhisper(
        who.petId,
        url.searchParams.get('image') ?? undefined,
        want === null ? undefined : voiceTargetOfSurface(want),
      );
      if (r.ok) return okResult({ ok: true, text: r.text, ...(r.image ? { image: r.image } : {}) });
      // The real reason is exposed as it is (the standalone mode is `provider-missing` , see the combination of
      // ./whisper) - no longer confuse all failures into generate-error, the caller can distinguish between "no model"
      // and "generated explosion".
      return failResult(r.reason, r.message ?? '生成失败');
    } catch (e) {
      return failResult('generate-error', e instanceof Error ? e.message : String(e));
    }
  }

  // Third-party feeding: POST /broadcast ? pet = Write a piece of externally given text into the bubble - not
  // generated, the caller gives the text itself, and other plugins on the host side use it to speak their own words
  // (issue #76). Writing pets .< id >. say to S only returns { ok }. text is required and is not empty after trim (no
  // length limit, no frequency limit: the content and frequency are the responsibility of the caller); pet is required
  // and must exist. image / url Choose one: image only recognizes the name of the entry in the emoticon pool, url is
  // the complete address provided by the third party and does not check the pool, scheme is stuck in http/https by the
  // host; the host does not act as a proxy (cross-domain is forced by the browser). duration Default 10 s, 0 = no
  // display, negative/non-finite number rejection; anim is only closed if it is strictly false.
  if (rest === 'broadcast') {
    if (method !== 'POST') return methodNotAllowed();
    let parsed: unknown;
    try {
      parsed = JSON.parse(body ?? 'null');
    } catch {
      return invalidJson();
    }
    const o = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    // Empty text can be determined without reading the configuration: short-circuit first, don't touch the disk for a request that will inevitably fail.
    if (!normalizeBroadcastText(o.text)) return failResult('bad-request', 'text 为空');
    // duration is the same: it is determined that no configuration is required, short-circuit first (anim has no invalid value, and there will always be a conclusion under loose conventions)
    const duration = normalizeBroadcastDuration(o.duration);
    if (duration === null) return failResult('bad-request', 'duration 必须是 ≥0 的有限数字（毫秒）');
    const anim = normalizeBroadcastAnim(o.anim);
    const speak = normalizeBroadcastVoice(o.speak);
    try {
      const cfg = readAllConfig(configPaths);
      const d = decideBroadcast({
        cfg,
        requested: String(url.searchParams.get('pet') ?? ''),
        text: o.text,
        image: o.image,
        url: o.url,
        duration,
        anim,
        memeDirs: memeDirsFor,
      });
      if (!d.ok) return failResult(d.reason, d.message);
      // renderer alignment: not satisfied → pet-not-displayed (+actual display), earlier than lock validation check
      const noSurface = surfaceBlocked(cfg, d.petId, url.searchParams);
      if (noSurface) return noSurface;
      // Occupied validation check: only the lock holder can feed when there is a lock (permanent release without lock, see lockBlocked)
      const blocked = lockBlocked(d.petId, url.searchParams);
      if (blocked) return blocked;
      // duration / anim Write the parsed effective value (the default value has also been filled in as an explicit
      // value): / state. Therefore, you can see the actual effective duration and linkage switch, and the caller does
      // not need to guess what the default is. Choose one of the two forms of the picture (guaranteed by the judgment
      // layer): url form url, write the pool's canonical name in the name form, otherwise it will be plain text.
      const pic = d.url !== undefined ? { url: d.url } : d.image !== undefined ? { image: d.image } : {};
      // Same conventions as manual whisper: caller uses ? surface = which clearly states "Which end I want this
      // sentence to be displayed on", then read it from that end; both / any is not enough to specify one end, leave
      // it blank and do not write it (consumer will not read it accordingly). speak is the second door: by default,
      // the bubble will only be played, and the caller will not make a sound until it is explicitly requested (see
      // normalizeBroadcastVoice).
      const want = normalizeSurface(url.searchParams.get('surface'));
      const voiceTo = want === null ? undefined : voiceTargetOfSurface(want);
      state.writePet(d.petId, 'say', {
        text: d.text,
        ...pic,
        duration: d.duration,
        anim: d.anim,
        ...(speak && voiceTo ? { voiceTo } : {}),
      });
      return okResult({ ok: true });
    } catch (e) {
      // Configuration reading failure, etc. (installation damage) → explicit failure, not silent
      return failResult('generate-error', e instanceof Error ? e.message : String(e));
    }
  }

  // clear bubble: POST /bubble/clear ? pet = Collapse the speech bubble currently displayed by this pet, shared with
  // / broadcast pets .< id >. say leaves. clear is marked by `{ clear: true }` - empty text cannot express this action
  // (the consumer will judge the empty text as invalid and skip the entire shot). Only the talk bubble is collected,
  // the balance/working status bubble and anim/position/throw are not moved. Idempotent: { ok:true } is returned even
  // without bubble.
  if (rest === 'bubble/clear') {
    if (method !== 'POST') return methodNotAllowed();
    try {
      const cfg = readAllConfig(configPaths);
      const d = decideBubbleClear({
        cfg,
        requested: String(url.searchParams.get('pet') ?? ''),
      });
      if (!d.ok) return failResult(d.reason, d.message);
      const noSurface = surfaceBlocked(cfg, d.petId, url.searchParams);
      if (noSurface) return noSurface;
      const blocked = lockBlocked(d.petId, url.searchParams);
      if (blocked) return blocked;
      state.writePet(d.petId, 'say', { clear: true });
      return okResult({ ok: true });
    } catch (e) {
      return failResult('generate-error', e instanceof Error ? e.message : String(e));
    }
  }

  return undefined;
}
