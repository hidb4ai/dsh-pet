/**
 * Contract test of throwing flight (src/client/pet/motion/flight.ts): write DOM frame by frame after takeoff and
 * submit the real-time position, submit the cleanup position only after landing, cancel the frame when grounding and
 * do not write late frames, and the speed is only valid during flight. With the fake rAF / performance.now driver,
 * position assertion reads and writes the style and commit records.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_PHYSICS } from '../../../shared/physics/constants.ts';
import type { PetCollisionSlot } from '../../../shared/physics.ts';
import type { PhysicsParams } from '../../../shared/types.ts';
import { createFlight, type FlightDeps } from './flight.ts';

const viewport = { width: 1000, height: 500 };
const metrics = { size: 200, halfW: 100, halfH: 56.25, sideAllow: 62.5, bottomPad: 10 };

/** False root node: only the four style fields and bounding boxes are written. */
function fakeRoot() {
  return {
    style: { left: '', top: '', right: '', bottom: '' },
    getBoundingClientRect: () => ({ left: 400, top: 100 }),
  } as unknown as HTMLDivElement;
}

/** Fake clock with rAF. */
function withFakeFrames() {
  const previousRaf = globalThis.requestAnimationFrame;
  const previousCancel = globalThis.cancelAnimationFrame;
  const previousNow = performance.now;
  let now = 0;
  let pending: Array<{ id: number; cb: () => void }> = [];
  let seq = 0;
  (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = (cb: () => void) => {
    const id = ++seq;
    pending.push({ id, cb });
    return id;
  };
  (globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame = (id: number) => {
    pending = pending.filter((entry) => entry.id !== id);
  };
  performance.now = () => now;
  return {
    tick(ms: number): void {
      now += ms;
      const due = pending;
      pending = [];
      for (const entry of due) entry.cb();
    },
    get queued(): number {
      return pending.length;
    },
    restore(): void {
      (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = previousRaf;
      (globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame = previousCancel;
      performance.now = previousNow;
    },
  };
}

/** Create a set of dependencies: record the submitted position, landing extrusion and written box; you can specify id, shared site and physical parameters. */
function harness(
  opts: {
    petId?: string;
    arena?: { slots: Record<string, PetCollisionSlot> };
    physics?: PhysicsParams;
  } = {},
) {
  const root = fakeRoot();
  const live: Array<{ rx: number; ry: number }> = [];
  const finals: Array<{ rx: number; ry: number }> = [];
  const landings: number[] = [];
  const arena = opts.arena ?? { slots: {} };
  const physics = opts.physics ?? DEFAULT_PHYSICS;
  let box: { x: number; y: number } | null = null;
  const deps: FlightDeps = {
    root: () => root,
    metrics: () => metrics,
    viewport: () => viewport,
    physics: () => physics,
    arena: () => arena,
    petId: opts.petId ?? 'main',
    box: () => box,
    setBox: (next) => {
      box = next;
    },
    commitLive: (center) => live.push(center),
    commitFinal: (center) => finals.push(center),
    onLanding: (impactVy) => landings.push(impactVy),
  };
  return { flight: createFlight(deps), root, live, finals, landings, box: () => box };
}

describe('createFlight - Flight and Settlement', () => {
  test('Arrange frames immediately after takeoff, write DOM and real-time position in the first frame', () => {
    const frames = withFakeFrames();
    try {
      const { flight, root, live } = harness();
      flight.start(400, 100, 0, 0);
      assert.equal(flight.isFlying(), true);
      assert.equal(frames.queued, 1);
      frames.tick(16);
      assert.notEqual(root.style.left, '', 'Write left during flight');
      assert.equal(root.style.right, 'auto');
      assert.equal(live.length, 1);
    } finally {
      frames.restore();
    }
  });

  test('Only submit the cleanup position once and stop arranging frames.', () => {
    const frames = withFakeFrames();
    try {
      const { flight, finals } = harness();
      // Taking off from a stationary height close to the ground: The landing should be judged to be stationary in the first frame.
      flight.start(400, 500 - metrics.halfH * 2, 0, 0);
      for (let i = 0; i < 200 && frames.queued > 0; i++) frames.tick(16);
      assert.equal(finals.length, 1, 'The cleanup location is only submitted once');
      assert.equal(flight.isFlying(), false);
      assert.equal(frames.queued, 0);
    } finally {
      frames.restore();
    }
  });

  test('The settled position is within the bounds of the box: it will not fly out of the bottom of the viewport', () => {
    const frames = withFakeFrames();
    try {
      const { flight, finals } = harness();
      flight.start(400, 100, 900, 900);
      for (let i = 0; i < 800 && frames.queued > 0; i++) frames.tick(16);
      const last = finals[finals.length - 1];
      assert.ok(last !== undefined, 'It should be settled');
      const boxHeight = (metrics.size * 9) / 16;
      const y = last.ry * viewport.height - metrics.halfH;
      assert.ok(y <= viewport.height - boxHeight + 1e-6, `Settlement y should be within the boundary: ${y}`);
      assert.ok(last.rx >= 0 && last.rx <= 1, `Horizontal proportions should be normalized: ${last.rx}`);
    } finally {
      frames.restore();
    }
  });

  test('Every time you land, you will have a positive impact speed, and it will no longer increase after landing.', () => {
    const frames = withFakeFrames();
    try {
      const { flight, landings } = harness();
      flight.start(400, 100, 0, 0);
      for (let i = 0; i < 800 && frames.queued > 0; i++) frames.tick(16);
      assert.ok(landings.length >= 1, 'The first frame should be pressed at least once');
      for (const impact of landings) assert.ok(impact > 0, `Impact velocity should be positive: ${impact}`);
      const settled = landings.length;
      frames.tick(16);
      assert.equal(landings.length, settled, 'No longer triggered after settling');
    } finally {
      frames.restore();
    }
  });
});

describe('createFlight - Speed and Grounding', () => {
  test('The speed is only valid during flight and will return to zero after flying.', () => {
    const frames = withFakeFrames();
    try {
      const { flight } = harness();
      assert.deepEqual(flight.velocity(), { vx: 0, vy: 0 });
      flight.start(400, 100, 300, -200);
      frames.tick(16);
      const vel = flight.velocity();
      assert.ok(vel.vx !== 0 || vel.vy !== 0, 'Speed should be read during flight');
      for (let i = 0; i < 400 && frames.queued > 0; i++) frames.tick(16);
      assert.deepEqual(flight.velocity(), { vx: 0, vy: 0 });
    } finally {
      frames.restore();
    }
  });

  test('Grounding cancellation frame: position and submission are frozen at the moment of grounding', () => {
    const frames = withFakeFrames();
    try {
      const { flight, root, live } = harness();
      flight.start(400, 100, 300, 0);
      frames.tick(16);
      const leftBeforeStop = root.style.left;
      const liveBeforeStop = live.length;

      flight.stop();
      assert.equal(flight.isFlying(), false);
      assert.equal(frames.queued, 0, 'There should be no queued frames after grounding');
      frames.tick(16);
      assert.equal(root.style.left, leftBeforeStop);
      assert.equal(live.length, liveBeforeStop);
    } finally {
      frames.restore();
    }
  });
});

describe('createFlight - External writing speed', () => {
  test('setVelocity is a rewrite: it gives absolute speed and does not superimpose its own speed.', () => {
    const frames = withFakeFrames();
    try {
      const { flight } = harness();
      flight.setVelocity(500, 0); // Not running: no effect
      assert.deepEqual(flight.velocity(), { vx: 0, vy: 0 });

      flight.start(400, 100, 300, 0);
      frames.tick(16);
      assert.equal(Math.round(flight.velocity().vx), 300);
      flight.setVelocity(500, 0);
      assert.equal(Math.round(flight.velocity().vx), 500, 'Should be rewritten as 500 instead of 300+500');
    } finally {
      frames.restore();
    }
  });

  test('impulse is a superposition: it only takes effect on pets that are already running.', () => {
    const frames = withFakeFrames();
    try {
      const { flight } = harness();
      flight.impulse(400, 0); // Not running: Ignore, whether to take off or not is determined by card assembly.
      assert.equal(flight.isFlying(), false);
      assert.deepEqual(flight.velocity(), { vx: 0, vy: 0 });

      flight.start(400, 100, 100, 0);
      frames.tick(16);
      flight.impulse(200, 0);
      assert.ok(flight.velocity().vx > 250, `Impulse must update velocity: ${flight.velocity().vx}`);
    } finally {
      frames.restore();
    }
  });
});

describe('createFlight —— Two collisions do not increase the speed', () => {
  test('After the collision, the speed of both parties does not exceed the incident speed, and it does not increase even after running multiple frames.', () => {
    const frames = withFakeFrames();
    try {
      const arena = { slots: {} as Record<string, PetCollisionSlot> };
      // Zero Gravity: Only horizontal collision is tested, do not include the vertical speed of landing into the peak value.
      const physics: PhysicsParams = { ...DEFAULT_PHYSICS, gravity: 0, petCollision: true };
      const a = harness({ petId: 'a', arena, physics });
      const b = harness({ petId: 'b', arena, physics });
      const register = (petId: string, target: ReturnType<typeof harness>): void => {
        arena.slots[petId] = {
          size: metrics.size,
          bottomPad: metrics.bottomPad,
          getBox: () => target.box(),
          getVel: () => target.flight.velocity(),
          applyVelocity: (vx, vy) => target.flight.setVelocity(vx, vy),
        };
      };
      register('a', a);
      register('b', b);

      a.flight.start(300, 100, 600, 0);
      b.flight.start(500, 100, -600, 0);
      let peak = 0;
      for (let i = 0; i < 24; i++) {
        frames.tick(16);
        for (const flight of [a.flight, b.flight]) {
          const vel = flight.velocity();
          peak = Math.max(peak, Math.hypot(vel.vx, vel.vy));
        }
      }
      assert.ok(peak <= 601, `Collisions should not amplify velocity: peak ${peak}`);
    } finally {
      frames.restore();
    }
  });
});
