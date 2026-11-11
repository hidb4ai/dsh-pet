/**
 * Contract test of autonomous walking (src/client/pet/motion/walk.ts): no displacement within the starting and closing
 * windows, linear interpolation according to the playback time in the middle, and submitting the target ratio only
 * once at the end; stop and walk cancels the frame and the late frame will no longer write the style; no new movement
 * is initiated during flight. With the fake rAF driver, the position assertion reads and writes style.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { createWalk, type WalkDeps } from './walk.ts';
import type { MovesConfig } from '../../../shared/types.ts';

const viewport = { width: 1000, height: 500 };
const metrics = { size: 200, halfW: 100, halfH: 56.25, sideAllow: 62.5 };
const moves = {
  default: { minDist: 80, maxDist: 120, margin: 16, leadSec: 0.2, tailSec: 0.3 },
  actions: [{ name: 'walk1' }],
} as unknown as MovesConfig;

/** Fake root node: only four style fields are left written. */
function fakeRoot() {
  return { style: { left: '', top: '', right: '', bottom: '' } } as unknown as HTMLDivElement;
}

/** Fake video: only look at the duration and playback progress. */
function fakeVideo(duration: number) {
  return { duration, currentTime: 0 } as unknown as HTMLVideoElement;
}

/** Fake rAF. */
function withFakeFrames() {
  const previousRaf = globalThis.requestAnimationFrame;
  const previousCancel = globalThis.cancelAnimationFrame;
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
  return {
    tick(): void {
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
    },
  };
}

/** Create a set of dependencies: record the played animation, submitted position and orientation. */
function harness(extra: Partial<WalkDeps> = {}) {
  const root = fakeRoot();
  const played: string[] = [];
  const commits: Array<{ rx: number; ry: number }> = [];
  const boxes: Array<{ x: number; y: number }> = [];
  const deps: WalkDeps = {
    root: () => root,
    center: () => ({ x: 500, y: 250 }),
    metrics: () => metrics,
    moves: () => moves,
    facing: () => 'right',
    viewport: () => viewport,
    isFlying: () => false,
    play: (anim) => played.push(anim),
    setBox: (box) => boxes.push(box),
    commit: (center) => commits.push(center),
    ...extra,
  };
  return { walk: createWalk(deps), root, played, commits, boxes };
}

describe('createWalk - Planning and Occupancy', () => {
  test('There is no available movement action: tryMove returns false and is not occupied', () => {
    const frames = withFakeFrames();
    try {
      const { walk, played } = harness({ moves: () => ({ default: {}, actions: [] }) as unknown as MovesConfig });
      assert.equal(walk.tryMove(), false);
      assert.equal(walk.hasPending(), false);
      assert.deepEqual(played, []);
    } finally {
      frames.restore();
    }
  });

  test('Planning successful: return the action name, play the action and leave the position to be taken', () => {
    const frames = withFakeFrames();
    try {
      const { walk, played } = harness();
      assert.equal(walk.tryMove(), 'walk1');
      assert.equal(walk.hasPending(), true);
      assert.deepEqual(played, ['walk1']);
    } finally {
      frames.restore();
    }
  });

  test('Movement is not initiated during flight: this beat is swallowed (returns to true), neither broadcast nor queued', () => {
    const frames = withFakeFrames();
    try {
      const { walk, played } = harness({ isFlying: () => true });
      assert.equal(walk.tryMove(), true);
      assert.equal(walk.hasPending(), false);
      assert.deepEqual(played, []);
    } finally {
      frames.restore();
    }
  });

  test('Send again while moving: return true, do not overwrite the current one', () => {
    const frames = withFakeFrames();
    try {
      const { walk, played } = harness();
      walk.tryMove();
      walk.start(fakeVideo(10));
      assert.equal(walk.tryMove(), true);
      assert.equal(played.length, 1);
      assert.equal(frames.queued, 1);
    } finally {
      frames.restore();
    }
  });
});

