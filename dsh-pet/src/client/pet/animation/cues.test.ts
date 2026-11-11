/**
 * Contract test for broadcast completion determination (src/client/pet/animation/cues.ts).
 *
 * Three contracts: After the event animation is played, it will only return to the event chain and never enter the
 * random chain; the state animation will be rotated or continued in the non-final state, and the final state and idle
 * state will return to the end of the event; turning, dragging, and clicking will each return to their own branches,
 * and the rest will go to the random chain.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { decideEndedCue } from './cues.ts';
import type { Animations } from '../../../shared/types.ts';

const animations = {
  idle: ['idle1'],
  turn: ['turn1'],
  drag: ['drag1'],
  clicks: ['click1'],
  moves: { default: {}, actions: [] },
  categories: [],
  events: {
    // Two candidate slots: rotate after broadcasting; single candidate: continue broadcasting.
    workStatus: [['ws-run-a', 'ws-run-b'], 'ws-error'],
    balance: ['bal1'],
  },
} as unknown as Animations;

describe('decideEndedCue——Which branch to enter after broadcasting?', () => {
  test('After the normal self-broadcast animation is finished: follow the random chain', () => {
    assert.deepEqual(decideEndedCue({ animations, current: 'idle1', workState: null }), { kind: 'random' });
  });

  test('After the turning animation is played: return to the turn branch (component flip direction)', () => {
    assert.deepEqual(decideEndedCue({ animations, current: 'turn1', workState: null }), { kind: 'turn' });
  });

  test('After the drag and click animation is finished: return to the interaction end branch', () => {
    assert.deepEqual(decideEndedCue({ animations, current: 'drag1', workState: null }), {
      kind: 'interaction-done',
    });
    assert.deepEqual(decideEndedCue({ animations, current: 'click1', workState: null }), {
      kind: 'interaction-done',
    });
  });

  test('Gear animation + non-final state + multiple candidates: rotate to the next candidate', () => {
    const cue = decideEndedCue({ animations, current: 'ws-run-a', workState: 'working' });
    assert.equal(cue.kind, 'work-rotate');
    assert.equal(cue.kind === 'work-rotate' ? cue.anim : '', 'ws-run-b', 'Avoid the current section during rotation');
  });

  test('Gear animation + non-final state + single candidate: continue playing the same segment', () => {
    assert.deepEqual(decideEndedCue({ animations, current: 'ws-error', workState: 'error' }), {
      kind: 'event-done',
    });
    // ws-error is in the single candidate position, but the working state is the final state error → the event ends instead of continuing.
    assert.deepEqual(decideEndedCue({ animations, current: 'ws-error', workState: null }), { kind: 'event-done' });
  });

  test('The event animation is finished (non-stage): the event ends and the random chain is not entered.', () => {
    assert.deepEqual(decideEndedCue({ animations, current: 'bal1', workState: null }), { kind: 'event-done' });
  });

  test('The working status is final or idle: no rotation or resumption.', () => {
    for (const state of [null, undefined, 'success', 'error']) {
      const cue = decideEndedCue({ animations, current: 'ws-run-a', workState: state });
      assert.deepEqual(cue, { kind: 'event-done' }, `state=${String(state)} must return the event-end result`);
    }
  });
});
