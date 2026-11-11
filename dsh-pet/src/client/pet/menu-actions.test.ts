/**
 * Contract test of menu action dispatch (src/client/pet/menu-actions.ts).
 *
 * Four contracts: built-in actions have their own endpoints and callbacks; playback request mobile animations give
 * priority to real displacements, and only degenerate into pure playback when they cannot move; text-based animations
 * are forced to face left before playback request (skip when keepFacing); when the mobile system takes over the
 * playback request, it returns failed/busy truthfully.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { createMenuActions, type MenuActionDeps } from './menu-actions.ts';
import type { MenuLeaf } from '../../shared/menu.ts';
import type { Animations } from '../../shared/types.ts';

const animations = {
  idle: ['idle1'],
  turn: [],
  drag: [],
  clicks: [],
  moves: { default: {}, actions: [{ name: 'walk1' }] },
  // noMirror: Classification of true: The standing posture facing the right is mirrored, and it must be forced to face left before the playback request.
  categories: [{ id: 'text', weight: 1, noMirror: true, actions: ['say1'] }],
  events: {},
} as unknown as Animations;

/** Create a set of dependencies for recording calls. */
function harness(overrides: Partial<MenuActionDeps> = {}) {
  const calls: string[] = [];
  const deps: MenuActionDeps = {
    petId: 'pet-1',
    animations: () => animations,
    isFacingRight: () => true,
    faceLeft: () => calls.push('faceLeft'),
    tryMove: () => 'walk1',
    stopMove: () => calls.push('stopMove'),
    stopThrow: () => calls.push('stopThrow'),
    playOnce: (anim, playbackId) => calls.push(`playOnce:${anim}:${playbackId ?? 'null'}`),
    resetPosition: () => calls.push('resetPosition'),
    openChat: () => calls.push('openChat'),
    openTodo: () => calls.push('openTodo'),
    report: (id, status, reason) => calls.push(`report:${id}:${status}:${reason}`),
    applyMerged: () => calls.push('applyMerged'),
    warn: (message) => calls.push('warn:' + message.slice(0, 20)),
    ...overrides,
  };
  return { actions: createMenuActions(deps), calls };
}

describe('createMenuActions —— Built-in action', () => {
  test('Return to the initial position: stop flying and moving first and then clear the position', () => {
    const { actions, calls } = harness();
    actions.run({ label: '回到初始位置', action: 'home' } as MenuLeaf);
    assert.deepEqual(calls, ['stopThrow', 'stopMove', 'resetPosition']);
  });

  test('Dialogue: Leave it to openChat', () => {
    const { actions, calls } = harness();
    actions.run({ label: '对话', action: 'chat' } as MenuLeaf);
    assert.deepEqual(calls, ['openChat']);
  });

  test('To-do: handed over to openTodo', () => {
    const { actions, calls } = harness();
    actions.run({ label: '待办事项', action: 'todo' } as MenuLeaf);
    assert.deepEqual(calls, ['openTodo']);
  });

  test('Display position: Do nothing without display', () => {
    const { actions, calls } = harness();
    actions.run({ label: '显示位置', action: 'set-display' } as MenuLeaf);
    assert.deepEqual(calls, []);
  });
});

describe('createMenuActions —— playback request animation', () => {
  test('Ordinary animation: pure play after stop and go, and bring the playback request number', () => {
    const { actions, calls } = harness();
    actions.run({ label: 'idle1', anim: 'idle1' } as MenuLeaf, 'pb-1');
    assert.deepEqual(calls, ['stopMove', 'playOnce:idle1:pb-1']);
  });

  test('Moving animation: taking over the movement without changing the video source; the playback request returns failed/busy truthfully', () => {
    const { actions, calls } = harness();
    actions.run({ label: 'walk1', anim: 'walk1' } as MenuLeaf, 'pb-1');
    assert.deepEqual(
      calls,
      ['report:pb-1:failed:busy'],
      'The playback request is impossible to play when the position is running.',
    );
  });

  test('Moving animation + self-playing (no playback request number): nothing extra', () => {
    const { actions, calls } = harness();
    actions.run({ label: 'walk1', anim: 'walk1' } as MenuLeaf);
    assert.deepEqual(calls, []);
  });

  test('The moving animation cannot be moved: it degrades to pure playback', () => {
    const { actions, calls } = harness({ tryMove: () => false });
    actions.run({ label: 'walk1', anim: 'walk1' } as MenuLeaf);
    assert.deepEqual(calls, ['stopMove', 'playOnce:walk1:null']);
  });

  test('The position has been occupied (return true): also return failed/busy truthfully', () => {
    const busy = harness({ tryMove: () => true });
    busy.actions.run({ label: 'walk1', anim: 'walk1' } as MenuLeaf, 'pb-2');
    assert.deepEqual(busy.calls, ['report:pb-2:failed:busy']);
  });

  test('Text animation + facing right: forced to face left before playback request', () => {
    const { actions, calls } = harness();
    actions.run({ label: 'say1', anim: 'say1' } as MenuLeaf);
    assert.equal(calls[0], 'faceLeft');
    assert.equal(calls[1], 'stopMove');
  });

  test('keepFacing: Explicit orientation takes precedence and left orientation is not forced.', () => {
    const { actions, calls } = harness();
    actions.run({ label: 'say1', anim: 'say1' } as MenuLeaf, undefined, true);
    assert.deepEqual(calls, ['stopMove', 'playOnce:say1:null']);
  });

  test('No need to force left when facing left', () => {
    const { actions, calls } = harness({ isFacingRight: () => false });
    actions.run({ label: 'say1', anim: 'say1' } as MenuLeaf);
    assert.deepEqual(calls, ['stopMove', 'playOnce:say1:null']);
  });
});

