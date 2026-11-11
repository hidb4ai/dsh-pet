/**
 * Contract test of Q elastic extrusion (src/client/pet/motion/squash.ts): frame-by-frame scaling and end-frame
 * restoration of origin and mirroring; the new extrusion cancels the old one (late frames no longer write styles); the
 * style is not changed at all when the system turns on "Reduce Motion Effect". Use fake rAF / performance.now /
 * matchMedia driver, do not rely on real animation clock.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { createSquashDriver } from './squash.ts';

/** Fake video element: only three style fields are left written. */
function fakeVideo() {
  return { style: { transform: '', transformOrigin: '' } } as unknown as HTMLVideoElement;
}

/** Install a fake clock and rAF, and return the entry point and restoration function that advances one frame. */
function withFakeFrames(options: { reducedMotion?: boolean } = {}) {
  const previousRaf = globalThis.requestAnimationFrame;
  const previousCancel = globalThis.cancelAnimationFrame;
  const previousNow = performance.now;
  const previousWindow = (globalThis as { window?: unknown }).window;
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
  // There is no window in Node: only add matchMedia used by the code under test.
  (globalThis as { window?: unknown }).window = {
    matchMedia: (query: string) => ({ matches: options.reducedMotion === true, media: query }),
  };

  return {
    /** Advance a number of milliseconds and run off the currently queued frame. */
    tick(ms: number): void {
      now += ms;
      const due = pending;
      pending = [];
      for (const entry of due) entry.cb();
    },
    /** Are there any frames queued? */
    get queued(): number {
      return pending.length;
    },
    restore(): void {
      (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = previousRaf;
      (globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame = previousCancel;
      performance.now = previousNow;
      (globalThis as { window?: unknown }).window = previousWindow;
    },
  };
}

describe('createSquashDriver —— Q elastic extrusion', () => {
  test('Flatten frame by frame, end frame restoration origin and mirror', () => {
    const frames = withFakeFrames();
    try {
      const el = fakeVideo();
      const driver = createSquashDriver({ facing: () => 'right' });
      driver.start(el);
      frames.tick(0);
      assert.equal(el.style.transformOrigin, 'bottom', 'Use the bottom edge as the origin during extrusion');
      assert.ok(el.style.transform.includes('scaleY('), 'Write vertical scaling frame by frame');
      assert.ok(el.style.transform.includes('scaleX(-1)'), 'Keep the mirror image when the orientation is right');

      frames.tick(10_000); // far exceeded the duration and fell to the end frame
      assert.equal(el.style.transformOrigin, '', 'origin recovery');
      assert.equal(el.style.transform, 'scaleX(-1)', 'End and leave only the image');
      assert.equal(frames.queued, 0, 'No more queuing after the end');
    } finally {
      frames.restore();
    }
  });

  test('The new extrusion cancels the old one: the old frame will be invalidated if it is late.', () => {
    const frames = withFakeFrames();
    try {
      const first = fakeVideo();
      const second = fakeVideo();
      const driver = createSquashDriver({ facing: () => 'left' });
      driver.start(first);
      frames.tick(0);
      const firstTransform = first.style.transform;

      driver.start(second);
      frames.tick(50);
      // The old element should no longer be written; it stopped at the frame before cancellation.
      assert.equal(
        first.style.transform,
        firstTransform,
        'The style will no longer be written the time it was cancelled.',
      );
      assert.ok(second.style.transform.includes('scaleY('), 'Continue running a new time');
    } finally {
      frames.restore();
    }
  });

  test('No more writing styles after stop', () => {
    const frames = withFakeFrames();
    try {
      const el = fakeVideo();
      const driver = createSquashDriver({ facing: () => 'left' });
      driver.start(el);
      frames.tick(0);
      const frozen = el.style.transform;
      driver.stop();
      frames.tick(100);
      assert.equal(el.style.transform, frozen);
      assert.equal(frames.queued, 0);
    } finally {
      frames.restore();
    }
  });

  test('Reduce motion effects: no style at all', () => {
    const frames = withFakeFrames({ reducedMotion: true });
    try {
      const el = fakeVideo();
      const driver = createSquashDriver({ facing: () => 'left' });
      driver.start(el);
      assert.equal(el.style.transform, '');
      assert.equal(el.style.transformOrigin, '');
      assert.equal(frames.queued, 0, 'One frame should not be queued');
    } finally {
      frames.restore();
    }
  });
});
