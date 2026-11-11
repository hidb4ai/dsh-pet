/**
 * Pure function contract (src/client/pet/card/lock-freeze.ts) that occupies lock freeze driver: lock leaf → freeze
 * deadline time.
 *
 * The mounting and cleaning of timers requires real rendering and is covered by manual acceptance.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { freezeDeadline } from './lock-freeze.ts';

const NOW_MS = 1_700_000_000_000;

describe('freezeDeadline ——The leaf converts the freezing deadline time', () => {
  test('No leaves: no freezing', () => {
    assert.equal(freezeDeadline(undefined, NOW_MS), 0);
  });

  test('Leaf mark is not occupied: not frozen even with old expiresAt', () => {
    assert.equal(freezeDeadline({ locked: false }, NOW_MS), 0);
  });

  test('Occupied and not expired: return expiration time', () => {
    assert.equal(freezeDeadline({ locked: true, expiresAt: NOW_MS + 5_000 }, NOW_MS), NOW_MS + 5_000);
  });

  test('Occupied but expired: treated as no lock (obtained stale leaves after refresh)', () => {
    assert.equal(freezeDeadline({ locked: true, expiresAt: NOW_MS - 1 }, NOW_MS), 0);
  });

  test('Exactly at the moment of expiration: no freezing, no zero timer left', () => {
    assert.equal(freezeDeadline({ locked: true, expiresAt: NOW_MS }, NOW_MS), 0);
  });
});
