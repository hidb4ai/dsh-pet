/**
 * Contract test of position following (src/client/pet/motion/position-follow.ts): instant cannot reach rAF in one
 * frame; line is linearly interpolated in pixel space and accurately positioned at the point; spring relies on
 * convergence to determine cleanup; when the user presses the pet, the whole shot is discarded, and the late frame
 * after stop will no longer write the style. Using fake rAF / performance.now driver, the placement result is composed
 * of commit callback and written style assertion.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { createPositionFollow, type PositionFollowDeps } from './position-follow.ts';
import type { Center } from './geometry.ts';

const viewport = { width: 1000, height: 500 };
const half = { w: 100, h: 50 };

/** Fake root node: only four style fields are left written. */
function fakeRoot() {
  return { style: { left: '', top: '', right: '', bottom: '' } } as unknown as HTMLDivElement;
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

/** Create a set of dependencies + arrays for recording. */
function harness(extra: Partial<PositionFollowDeps> = {}) {
  const root = fakeRoot();
  let box: { x: number; y: number } | null = null;
  const commits: Center[] = [];
  let tookOver = 0;
  const deps: PositionFollowDeps = {
    root: () => root,
    box: () => box,
    setBox: (next) => {
      box = next;
    },
    commit: (center) => commits.push(center),
    viewport: () => viewport,
    half: () => half,
    // The resolved value defaults to throwPower = 1; under this value, the spring converges around 60 frames.
    spring: () => 1,
    isDragging: () => false,
    takeOver: () => {
      tookOver += 1;
    },
    ...extra,
  };
  return {
    root,
    deps,
    commits,
    get box() {
      return box;
    },
    get tookOver() {
      return tookOver;
    },
  };
}

describe('createPositionFollow —— Position following', () => {
  test('instant: One frame is in place and submitted, not rAF', () => {
    const frames = withFakeFrames();
    try {
      const h = harness();
      const follow = createPositionFollow(h.deps);
      follow.apply(0.5, 0.5, 'instant', 0);
      assert.deepEqual(h.commits, [{ rx: 0.5, ry: 0.5 }]);
      assert.deepEqual(h.box, { x: 400, y: 200 }, 'Convert the center to the upper left corner');
      assert.equal(frames.queued, 0);
      assert.equal(h.tookOver, 1, 'Take over first and then place it');
    } finally {
      frames.restore();
    }
  });

  test('line with a duration of 0 is regarded as instant', () => {
    const frames = withFakeFrames();
    try {
      const h = harness();
      createPositionFollow(h.deps).apply(0.2, 0.4, 'line', 0);
      assert.equal(frames.queued, 0);
      assert.equal(h.commits.length, 1);
    } finally {
      frames.restore();
    }
  });

  test('line: Pixel space interpolation, accurate positioning at the point', () => {
    const frames = withFakeFrames();
    try {
      const h = harness();
      // Starting point: center (0.1, 0.1) → upper left corner (0, 0)
      h.deps.setBox({ x: 0, y: 0 });
      const follow = createPositionFollow(h.deps);
      // Target: center (0.5, 0.5) → upper left corner (400, 200)
      follow.apply(0.5, 0.5, 'line', 100);
      frames.tick(50);
      assert.equal(h.root.style.left, '200px', 'Halfway should be at the midpoint (pixel interpolation)');
      assert.equal(h.root.style.top, '100px');
      assert.equal(h.commits.length, 0, 'Not yet, do not submit');

      frames.tick(60);
      assert.equal(h.root.style.left, '400px', 'Accurate positioning of the end point');
      assert.equal(h.root.style.top, '200px');
      assert.deepEqual(h.commits, [{ rx: 0.5, ry: 0.5 }]);
      assert.equal(frames.queued, 0, 'No more queuing after arrival');
    } finally {
      frames.restore();
    }
  });

  test('spring: Gradually approach the target, accurately position and submit after convergence', () => {
    const frames = withFakeFrames();
    try {
      const h = harness();
      h.deps.setBox({ x: 0, y: 0 });
      const follow = createPositionFollow(h.deps);
      follow.apply(0.5, 0.5, 'spring', 0);
      // It takes several frames for the spring to converge; each frame is 16 ms, and 200 frames is enough.
      for (let i = 0; i < 200 && frames.queued > 0; i += 1) frames.tick(16);
      assert.deepEqual(h.commits, [{ rx: 0.5, ry: 0.5 }], 'Submit endpoint after convergence');
      assert.equal(h.root.style.left, '400px');
      assert.equal(h.root.style.top, '200px');
      assert.equal(frames.queued, 0);
    } finally {
      frames.restore();
    }
  });

  test('The user presses the pet: the whole shot is discarded, neither taken over nor placed.', () => {
    const h = harness({ isDragging: () => true });
    createPositionFollow(h.deps).apply(0.5, 0.5, 'instant', 0);
    assert.equal(h.commits.length, 0);
    assert.equal(h.tookOver, 0);
  });

  test('Late frames after stop no longer write styles.', () => {
    const frames = withFakeFrames();
    try {
      const h = harness();
      h.deps.setBox({ x: 0, y: 0 });
      const follow = createPositionFollow(h.deps);
      follow.apply(0.5, 0.5, 'line', 100);
      frames.tick(30);
      const frozen = h.root.style.left;
      follow.stop();
      frames.tick(200);
      assert.equal(h.root.style.left, frozen, 'No more writing after stopping');
      assert.equal(frames.queued, 0);
      assert.equal(h.commits.length, 0, 'The stopped time was not submitted.');
    } finally {
      frames.restore();
    }
  });
});
