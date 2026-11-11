/**
 * Action command: / anim playback request animation, / position and / throw positioning and throwing, / pose attitude
 * reading and writing.
 *
 * Dependency (PetRouteDeps) is passed in explicitly, and the module does not read global information or create status.
 * @module dsh-pet/src/host/routes/motion
 */
import { readAllConfig } from '../config.ts';
import { decideAnim } from '../anim.ts';
import { decidePosition, decideThrow, positionLeafData } from '../motion-cue.ts';
import { normalizePoseInput } from '../pose.ts';
import { displayCovers } from '../surface.ts';
import type { PetRouteDeps, RouteInput } from './types.ts';
import type { RouteResult } from '../http.ts';
import { failResult, invalidJson, methodNotAllowed, okResult } from './result.ts';

/** Action and position fields: undefined is returned for misses and response is returned for hits. */
export async function handleMotionRoutes(deps: PetRouteDeps, input: RouteInput): Promise<RouteResult | undefined> {
  const { configPaths, lockBlocked, playback, pose, requirePet, state, surfaceBlocked } = deps;
  const { body, method, rest, url } = input;

  // POST /anim?pet= requires exactly one of name or url.
  // A pool name follows the same action semantics as the context menu and is published to S at pets.<id>.anim. Reject
  // unknown names before the renderer requests a missing asset.
  // A third-party URL bypasses the pool and plays once without menu semantics. Allow only http/https; file: could
  // expose local files through the desktop renderer.
  // Optional facing must be left/right. Omit the field entirely when absent so the renderer retains its current
  // orientation.
  if (rest === 'anim') {
    if (method !== 'POST') return methodNotAllowed();
    let parsed: unknown;
    try {
      parsed = JSON.parse(body ?? 'null');
    } catch {
      return invalidJson();
    }
    const o = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    try {
      const cfg = readAllConfig(configPaths);
      const d = decideAnim({
        cfg,
        requested: String(url.searchParams.get('pet') ?? ''),
        name: o.name,
        url: o.url,
        facing: o.facing,
      });
      if (!d.ok) return failResult(d.reason, d.message);
      // renderer alignment: not satisfied → pet-not-displayed (+actual display), earlier than lock validation check
      const noSurface = surfaceBlocked(cfg, d.petId, url.searchParams);
      if (noSurface) return noSurface;
      // Occupy validation check: the lock holder's own playback request is allowed (that's its performance), and others will reject it.
      const blocked = lockBlocked(d.petId, url.searchParams);
      if (blocked) return blocked;
      // Playback receipt: Create a record (accepted) when accepting, the number is issued together with the leaf, and
      // the renderer reports accordingly. Leaf shape: name and url are exactly the same (guaranteed by the decision
      // layer), and facing only enters the leaf when explicitly given.
      const record = playback.create(d.petId, d.url ?? d.name ?? '');
      state.writePet(d.petId, 'anim', {
        ...(d.url !== undefined ? { url: d.url } : { name: d.name }),
        playbackId: record.playbackId,
        ...(d.facing === undefined ? {} : { facing: d.facing }),
      });
      return okResult({ ok: true, playbackId: record.playbackId });
    } catch (e) {
      // Configuration reading failure, etc. (installation damage) → explicit failure, not silent
      return failResult('generate-error', e instanceof Error ? e.message : String(e));
    }
  }

  // Position and throwing: Two motion instructions POST /position and / throw are accepted and written into the
  // corresponding leaves of S (position / throw). The position does not introduce any new kinematics: mode chooses one
  // of three (instant / spring / line), all three renderers are available; throw and reuse the existing startThrow,
  // gravity/rebound/friction/landing/collision are all the same. Only verification and clamping are done here. x/y is
  // the normalized coordinate (0~1) of the pet center. It is clamped out of bounds and returns the actual effective
  // value to the caller. When dragging and colliding with the user, the renderer silently discards but the host still
  // returns ok:true - the host cannot determine the dragging status, only the renderer knows.
  if (rest === 'position' || rest === 'throw') {
    const isPosition = rest === 'position';
    if (method !== 'POST') return methodNotAllowed();
    let parsed: unknown;
    try {
      parsed = JSON.parse(body ?? 'null');
    } catch {
      return invalidJson();
    }
    const o = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    try {
      const cfg = readAllConfig(configPaths);
      const requested = String(url.searchParams.get('pet') ?? '');
      if (isPosition) {
        const d = decidePosition({
          cfg,
          requested,
          x: o.x,
          y: o.y,
          mode: o.mode,
          duration: o.duration,
        });
        if (!d.ok) return failResult(d.reason, d.message);
        const noSurface = surfaceBlocked(cfg, d.petId, url.searchParams);
        if (noSurface) return noSurface;
        const blocked = lockBlocked(d.petId, url.searchParams);
        if (blocked) return blocked;
        // Leaves converge to minimum shape by mode: non-line mode without duration (see positionLeafData)
        state.writePet(d.petId, 'position', positionLeafData(d));
        // The actual effective value after clamping back: The caller does not have to calculate the boundary by himself, and will not mistakenly think that the out-of-bounds value will be accepted as ordered.
        return okResult({ ok: true, x: d.x, y: d.y });
      }
      const d = decideThrow({ cfg, requested, angle: o.angle, power: o.power });
      if (!d.ok) return failResult(d.reason, d.message);
      const noSurface = surfaceBlocked(cfg, d.petId, url.searchParams);
      if (noSurface) return noSurface;
      const blocked = lockBlocked(d.petId, url.searchParams);
      if (blocked) return blocked;
      state.writePet(d.petId, 'throw', { angle: d.angle, power: d.power });
      return okResult({ ok: true });
    } catch (e) {
      // Configuration read failure, etc. (installation corruption) → explicit failure, not silent (same conventions as / anim)
      return failResult('generate-error', e instanceof Error ? e.message : String(e));
    }
  }

  // Live: GET /pose ? pet = read desktop snapshot, POST /pose/report ? pet = reported by desktop renderer (internal
  // channel). There is one desktop pet per window, the location is globally unique, and the host snapshot has clean
  // semantics; the location on the web page is generated once for each page (the two tab pages are inherently
  // different), and it must be wrong to insert the host snapshot, so the web page uses the Cordis read-only service
  // `petApi7340` in the page, and the field names and coordinate conventions are exactly the same as here. Reporting
  // is pushing + throttling when changes occur, not polling. This endpoint does not require surface: it is a read
  // endpoint, and the domain itself has only one face.
  if (rest === 'pose' || rest === 'pose/report') {
    const isReport = rest === 'pose/report';
    if (isReport && method !== 'POST') return methodNotAllowed();
    if (!isReport && method !== 'GET') return methodNotAllowed();
    // Protocol layer error (invalid JSON) reported first: same sequence as / anim
    let parsedPose: unknown;
    if (isReport) {
      try {
        parsedPose = JSON.parse(body ?? 'null');
      } catch {
        return invalidJson();
      }
    }
    try {
      const who = requirePet(url.searchParams, () => readAllConfig(configPaths));
      if (!who.ok) return who.res;
      if (isReport) {
        const p = normalizePoseInput(parsedPose);
        if (!p.ok) return failResult(p.reason, p.message);
        pose.set(who.petId, p.pose);
        return okResult({ ok: true });
      }
      // Desktop live broadcast is only meaningful for pets that are "displayed on the desktop": the configuration is not on the desktop → clearly unavailable (actual display attached)
      const display = String(who.pet.display ?? '');
      if (!displayCovers('desktop', display)) {
        return failResult(
          'pet-not-displayed',
          who.petId + ' 的显示模式是 ' + display + '；桌面端实况只对 display 含 desktop 的宠物有',
          { display },
        );
      }
      const snap = pose.get(who.petId);
      if (snap === undefined) {
        return failResult('pose-unavailable', '还没收到过这只宠物的桌面端实况（桌面端没起来，或刚重启还没来得及上报）');
      }
      return okResult({ ok: true, petId: who.petId, ...snap });
    } catch (e) {
      // Configuration read failure, etc. (corrupt installation) → fails explicitly, not silently (same conventions as other endpoints)
      return failResult('generate-error', e instanceof Error ? e.message : String(e));
    }
  }

  return undefined;
}
