/**
 * The "free rice" performance director: pick up the lock → run to the bottom → look forward to the meal → chase after
 * eating → end.
 *
 * A single state machine: phase, field generation, lock and orientation are all in the same field state, so this file
 * is not split according to the number of lines - playback, displacement, and phase share the same state, and cutting
 * it will only require changing one place to change the other at the same time. Not responsible for menus and assets:
 * menus are in ../baifan.ts, rice and scores are in ./scene, and interface calls are in ./transport. All waits are
 * related to receipts or playback progress. There is no timer for "how long is the asset" - the timer will still go to
 * "playback is over" when the asset fails to load.
 * @module dsh-pet/src/client/baifan/show
 */
import { CFG, LINES } from './constants.ts';
import type { ActivityAssets } from './assets.ts';
import { bottomNormY, geometry, spriteBox, type Geometry, type Pose, type SpriteBox } from './geometry.ts';
import { createLock, Halted, type Lock } from './lock.ts';
import type { RiceItem, Scene } from './scene.ts';
import type { Transport } from './transport.ts';

/** The externally exposed aspects of a performance: an entry point and an ending. */
export interface Show {
  /** Open a game; repeated calls equal to restarting (completely close the previous game first). */
  start: (petId: string, assets: ActivityAssets) => void;
  /** Ending: Stop everything, clean up, and release the lock. Idempotent. */
  halt: (reason?: string) => Promise<void>;
  /** Is this scene running? The menu uses this to avoid repeated starts. */
  isRunning: () => boolean;
}

/** Build performance dependencies. */
export interface ShowDeps {
  /** Interface call and playback request receipt. */
  transport: Transport;
  /** Rice, scores and reminder bars. */
  scene: Scene;
}

/** Phase: not starting / running to the bottom / looking forward to / chasing food / eating. */
type Phase = 'idle' | 'walk' | 'expect' | 'chase' | 'eat';

/** Relay token running sideways: +1 each time you change direction, start eating, and end. The old round will give up after the next await. */
interface SideChain {
  /** Current token. */
  token: number;
  /** Is the relay still alive (eating and finishing will stop it, and it must be able to be picked up again later). */
  active: boolean;
}

/**
 * Create a show director.
 *
 * @param deps - Transport layer and visual layer.
 * @returns opens and ends.
 */
