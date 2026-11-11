/**
 * Unit test of to-do reminder: what does a beat do, and which pet speaks.
 *
 * Verify four items: only remind when the time is up, only remind one at a time, remember the reminder time after
 * writing S, skip when there is no visible pet or it is occupied (skipping will not advance, the next tick will make
 * up for it). The time is injected by `now` , and the test does not sleep the real time.
 *
 * Running method: node --experimental-strip-types --test src/host/plugin/todo-reminders.test.ts
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { pickReminderSpeaker, tickTodoReminders } from './todo-reminders.ts';
import type { TodoRecord } from '../todo/types.ts';

/** Fixed clock. */
const NOW = 1_000_000_000;
const MINUTE = 60 * 1000;

/** Create a to-do: only cover the fields that this document cares about. */
function todo(overrides: Partial<TodoRecord> = {}): TodoRecord {
  return {
    id: 'todo-1',
    text: '交周报',
    dueAt: NOW + 10 * MINUTE,
    done: false,
    // Created 30 minutes ago, with 10 minutes left until expiration: the slot is 20 minutes, and the first schedule has already expired.
    createdAt: NOW - 30 * MINUTE,
    updatedAt: NOW - 30 * MINUTE,
    completedAt: null,
    lastRemindedAt: null,
    ...overrides,
  };
}

/** Create a pet: only bring fields that this function can read. */
const pet = (id: string, display: string): Record<string, unknown> => ({ id, display });

/** The smallest stand-in for one shot: record entry point. `voiceTodo` is enabled by default (different from the default configuration of the resolved value, press "Keywords" to run during the test). */
function harness(options: {
  todos: TodoRecord[];
  pets?: Record<string, unknown>[];
  locked?: string | null;
  hasListener?: boolean;
  voiceTodo?: boolean;
}) {
  const writes: Array<{ petId: string; leaf: string; data: unknown }> = [];
  const marked: Array<{ id: string; at: number }> = [];
  const deps = {
    todos: {
      list: async () => options.todos,
      markReminded: async (id: string, at: number) => {
        marked.push({ id, at });
      },
    },
    effectivePetList: () => options.pets ?? [pet('main', 'web')],
    isVoiceTodoEnabled: () => options.voiceTodo ?? true,
    lock: { locked: (petId: string) => petId === options.locked },
    state: {
      writePet: (petId: string, leaf: string, data: unknown) => {
        writes.push({ petId, leaf, data });
      },
    },
    log: { info: () => undefined, warn: () => undefined },
    now: () => NOW,
    hasListener: () => options.hasListener ?? true,
  };
  return { deps, writes, marked };
}

describe('pickReminderSpeaker —— A pet that picks its mouth', () => {
  test('Visible on the web page first, fallback on the desktop', () => {
    assert.equal(
      pickReminderSpeaker([pet('d', 'desktop'), pet('w', 'web')], () => false),
      'w',
    );
    assert.equal(
      pickReminderSpeaker([pet('d', 'desktop'), pet('b', 'both')], () => false),
      'b',
    );
    assert.equal(
      pickReminderSpeaker([pet('d1', 'desktop'), pet('d2', 'desktop')], () => false),
      'd1',
    );
  });

  test('display: none and empty id skip', () => {
    assert.equal(
      pickReminderSpeaker([pet('n', 'none'), { display: 'web' }], () => false),
      null,
    );
  });

  test('Skip occupied ones; all occupied → null (this reminder will not be lost, try again next tick)', () => {
    assert.equal(
      pickReminderSpeaker([pet('a', 'web'), pet('b', 'web')], (id) => id === 'a'),
      'b',
    );
    assert.equal(
      pickReminderSpeaker([pet('a', 'web'), pet('b', 'both')], () => true),
      null,
    );
  });

  test('Empty list → null', () => {
    assert.equal(
      pickReminderSpeaker([], () => false),
      null,
    );
  });
});

describe('tickTodoReminders ——One shot', () => {
  test('Arrival: write say and note the reminder time', async () => {
    const { deps, writes, marked } = harness({ todos: [todo()] });
    await tickTodoReminders(deps);
    assert.equal(writes.length, 1);
    assert.equal(writes[0]?.petId, 'main');
    assert.equal(writes[0]?.leaf, 'say');
    assert.match(String((writes[0]?.data as { text: string }).text), /交周报/);
    assert.deepEqual(marked, [{ id: 'todo-1', at: NOW }]);
  });

  test('Not yet / Completed / No deadline → Do nothing', async () => {
    for (const list of [
      [todo({ dueAt: NOW + 3 * 24 * 60 * MINUTE, createdAt: NOW })],
      [todo({ done: true })],
      [todo({ dueAt: null })],
    ]) {
      const { deps, writes, marked } = harness({ todos: list });
      await tickTodoReminders(deps);
      assert.equal(writes.length, 0);
      assert.equal(marked.length, 0);
    }
  });

  test('No visible pet → Do not write or remember (replenish next tick instead of throwing away in vain)', async () => {
    const { deps, writes, marked } = harness({ todos: [todo()], pets: [] });
    await tickTodoReminders(deps);
    assert.equal(writes.length, 0);
    assert.equal(marked.length, 0);
  });

  test('The only pet is occupied → skip', async () => {
    const { deps, writes, marked } = harness({ todos: [todo()], locked: 'main' });
    await tickTodoReminders(deps);
    assert.equal(writes.length, 0);
    assert.equal(marked.length, 0);
  });

  test('No client is online → Do not write or remember (wait until the next client is connected and then remind you to avoid losing it after writing to an empty state)', async () => {
    const { deps, writes, marked } = harness({ todos: [todo()], hasListener: false });
    await tickTodoReminders(deps);
    assert.equal(writes.length, 0);
    assert.equal(marked.length, 0);
  });

  test('The broadcast switch is turned off: bubbles are still playing, but the leaves do not have voiceTo (no one reads them)', async () => {
    const { deps, writes } = harness({ todos: [todo()], voiceTodo: false });
    await tickTodoReminders(deps);
    assert.equal(writes.length, 1, 'The bubble still needs to be played');
    assert.equal('voiceTo' in (writes[0]?.data as object), false, 'This key should not be written when turned off');
  });

  test('The broadcast switch is on: press display with voiceTo', async () => {
    const { deps, writes } = harness({ todos: [todo()], voiceTodo: true });
    await tickTodoReminders(deps);
    assert.equal(
      (writes[0]?.data as { voiceTo?: string }).voiceTo,
      'web',
      'By default pets are only displayed on web pages',
    );
  });

  test('Reminders can also be made when there are only desktop pets.', async () => {
    const { deps, writes } = harness({ todos: [todo()], pets: [pet('d', 'desktop')] });
    await tickTodoReminders(deps);
    assert.equal(writes[0]?.petId, 'd');
  });

  test('When writing say, which end should be read: Desktop priority, only write web when the web page is displayed.', async () => {
    const webOnly = harness({ todos: [todo()], pets: [pet('w', 'web')] });
    await tickTodoReminders(webOnly.deps);
    assert.equal((webOnly.writes[0]?.data as { voiceTo?: string }).voiceTo, 'web');

    const both = harness({ todos: [todo()], pets: [pet('b', 'both')] });
    await tickTodoReminders(both.deps);
    assert.equal(
      (both.writes[0]?.data as { voiceTo?: string }).voiceTo,
      'desktop',
      'When both ends are displayed, hand it to the desktop: the desktop must have a window, and the web page may be closed at any time.',
    );
  });
});
