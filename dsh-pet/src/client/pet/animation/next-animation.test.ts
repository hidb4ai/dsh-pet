/**
 * Contract test of self-play animation decision (src/client/pet/animation/next-animation.ts).
 *
 * Three contracts:
 * 1. idle / turn only draw from their respective pools and avoid the segment currently being played;
 * 2. move file: no replay during occupation (return to null), the action name will be used in the log if the move is
 * successful, and the action will be returned to the original place if it cannot be moved;
 * 3. When the pet is fixed (fixed), it will not go to turn / move - the decision-making layer does not make repeated
 * judgments and relies on the caller to pass the correct category.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { decideNextAnimation } from './next-animation.ts';
import type { Animations } from '../../../shared/types.ts';

const animations = {
  idle: ['idle1', 'idle2'],
  turn: ['turn1'],
  drag: [],
  clicks: [],
  moves: { default: {}, actions: [] },
  categories: [{ id: 'wave', weight: 1, actions: ['wave1'] }],
  events: {},
} as unknown as Animations;

const base = { animations, facing: 'left' as const, current: 'idle2' };

describe('decideNextAnimation——Self-broadcast animation decision', () => {
  test('idle: Draw from the idle pool to avoid the current animation', () => {
    const decision = decideNextAnimation({ ...base, kind: 'idle' });
    assert.equal(decision.kind, 'IDLE');
    assert.equal(decision.anim, 'idle1', 'The current one is idle2, another one should be drawn');
    assert.equal(decision.play, true, 'idle really cuts the animation');
  });

  test('The idle pool is only for a period of time. I would rather repeat it than return null.', () => {
    const single = { ...animations, idle: ['only'] } as unknown as Animations;
    const decision = decideNextAnimation({ ...base, animations: single, current: 'only', kind: 'idle' });
    assert.equal(decision.anim, 'only');
  });

  test('turn: drawn from the turn pool', () => {
    const decision = decideNextAnimation({ ...base, kind: 'turn' });
    assert.equal(decision.kind, 'TURN');
    assert.equal(decision.anim, 'turn1');
    assert.equal(decision.play, true);
  });

  test('move is occupied: return to null (do not cut the animation, as it will interrupt the movement)', () => {
    const decision = decideNextAnimation({ ...base, kind: 'move', move: true });
    assert.deepEqual(decision, { kind: 'MOVES', anim: null, play: false });
  });

  test('move Success: Category MOVES, action name is included (only used for logs, no repeated switching)', () => {
    const decision = decideNextAnimation({ ...base, kind: 'move', move: 'walk2' });
    assert.deepEqual(decision, { kind: 'MOVES', anim: 'walk2', play: false });
  });

  test('move failed: return to the original classification action, use classification id for the category', () => {
    const decision = decideNextAnimation({ ...base, kind: 'move', move: false });
    assert.deepEqual(decision, { kind: 'wave', anim: 'wave1', play: true });
  });

  test('action file: classification action; fallback idle pool when no classification', () => {
    const decision = decideNextAnimation({ ...base, kind: 'action' });
    assert.deepEqual(decision, { kind: 'wave', anim: 'wave1', play: true });

    const noCategories = { ...animations, categories: [] } as unknown as Animations;
    const fallback = decideNextAnimation({ ...base, animations: noCategories, kind: 'action' });
    assert.equal(fallback.kind, 'FALLBACK');
    assert.equal(fallback.anim, 'idle1');
  });
});
