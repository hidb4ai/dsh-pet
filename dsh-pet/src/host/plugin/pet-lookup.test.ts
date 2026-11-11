/**
 * Contract testing of sleeping gate (src/host/plugin/pet-lookup.ts of sleepBlocked).
 *
 * verify three things: reject while sleeping and write a rejection line; give way while holding a lock; release while
 * awake. The gate is the only implementation of "rejecting manual triggering by users". Changing it means that no
 * requests can be blocked. Running method: node --experimental-strip-types --test src/host/plugin/pet-lookup.test.ts
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createPetLookup } from './pet-lookup.ts';
import type { ConfigPaths } from '../config.ts';
import { PollStateStore } from '../state.ts';

/** Create a temporary configuration: a visible pet + a rejection line. */
function harness(): { lookup: ReturnType<typeof createPetLookup>; state: PollStateStore; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-pet-sleep-gate-'));
  const paths: ConfigPaths = {
    defaultFile: join(dir, 'default.jsonc'),
    userFile: join(dir, 'main-config.jsonc'),
    petDir: join(dir, 'pet'),
  };
  writeFileSync(
    paths.defaultFile,
    JSON.stringify({
      pets: [{ id: 'p', name: 'P', display: 'web' }],
      animations: {
        idle: ['i'],
        turn: [],
        drag: [],
        clicks: [],
        moves: { default: {}, actions: [] },
        categories: [],
        events: { balance: ['b'] },
      },
      sleepRefuseTexts: ['我在睡觉'],
    }),
  );
  const state = new PollStateStore();
  const lookup = createPetLookup({ state, configPaths: paths });
  return { lookup, state, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** Get the reason of the failed entity (the json form of RouteResult puts the entity in obj). */
function reasonOf(res: { kind: string; obj?: unknown } | null): string {
  assert.ok(res && res.kind === 'json', 'Failure entity should be returned');
  return String((res.obj as { reason?: unknown }).reason);
}

describe('sleepBlocked —— Sleeping Gate', () => {
  test('Sleeping: Reject and write a rejection line (only play bubbles, no animation)', () => {
    const { lookup, state, cleanup } = harness();
    try {
      lookup.sleep.enter('p', { start: 's', loop: 'l', end: 'e' });
      assert.equal(reasonOf(lookup.sleepBlocked('p')), 'sleeping');
      const say = state.read().pets.p.say.data as { text?: string; anim?: boolean };
      assert.equal(say.text, '我在睡觉');
      assert.equal(say.anim, false, 'Rejecting lines cannot be linked to animations');
    } finally {
      cleanup();
    }
  });

  test('Awake: Release (return to null)', () => {
    const { lookup, cleanup } = harness();
    try {
      assert.equal(lookup.sleepBlocked('p'), null);
    } finally {
      cleanup();
    }
  });

  test('Hold the lock: give way (the semantics of the lock is to hand over control to a third party)', () => {
    const { lookup, cleanup } = harness();
    try {
      lookup.sleep.enter('p', { start: 's', loop: 'l', end: 'e' });
      lookup.lock.acquire({ petId: 'p' });
      assert.equal(lookup.sleepBlocked('p'), null);
    } finally {
      cleanup();
    }
  });
});