describe('createMenuActions —— Picture whisper', () => {
  /** Temporarily take over global fetch (postAction takes it away) and return the requested URL list. */
  function captureFetch(): { urls: string[]; restore: () => void } {
    const urls: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: unknown) => {
      urls.push(String(input));
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof globalThis.fetch;
    return { urls, restore: () => (globalThis.fetch = original) };
  }

  test('Click on a specific picture: request the encoded picture name, still use the manual whisper endpoint', async () => {
    const captured = captureFetch();
    try {
      harness().actions.run({ label: '大的要来啦', action: 'whisper', image: '大的要来啦' } as MenuLeaf);
      await new Promise((resolve) => setImmediate(resolve));
    } finally {
      captured.restore();
    }
    assert.equal(captured.urls.length, 1, 'Only one request should be sent per click');
    const url = captured.urls[0] ?? '';
    assert.match(url, /\/whisper\?pet=pet-1&surface=web&image=/, 'image parameter should be brought');
    assert.ok(url.endsWith(encodeURIComponent('大的要来啦')), '中文与空格必须编码：' + url);
  });

  test('Ordinary whisper: without image parameter (the behavior is the same as before adding this function)', async () => {
    const captured = captureFetch();
    try {
      harness().actions.run({ label: '碎碎念', action: 'whisper' } as MenuLeaf);
      await new Promise((resolve) => setImmediate(resolve));
    } finally {
      captured.restore();
    }
    assert.equal(captured.urls.length, 1);
    assert.doesNotMatch(
      captured.urls[0] ?? '',
      /image=/,
      'The image parameter should not be included without naming the specific picture.',
    );
  });
});

describe('createMenuActions - sleeping gate (renderer rejected)', () => {
  test('Dialogue while asleep: only reject line will be played, no pop-up window will be opened.', () => {
    const { actions, calls } = harness({
      sleeping: () => true,
      say: (text) => calls.push('say:' + text),
      sleepRefuseTexts: () => ['我在睡觉'],
    });
    actions.run({ label: '对话', action: 'chat' } as MenuLeaf);
    assert.deepEqual(calls, ['say:我在睡觉']);
  });

  test('To-do when I fell asleep/balance was also rejected', () => {
    const { actions, calls } = harness({
      sleeping: () => true,
      say: (text) => calls.push('say:' + text),
      sleepRefuseTexts: () => ['别吵'],
    });
    actions.run({ label: '待办事项', action: 'todo' } as MenuLeaf);
    actions.run({ label: '查看余额', action: 'show-balance' } as MenuLeaf);
    assert.deepEqual(calls, ['say:别吵', 'say:别吵']);
  });

  test('Sleeping/waking up/maintenance categories are allowed as usual', () => {
    const { actions, calls } = harness({
      sleeping: () => true,
      say: () => calls.push('say'),
      sleepRefuseTexts: () => ['别吵'],
    });
    actions.run({ label: '回到初始位置', action: 'home' } as MenuLeaf);
    assert.deepEqual(calls, ['stopThrow', 'stopMove', 'resetPosition']);
  });

  test('The rejection logic does not move at all when awake (the dialogue still goes openChat)', () => {
    const { actions, calls } = harness({ sleeping: () => false, say: () => calls.push('say') });
    actions.run({ label: '对话', action: 'chat' } as MenuLeaf);
    assert.deepEqual(calls, ['openChat']);
  });
});

describe('createMenuActions - The gate gives way when sleeping while locked', () => {
  test('Sleeping but holding the lock: the action is executed as usual (the semantics of the lock is to hand over control to a third party)', () => {
    const { actions, calls } = harness({
      sleeping: () => true,
      locked: () => true,
      say: (text) => calls.push('say:' + text),
      sleepRefuseTexts: () => ['别吵'],
    });
    actions.run({ label: '对话', action: 'chat' } as MenuLeaf);
    assert.deepEqual(calls, ['openChat']);
  });

  test('Asleep and not holding lock: Still rejected', () => {
    const { actions, calls } = harness({
      sleeping: () => true,
      locked: () => false,
      say: (text) => calls.push('say:' + text),
      sleepRefuseTexts: () => ['别吵'],
    });
    actions.run({ label: '对话', action: 'chat' } as MenuLeaf);
    assert.deepEqual(calls, ['say:别吵']);
  });
});

describe('createMenuActions —— The host command does not press "user click" to cause sleep.', () => {
  test('Asleep and not holding the lock, but the host command from pets.anim: play as usual (release is determined by the host gate)', () => {
    const { actions, calls } = harness({
      sleeping: () => true,
      locked: () => false,
      say: (text) => calls.push('say:' + text),
      sleepRefuseTexts: () => ['别吵'],
    });
    actions.run({ anim: 'idle1', label: 'idle1' } as MenuLeaf, undefined, false, true);
    assert.deepEqual(calls, ['stopMove', 'playOnce:idle1:null']);
  });
});