describe('createWalk——Advance by playback time', () => {
  test('There is no move to be made: start does not open the frame', () => {
    const frames = withFakeFrames();
    try {
      const { walk } = harness();
      walk.start(fakeVideo(10));
      assert.equal(frames.queued, 0);
    } finally {
      frames.restore();
    }
  });

  test('Stop at the starting point within the starting window, reach the target outside the closing window and submit only once', () => {
    const frames = withFakeFrames();
    try {
      const { walk, root, commits } = harness();
      walk.tryMove();
      const video = fakeVideo(10);
      walk.start(video);

      video.currentTime = 0.1; // <= leadSec 0.2: Still at the starting point
      frames.tick();
      const startX = parseFloat(root.style.left);
      assert.ok(
        Math.abs(startX - (0.5 * viewport.width - metrics.halfW)) < 1e-6,
        `Starting point should be 0.5 scale: ${startX}`,
      );

      video.currentTime = 5; // Traveling: The position should have left the starting point
      frames.tick();
      assert.ok(parseFloat(root.style.left) !== startX, 'The position should change while traveling');
      assert.equal(commits.length, 0);

      video.currentTime = 9.8; // >= duration - tailSec: Already in place
      frames.tick();
      assert.equal(frames.queued, 0, 'No longer arranging frames after reaching the position');
    } finally {
      frames.restore();
    }
  });

  test('What is submitted after arriving is the target ratio, not the interpolation at the end point.', () => {
    const frames = withFakeFrames();
    try {
      const { walk, commits } = harness();
      walk.tryMove();
      const video = fakeVideo(10);
      walk.start(video);
      video.currentTime = 10;
      frames.tick();
      assert.equal(commits.length, 1);
      const target = commits[0]!;
      assert.ok(target.rx > 0.5, `Go right and you should land on the right side of the starting point: ${target.rx}`);
      assert.equal(target.ry, 0.5);
    } finally {
      frames.restore();
    }
  });
  test('Negative distance: Go in the opposite direction of facing → on the left side of the starting point when traveling, and stop on the left side when it ends', () => {
    const frames = withFakeFrames();
    try {
      const negative = {
        default: { minDist: -120, maxDist: -80, margin: 16, leadSec: 0.2, tailSec: 0.3 },
        actions: [{ name: 'walk1' }],
      } as unknown as MovesConfig;
      const { walk, root, commits } = harness({ moves: () => negative });
      walk.tryMove();
      const video = fakeVideo(10);
      walk.start(video);

      const startX = 0.5 * viewport.width - metrics.halfW;
      video.currentTime = 3; // Traveling: should have left the starting point and landed on the left side of the starting point
      frames.tick();
      assert.ok(parseFloat(root.style.left) < startX, `Negative distance should go left: ${root.style.left}`);

      video.currentTime = 9.8; // Retract your feet: Stop at the planned landing point and do not jump back to the right of the starting point
      frames.tick();
      assert.equal(commits.length, 1);
      assert.ok(commits[0]!.rx < 0.5, `The target should be to the left of the starting point: ${commits[0]!.rx}`);
    } finally {
      frames.restore();
    }
  });

  test('Write back bounding box for each frame: Same origin as left written into DOM', () => {
    const frames = withFakeFrames();
    try {
      const { walk, root, boxes } = harness();
      walk.tryMove();
      const video = fakeVideo(10);
      walk.start(video);
      video.currentTime = 5;
      frames.tick();
      assert.equal(boxes.length, 1, 'Write-only bounding box once per frame');
      assert.equal(
        boxes[0]!.x + 'px',
        root.style.left,
        'The bounding box and DOM should come from the same calculation',
      );
    } finally {
      frames.restore();
    }
  });
});

describe('createWalk——Stop and go', () => {
  test('Stop and go cancellation frame: no more writing style or position submission after that', () => {
    const frames = withFakeFrames();
    try {
      const { walk, root, commits } = harness();
      walk.tryMove();
      const video = fakeVideo(10);
      walk.start(video);
      video.currentTime = 5;
      frames.tick();
      const leftBeforeStop = root.style.left;

      walk.stop();
      assert.equal(frames.queued, 0, 'There should be no queued frames after stop and go');
      video.currentTime = 6;
      frames.tick();
      assert.equal(root.style.left, leftBeforeStop, 'The position should be frozen after stop and go');
      assert.equal(commits.length, 0);
    } finally {
      frames.restore();
    }
  });

  test('Stop and clear the position to be taken: after the video is ready, it will not start running.', () => {
    const frames = withFakeFrames();
    try {
      const { walk } = harness();
      walk.tryMove();
      walk.stop();
      assert.equal(walk.hasPending(), false);
      walk.start(fakeVideo(10));
      assert.equal(frames.queued, 0);
    } finally {
      frames.restore();
    }
  });
});
