/**
 * Contract test of self-broadcast animation chain (src/client/pet/animation/animation.ts): fake video, fake asset
 * loader, fake fetch.
 *
 * Four contracts: to prevent heavy hits, playing will still be returned; when the source is changed, late loads
 * covered by the new switch will be discarded; when the first frame is in place, it will be turned to the foreground
 * and reported to playing; when freezes and interruptions are made, cancelled will be returned faithfully (and only
 * once).
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { createOwnAnimation, type OwnAnimation, type OwnAnimationDeps } from './animation.ts';
import type { AssetHandlers, AssetLoader } from './asset-loader.ts';
import type { EndedCue } from './cues.ts';
import type { ReportableStatus } from '../../../shared/playback.ts';
import type { Animations } from '../../../shared/types.ts';

/** False video: Only the members used by the animation chain are implemented. */
class FakeVideo {
  loop = true;
  muted = false;
  autoplay = false;
  playsInline = false;
  src = '';
  onended: ((event: Event) => void) | null = null;
  onerror: (() => void) | null = null;
  style: Record<string, string> = {};
  paused = true;
  listeners = new Map<string, Array<(event: Event) => void>>();
  playCalls = 0;
  loadCalls = 0;
  private readonly classes = new Set<string>();

  classList = {
    add: (name: string) => this.classes.add(name),
    remove: (name: string) => this.classes.delete(name),
    contains: (name: string) => this.classes.has(name),
  };

  addEventListener(type: string, listener: (event: Event) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  removeEventListener(type: string, listener: (event: Event) => void): void {
    const list = this.listeners.get(type) ?? [];
    this.listeners.set(
      type,
      list.filter((entry) => entry !== listener),
    );
  }

  /** Trigger an event (simulate browser dispatch). */
  fire(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ currentTarget: this } as unknown as Event);
    }
  }

  play(): Promise<void> {
    this.playCalls += 1;
    this.paused = false;
    return Promise.resolve();
  }

  pause(): void {
    this.paused = true;
  }

  load(): void {
    this.loadCalls += 1;
  }
}

/** Fake asset loader: Manually determine the outcome of each load. */
class FakeLoader implements AssetLoader {
  requests: Array<{ url: string; handlers: AssetHandlers }> = [];
  released: string[] = [];
  aborts = 0;

  load(url: string, handlers: AssetHandlers): void {
    this.requests.push({ url, handlers });
  }

  abortAll(): void {
    this.aborts += 1;
  }

  release(objectUrl: string): void {
    this.released.push(objectUrl);
  }
}

const animations = {
  idle: ['idle1'],
  turn: ['turn1'],
  drag: ['drag1'],
  clicks: ['click1'],
  moves: { default: {}, actions: [] },
  categories: [],
  events: { workStatus: [['ws-run-a', 'ws-run-b']], balance: ['bal1'] },
} as unknown as Animations;

/** Assemble a set of dependencies: two fake video, fake loader, record receipt and judgment. */
function harness(overrides: Partial<OwnAnimationDeps> = {}) {
  const videoA = new FakeVideo();
  const videoB = new FakeVideo();
  const loader = new FakeLoader();
  const reports: Array<{ id: string; status: ReportableStatus; reason?: string }> = [];
  const ended: EndedCue[] = [];
  const ready: HTMLVideoElement[] = [];
  let currentAnim = 'idle1';
  let workState: string | null = null;
  let dragging = false;
  let cleared = 0;
  const deps: OwnAnimationDeps = {
    videoA: () => videoA as unknown as HTMLVideoElement,
    videoB: () => videoB as unknown as HTMLVideoElement,
    cfg: () => ({ id: 'pet-1', assetRoot: 'duck', animations }),
    currentAnim: () => currentAnim,
    workStatus: () => (workState === null ? null : ({ state: workState } as never)),
    facing: () => 'left',
    report: (id, status, reason) => reports.push({ id, status, reason }),
    clearCuePlayback: () => {
      cleared += 1;
    },
    onFrontReady: (el) => ready.push(el),
    onEnded: (cue) => ended.push(cue),
    isDragging: () => dragging,
    initiallyFrozen: false,
    loader,
  };
  const anim: OwnAnimation = createOwnAnimation({ ...deps, ...overrides });
  return {
    anim,
    videoA,
    videoB,
    loader,
    reports,
    ended,
    ready,
    get cleared() {
      return cleared;
    },
    setCurrentAnim: (name: string) => {
      currentAnim = name;
    },
    setWorkState: (state: string | null) => {
      workState = state;
    },
    setDragging: (value: boolean) => {
      dragging = value;
    },
  };
}