export function createShow(deps: ShowDeps): Show {
  const { transport, scene } = deps;

  /** The currently commanded pet is id (brought back by clicking on the menu, no guessing). */
  let petId = '';
  /** Phase. */
  let phase: Phase = 'idle';
  /** Is this game running? */
  let running = false;
  /** Is the plugin unmounted? */
  let disposed = false;
  /** Lock occupied; null = No lock. */
  let lock: Lock | null = null;
  /** I’ve had a few servings. */
  let eaten = 0;
  /** Current heading. */
  let facing: 'left' | 'right' = 'left';
  /** The last measured elf size. */
  let sprite: SpriteBox = { w: 0, h: 0 };
  /** Vertical coordinates of the target running on the ground (normalized, pet center). */
  let groundNormY = 0.86;
  /** Wandering target (pixels) when there is no food to chase; null = It’s time to draw another one. */
  let patrolX: number | null = null;
  /** Sideways running relay. */
  const side: SideChain = { token: 0, active: false };
  /** You can brag once you eat as many servings as you like. */
  const FULL_EVERY = 5;

  /** The generation of this show: +1 each time the show starts, and the new show cannot be moved when the old show is cleaned up. */
  let showGen = 0;
  /** The five animation addresses used in this scene (calculated according to the configuration of the item to which the clicked pet belongs). */
  let current: ActivityAssets = { chase: '', descend: '', eatBall: '', eatBowl: '', expect: '' };
  /** Meal timer. */
  let spawnTimer = 0;
  /** Running animation watchdog. */
  let sideWatch = 0;

  /** Should the behavior continue? */
  const alive = (): boolean => running && !disposed && lock !== null && !lock.isLost();
  const enc = (s: string): string => encodeURIComponent(s);
  const sleep = (ms: number): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, ms));
  const pickLine = (pool: readonly string[]): string => pool[Math.floor(Math.random() * pool.length)] ?? '';

  /** Let the desktop pet say: `anim: false` must be given, otherwise the renderer will link the whisper animation to top off what is being played. */
  function say(text: string, ms?: number): void {
    const lease = lock?.id() ?? null;
    if (!alive() || lease === null) return;
    void transport
      .call('POST', '/broadcast?pet=' + enc(petId) + '&surface=web&lock=' + enc(lease), {
        text,
        duration: ms !== undefined ? ms : CFG.bubbleMs,
        anim: false,
      })
      .catch(() => {});
  }

  /** Read the live data once; if unable to read, return null. */
  function pose(): Pose | null {
    return transport.pose(petId);
  }

  /** Read live and convert geometric quantities; return null if unable to read. */
  function currentGeometry(): Geometry | null {
    const p = pose();
    if (p === null) return null;
    const box = measure(p);
    return geometry(p, box);
  }

  /** Measure the elf box (update cache when measured). */
  function measure(p: Pose): SpriteBox {
    sprite = spriteBox(p.x * window.innerWidth, p.y * window.innerHeight, sprite);
    return sprite;
  }

  /** playback request a gameplay animation (by name); return the playback request number. */
  async function playAnim(name: string, dir?: 'left' | 'right'): Promise<string | null> {
    const lease = lock?.id() ?? null;
    if (lease === null) throw new Halted();
    const body: Record<string, unknown> = { name };
    if (dir !== undefined) body.facing = dir;
    const r = await transport.call('POST', '/anim?pet=' + enc(petId) + '&surface=web&lock=' + enc(lease), body);
    if (r.ok !== true) {
      lock?.noteFailure(r.reason);
      throw new Error('Playback request failed:' + String(r.reason ?? 'unknown'));
    }
    return typeof r.playbackId === 'string' ? r.playbackId : null;
  }

  /** Read the actual length (milliseconds) of this playback request; use fallback if you cannot read it. */
  async function clipMs(id: string | null): Promise<number> {
    if (id !== null) {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const p = transport.progress(petId);
        if (p !== null && p.playbackId === id && p.duration > 0.2) return p.duration * 1000;
        await sleep(60);
      }
    }
    return CFG.flyFallbackMs;
  }

  /**
   * Guard an asset that is being played, and return true when it reaches the end.
   *
   * The receipt only says "Is it over yet?", while progress has currentTime / duration, which allows you to click on
   * the next segment when there is still a little tail left - the pet itself is stationary during the lock occupation,
   * and the gap between the end of one segment and the start of the next segment is "sliding but no running
   * animation".
   *
   * @param id - playbackId to defend that time.
   * @returns true = It’s time to take on the next paragraph; false = This paragraph no longer belongs to us.
   */
  async function keepWarm(id: string | null): Promise<boolean> {
    if (id === null) return false;
    const start = performance.now();
    const deadline = start + CFG.waitBudgetMs;
    let seen = false;
    for (;;) {
      const p = transport.progress(petId);
      if (p !== null && p.playbackId === id) {
        seen = true;
        if (p.paused) return true;
        if (p.duration > 0.3 && p.currentTime >= p.duration - CFG.preRollSec) return true;
      } else if (seen) {
        return false;
      } else if (performance.now() - start > CFG.pollLatencyMs + 800) {
        // It has never been our turn to broadcast (swallowed by busy / the source has not been changed yet): Leave it to the caller to focus once
        return true;
      }
      if (performance.now() > deadline) return false;
      await sleep(90);
    }
  }

  /** Send the location once. */
  async function movePet(xNorm: number, yNorm: number, mode: 'instant' | 'line', durationMs?: number): Promise<void> {
    const lease = lock?.id() ?? null;
    if (lease === null) return;
    const body: Record<string, unknown> = { x: clamp(xNorm), y: clamp(yNorm), mode };
    if (mode === 'line') body.duration = Math.max(0, durationMs ?? 0);
    const r = await transport.call('POST', '/position?pet=' + enc(petId) + '&surface=web&lock=' + enc(lease), body);
    if (r.ok !== true) lock?.noteFailure(r.reason);
  }

  /** Wait for the pet to reach a certain position; the renderer polls / state every second, so it is only responsible for "waiting until it arrives". */
  async function waitArrive(goalX: number | null, goalY: number | null, budgetMs: number): Promise<void> {
    const deadline = performance.now() + budgetMs;
    for (;;) {
      const p = transport.pose(petId);
      if (p === null) return;
      const okX = goalX === null || Math.abs(p.x * window.innerWidth - goalX) <= CFG.arrivePx;
      const okY = goalY === null || Math.abs(p.y - goalY) <= 0.02;
      if (okX && okY) return;
      if (!alive() || performance.now() > deadline) return;
      await sleep(100);
    }
  }

  /**
   * Divide a linear displacement into several segments and issue them one after another.
   *
   * The purpose is not image quality, but to resist the failure of a single command: if the renderer treats a certain
   * line as a direct position, it will only lose a distance of 1/ n after disassembling it.
   */
  async function glideTo(xNorm: number, yNorm: number, ms: number, steps: number): Promise<void> {
    const start = transport.pose(petId);
    if (start === null) return;
    const n = Math.max(1, Math.min(8, steps));
    const part = ms / n;
    for (let step = 1; step <= n; step += 1) {
      const t = step / n;
      await movePet(start.x + (xNorm - start.x) * t, start.y + (yNorm - start.y) * t, 'line', part);
      if (!alive()) return;
      await sleep(part + 60);
    }
  }

  /**
   * Move 2 pixels in place and feed it the "starting point" of the renderer.
   *
   * The first position command after entering the page does not perform interpolation - there is no "previous
   * position" at that moment, so it falls directly to the target point. The performance is that the pet teleports to
   * the bottom when "Eat Rice" is clicked for the first time. First establish a starting point with an almost zero
   * displacement.
   */
  async function warmPosition(): Promise<void> {
    const p = transport.pose(petId);
    if (p === null) return;
    await movePet(p.x, clamp(p.y - 0.003), 'line', 140);
    await sleep(220);
  }

  /** Let the sideways running relay continue; return playbackId for the first pass (it will always be settle). */
  function runSide(dir: 'left' | 'right'): Promise<string | null> {
    facing = dir;
    side.token += 1;
    const token = side.token;
    side.active = true;
    const started = playAnim(current.chase, dir).catch(() => null);
    void (async () => {
      let id = await started;
      for (;;) {
        if (token !== side.token || !alive()) return;
        if (id === null) {
          // Swallowed by busy/The asset was not obtained: slow down and click again, don’t break up the rhythm
          await sleep(400);
          if (token !== side.token) return;
          id = await playAnim(current.chase, dir).catch(() => null);
          continue;
        }
        if (!(await keepWarm(id))) {
          if (token === side.token) side.active = false;
          return;
        }
        if (token !== side.token || !alive()) return;
        id = await playAnim(current.chase, dir).catch(() => null);
      }
    })();
    return started;
  }

  /** Ensure that the animation "Run to dir" is in the relay; it must be restarted if the direction is changed or the relay is interrupted. */
  function ensureSide(dir: 'left' | 'right'): Promise<string | null> | null {
    if (dir === facing && side.active) return null;
    return runSide(dir);
  }

  /** Wait for this animation to actually start playing; the displacement must wait for it, otherwise it will be "the person slides out first, and the animation will follow." */
  async function waitPlayStarted(pending: Promise<string | null> | null, budgetMs: number): Promise<void> {
    if (pending === null) return;
    const id = await pending;
    if (id === null) return;
    const deadline = performance.now() + budgetMs;
    for (;;) {
      const p = transport.progress(petId);
      if (p !== null && p.playbackId === id) return;
      if (!alive() || performance.now() > deadline) return;
      await sleep(40);
    }
  }

  /** Is this segment of sideways running currently being played in the frontend (fallback criterion: will position writing override the playback request, the document does not guarantee this). */
  function sidePlaying(): boolean {
    const p = transport.progress(petId);
    return p !== null && typeof p.anim === 'string' && p.anim === current.chase;
  }

  /** Watchdog during the meal chase: If the running animation drops, just make up for it. */
  function startSideWatch(): void {
    stopSideWatch();
    sideWatch = window.setInterval(() => {
      if (!alive() || phase !== 'chase' || sidePlaying()) return;
      side.active = false;
      void runSide(facing);
    }, CFG.sideWatchMs);
  }

  function stopSideWatch(): void {
    if (sideWatch !== 0) window.clearInterval(sideWatch);
    sideWatch = 0;
  }

  /** Run a section; return whether a section of displacement has really been sent (false when it is at the target point). */
  async function tripTo(goalPx: number, speed: number): Promise<boolean> {
    const p = transport.pose(petId);
    if (p === null) return false;
    const petPx = p.x * window.innerWidth;
    const distance = Math.abs(goalPx - petPx);
    if (distance <= CFG.arrivePx) return false;
    const dir = goalPx > petPx ? 'right' : 'left';
    const durationMs = Math.min(CFG.tripMaxMs, Math.max(180, (distance / speed) * 1000));
    await waitPlayStarted(ensureSide(dir), CFG.animLeadMs);
    await movePet(goalPx / window.innerWidth, groundNormY, 'line', durationMs);
    await waitArrive(goalPx, groundNormY, durationMs + CFG.pollLatencyMs + 600);
    return true;
  }

  /** Stage 1: Run to the bottom. Charge → Run straight to a random landing point (it’s different every time, just the first impression). */
  async function phaseWalk(): Promise<void> {
    phase = 'walk';
    const geom = currentGeometry();
    if (geom === null) throw new Error('This pet is not present on the current page');
    groundNormY = bottomNormY(geom);
    const margin = Math.max(60, geom.w / 2);
    const targetPx = margin + Math.random() * Math.max(10, window.innerWidth - margin * 2);
    facing = targetPx >= geom.cx ? 'right' : 'left';
    say(pickLine(LINES.down), 2400);
    await warmPosition();
    await playAnim(current.descend, facing);
    await sleep(CFG.prepMs);
    if (!alive()) throw new Halted();
    await glideTo(targetPx / window.innerWidth, groundNormY, CFG.travelMs, 3);
    await waitArrive(targetPx, groundNormY, CFG.pollLatencyMs + 1500);
    if (!alive()) throw new Halted();
  }

  /** The second stage: Looking forward to the meal; starting to run sideways from the tail to avoid standing there waiting after the broadcast. */
  async function phaseExpect(): Promise<void> {
    phase = 'expect';
    say(pickLine(LINES.expect), 3000);
    await keepWarm(await playAnim(current.expect, facing));
    if (!alive()) throw new Halted();
  }

  /** Eat one serving: fly to your mouth → get smaller as you chew → drop the empty bowl to the ground → play the score. */
  async function eatOne(item: RiceItem, geom: Geometry): Promise<void> {
    phase = 'eat';
    // Stop the sideways running relay first, otherwise it will top off this section when the eating animation starts.
    side.token += 1;
    side.active = false;
    scene.detach(item);
    const isBowl = item.type === 'bowl';

    const p = transport.pose(petId);
    const [, playId] = await Promise.all([
      p === null ? null : movePet(p.x, groundNormY, 'instant').catch(() => null),
      playAnim(isBowl ? current.eatBowl : current.eatBall, facing).catch(() => null),
    ]);
    const flyMs = await clipMs(playId);

    // The animation has started. The position at this moment is the position of the mouth.
    const settled = transport.pose(petId);
    const g = settled === null ? geom : geometry(settled, measure(settled));
    const mouthX = g.cx + CFG.mouthDx * g.w * (facing === 'right' ? -1 : 1);
    const mouthY = g.mouthY;
    scene.flyToMouth(item, mouthX, mouthY, flyMs);
    if (isBowl) window.setTimeout(() => scene.dropEmptyBowl(mouthX, mouthY, g.scale), Math.max(0, flyMs - 120));

    await transport.waitPlayback(playId);
    if (!running || disposed) return;

    eaten += 1;
    scene.popScore(eaten, item.type, g);
    say(pickLine(isBowl ? LINES.bowl : LINES.ball), 2400);
    // Only brag after eating a certain amount, otherwise it will be annoying if you say it every time you take a bite
    if (eaten % FULL_EVERY === 0) window.setTimeout(() => say(pickLine(LINES.full), 2600), 1200);
    phase = 'chase';
  }

  /** Start brushing: drop one piece first, then continue according to intervals; it will stop naturally when the field is full. */
  function startSpawning(): void {
    if (spawnTimer !== 0) return;
    scene.spawn(scene.scaleOf(sprite.w));
    scene.kick();
    spawnTimer = window.setInterval(() => {
      if (phase !== 'chase' && phase !== 'eat') return;
      scene.spawn(scene.scaleOf(sprite.w));
      scene.kick();
    }, CFG.spawnMs);
  }

  /** Three stages: chasing rice. Run step by step, and only make the next decision when you reach the end. */
  async function phaseChase(gen: number): Promise<never> {
    phase = 'chase';
    startSpawning();
    startSideWatch();
    say(pickLine(LINES.drop), 2200);
    while (alive() && gen === showGen) {
      const geom = currentGeometry();
      if (geom === null) throw new Error('This pet is not present on the current page');
      groundNormY = bottomNormY(geom);
      const target = scene.nearest(geom.cx, facing);
      const eatPx = CFG.eatPx * (geom.w / CFG.refWidth);
      if (target !== null && Math.abs(target.x - geom.cx) <= eatPx) {
        await eatOne(target, geom);
        continue;
      }
      const goalPx = target !== null ? target.x : patrolGoal(geom);
      const speed = target !== null ? CFG.runSpeed : CFG.runSpeed * CFG.patrolSpeedRatio;
      // Take a break when you are already at the target point (no command is issued), otherwise this loop will become an endless loop.
      if (!(await tripTo(goalPx, speed))) await sleep(CFG.idleMs);
    }
    throw new Halted();
  }

  /** When there is no food to chase, just pick a place and run there, and pick again at the next tick. */
  function patrolGoal(geom: Geometry): number {
    const margin = Math.max(80, geom.w * 0.4);
    const petPx = geom.cx;
    if (patrolX === null || Math.abs(patrolX - petPx) <= CFG.arrivePx) {
      patrolX = margin + Math.random() * Math.max(10, window.innerWidth - margin * 2);
    }
    return patrolX;
  }

  /** Run the entire show. */
  async function runShow(): Promise<void> {
    running = true;
    eaten = 0;
    side.token += 1;
    side.active = false;
    patrolX = null;
    phase = 'idle';

    try {
      await lock?.acquire();
      lock?.startRenew();
      say(pickLine(LINES.start), 2200);
      await phaseWalk();
      await phaseExpect();
      await phaseChase(showGen);
    } catch (error) {
      if (error instanceof Halted) {
        // Normal ending (lock lost/unmount)
      } else if (lock?.isLost() === true) {
        scene.toast('锁丢了，表演结束');
      } else {
        scene.toast(error instanceof Error ? error.message : String(error));
        console.warn('[dsh-pet] Rice-eating interaction failed', error);
      }
    } finally {
      await halt(lock?.isLost() === true ? '用户接管，已收场' : '');
    }
  }

  /** Ending: stop everything, clean up, and release the lock; idempotent, lock loss and unmount will all go here. */
  async function halt(reason?: string): Promise<void> {
    const wasRunning = running;
    running = false;
    phase = 'idle';
    // Cut off pending requests: otherwise they will come back with the old token and continue to touch the pet
    transport.attach(null);
    if (spawnTimer !== 0) {
      window.clearInterval(spawnTimer);
      spawnTimer = 0;
    }
    stopSideWatch();
    side.token += 1;
    side.active = false;
    scene.clear();
    patrolX = null;
    const lease = lock?.id() ?? null;
    await lock?.release();
    if (reason !== undefined && reason !== '' && (wasRunning || lease !== null)) scene.toast(reason);
  }

  /** Start a game; first completely close the previous game (including releasing the lock), and then start a new one. */
  function start(nextPetId: string, assets: ActivityAssets): void {
    if (running || lock?.id() != null) {
      void halt('重新开始').then(() => begin(nextPetId, assets));
      return;
    }
    begin(nextPetId, assets);
  }

  /** The real show starts: Rebuilding the lock, cancellation signal and asset address of this scene. */
  function begin(nextPetId: string, assets: ActivityAssets): void {
    petId = nextPetId;
    current = assets;
    showGen += 1;
    disposed = false;
    lock?.stopRenew();
    lock = createLock(transport, petId, alive, scene.toast);
    transport.attach(new AbortController());
    scene.toast('吃白饭 —— 开饭了');
    void runShow();
  }

  return {
    halt,
    isRunning: () => running,
    start,
  };
}

/** Normalized coordinates clamped to 0–1. */
const clamp = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