describe('createOwnAnimation —— Source change and receipt', () => {
  test('Ordinary source change: The target slot has the address blob and load', () => {
    const h = harness();
    h.anim.switchTo('idle1', true, null);
    const [request] = h.loader.requests;
    assert.ok(request.url.includes('/thumb/duck/idle1'), request.url);
    request.handlers.onObjectUrl('blob:1');
    // The first time the source is changed, the background slot B is written.
    assert.equal(h.videoB.src, 'blob:1');
    assert.equal(h.videoB.loadCalls, 1);
  });

  test('The first frame is in place: turn to the foreground, start playing and return to playing', async () => {
    const h = harness();
    h.anim.switchTo('idle1', true, 'pb-1');
    h.loader.requests[0].handlers.onObjectUrl('blob:1');
    h.videoB.fire('loadeddata');
    // The playing receipt is hung on the microtask of play(): only when it is cashed does it mean that the painting has actually started.
    await Promise.resolve();
    assert.equal(h.videoB.classList.contains('is-front'), true);
    assert.equal(h.videoB.playCalls, 1);
    assert.deepEqual(h.reports, [{ id: 'pb-1', status: 'playing', reason: undefined }]);
    assert.equal(
      h.ready.length,
      1,
      'After it is in place, the component must be notified to add Q elasticity and movement.',
    );
    assert.equal(h.anim.frontVideo(), h.videoB);
  });

  test('Anti-rehit: Repeat the request when the last source change is still pending. The asset will not be fetched again but playing will be returned truthfully.', () => {
    const h = harness();
    h.anim.switchTo('idle1', true, 'pb-1');
    // The same request comes again before the first frame arrives (the playback request number changes with state and will drive effect again).
    h.reports.length = 0;
    h.anim.switchTo('idle1', true, 'pb-2');
    assert.equal(
      h.loader.requests.length,
      1,
      'The same segment is already being played, so the asset should not be retrieved again.',
    );
    assert.deepEqual(h.reports, [{ id: 'pb-2', status: 'playing', reason: undefined }]);
  });

  test('Late load overwritten by new switch: the obtained address is released immediately and the element is not written.', () => {
    const h = harness();
    h.anim.switchTo('idle1', true, null);
    const first = h.loader.requests[0];
    h.anim.switchTo('turn1', true, null);
    const second = h.loader.requests[1];
    first.handlers.onObjectUrl('blob:stale');
    assert.deepEqual(h.loader.released, ['blob:stale'], 'The late one must be released');
    second.handlers.onObjectUrl('blob:fresh');
    assert.equal(h.videoB.src, 'blob:fresh');
  });

  test('Asset loading failed: playback request returns failed and releases the pending source swap.', () => {
    const h = harness();
    h.anim.switchTo('idle1', true, 'pb-1');
    h.loader.requests[0].handlers.onError(new Error('HTTP 404'));
    assert.deepEqual(h.reports, [{ id: 'pb-1', status: 'failed', reason: 'asset-load' }]);
    // Cutting the same section after releasing it will not be blocked by anti-heavy.
    h.anim.switchTo('idle1', true, null);
    assert.equal(h.loader.requests.length, 2);
  });

  test('The playback request number is consumed once: switchTo will notify the component to clear it.', () => {
    const h = harness();
    h.anim.switchTo('idle1', true, 'pb-1');
    assert.equal(h.cleared, 1);
    h.anim.switchTo('idle1', true, null);
    assert.equal(h.cleared, 1, 'If there is no playback request number, it should not be cleared again.');
  });

  test('url form: one-time handover, use the complete address instead of spelling route', () => {
    const h = harness();
    h.anim.setCueUrl('https://example.com/a.webm');
    h.anim.switchTo('https://example.com/a.webm', true, null);
    assert.equal(h.loader.requests[0].url, 'https://example.com/a.webm');
  });
});

describe('createOwnAnimation——End and freeze', () => {
  test('After playing, return to ended first, and then press the animation pool for judgment.', () => {
    const h = harness();
    h.anim.switchTo('idle1', true, 'pb-1');
    h.loader.requests[0].handlers.onObjectUrl('blob:1');
    h.videoB.fire('loadeddata');
    h.setCurrentAnim('idle1');
    const cue = h.anim.handleEnded({ currentTarget: h.videoB } as unknown as Event);
    assert.deepEqual(h.reports[h.reports.length - 1], { id: 'pb-1', status: 'ended', reason: undefined });
    assert.deepEqual(cue, { kind: 'random' });
  });

  test('ended of background elements are always discarded', () => {
    const h = harness();
    const cue = h.anim.handleEnded({ currentTarget: h.videoA } as unknown as Event);
    assert.deepEqual(cue, { kind: 'ignore' });
  });

  test('The animation chain is not advanced during dragging (but the license is restored)', () => {
    const h = harness();
    h.anim.switchTo('idle1', true, 'pb-1');
    h.loader.requests[0].handlers.onObjectUrl('blob:1');
    h.videoB.fire('loadeddata');
    h.setDragging(true);
    const cue = h.anim.handleEnded({ currentTarget: h.videoB } as unknown as Event);
    assert.deepEqual(cue, { kind: 'ignore' });
    assert.deepEqual(h.reports[h.reports.length - 1], { id: 'pb-1', status: 'ended', reason: undefined });
  });

  test('Freeze: Pause the foreground and return to cancelled truthfully; unfreeze only flips the state', () => {
    const h = harness();
    h.anim.switchTo('idle1', true, 'pb-1');
    h.loader.requests[0].handlers.onObjectUrl('blob:1');
    h.videoB.fire('loadeddata');
    const frozen = h.anim.setFrozen(true);
    assert.deepEqual(frozen, { kind: 'frozen' });
    assert.equal(h.videoB.paused, true, 'Freezing requires the front desk to be suspended.');
    assert.deepEqual(h.reports[h.reports.length - 1], { id: 'pb-1', status: 'cancelled', reason: 'frozen' });
    assert.equal(h.anim.isFrozen(), true);
    assert.deepEqual(h.anim.setFrozen(false), { kind: 'resumed' });
    assert.equal(h.anim.setFrozen(false), null, 'If it is not flipped, it should not be reported again.');
  });

  test('No progress will be made after playing during the freezing period', () => {
    const h = harness();
    h.anim.setFrozen(true);
    assert.deepEqual(h.anim.handleEnded(undefined), { kind: 'ignore' });
  });

  test('dispose: Interrupt the asset in transit and release the established address', () => {
    const h = harness();
    h.anim.switchTo('idle1', true, null);
    h.loader.requests[0].handlers.onObjectUrl('blob:1');
    h.anim.dispose();
    assert.equal(h.loader.aborts, 1);
    assert.deepEqual(h.loader.released, ['blob:1']);
  });
});
