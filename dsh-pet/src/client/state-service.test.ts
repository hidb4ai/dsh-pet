/**
 * Behavior contract of status exit: The same reference is saved and read out; it returns to null after clearing.
 *
 * Shape verification is not included here - `PollState` is responsible for the analysis of shared/state, and this
 * module is only used for storage.
 */
import { beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { getStateSnapshot, resetStateSnapshot, setStateSnapshot, subscribeStateSnapshot } from './state-service.ts';
import type { PollState } from '../shared/state.ts';

/** Create a minimum usable state: one segmented leaf + one leaf for one pet. */
function sample(counter: number): PollState {
  return {
    counter,
    pets: { main: { say: { counter: counter + 1, data: { text: 'hi', seq: counter } } } },
    sections: {
      balance: { counter: 0, data: null },
      config: { counter: 0, data: null },
      menu: { counter: 0, data: null },
      notify: { counter: 0, data: null },
      workStatus: { counter: 0, data: null },
    },
  } as unknown as PollState;
}

describe('state-service ——The latest shot is kept', () => {
  beforeEach(() => {
    resetStateSnapshot();
  });

  test('What is read before the first shot is empty: do not pretend to have status when there is no status', () => {
    assert.equal(getStateSnapshot(), null);
  });

  test('Read what you save: the same reference is returned, no copy is made.', () => {
    const state = sample(100);
    setStateSnapshot(state);
    assert.equal(getStateSnapshot(), state);
  });

  test('New one-shot whole-packet replacement: what is read is always the latest write', () => {
    setStateSnapshot(sample(100));
    const next = sample(200);
    setStateSnapshot(next);
    assert.equal(getStateSnapshot()?.counter, 200);
    assert.equal(getStateSnapshot(), next);
  });

  test('Return to empty after clear: reset will not read the residue of the previous tick after that', () => {
    setStateSnapshot(sample(100));
    resetStateSnapshot();
    assert.equal(getStateSnapshot(), null);
  });
});

describe('state-service —— subscribe every beat', () => {
  beforeEach(() => {
    resetStateSnapshot();
  });

  test('The subscriber is notified every time a write is made, and the reference given is the reference just written.', () => {
    const seen: PollState[] = [];
    subscribeStateSnapshot((state) => seen.push(state));
    const first = sample(1);
    const second = sample(2);
    setStateSnapshot(first);
    setStateSnapshot(second);
    assert.deepEqual(seen, [first, second]);
  });

  test('No more notifications will be received after unsubscribing (the callback will not remain when the panel is unmounted)', () => {
    let count = 0;
    const off = subscribeStateSnapshot(() => {
      count += 1;
    });
    setStateSnapshot(sample(1));
    off();
    setStateSnapshot(sample(2));
    assert.equal(count, 1);
  });

  test('reset at the same time clear subscribe: the monitoring of the previous use case will not be leaked to the next page', () => {
    let count = 0;
    subscribeStateSnapshot(() => {
      count += 1;
    });
    resetStateSnapshot();
    setStateSnapshot(sample(1));
    assert.equal(count, 0);
  });

  test('Unsubscription is idempotent: repeated calls will not affect other subscribers.', () => {
    let kept = 0;
    subscribeStateSnapshot(() => {
      kept += 1;
    });
    const off = subscribeStateSnapshot(() => {});
    off();
    off();
    setStateSnapshot(sample(1));
    assert.equal(kept, 1);
  });

  test('A certain subscriber throws an error → only swallows itself, other subscribers receive it as usual (without dragging down polling)', () => {
    let received = 0;
    subscribeStateSnapshot(() => {
      throw new Error('bad listener');
    });
    subscribeStateSnapshot(() => {
      received += 1;
    });
    assert.doesNotThrow(() => setStateSnapshot(sample(1)));
    assert.equal(received, 1);
    assert.equal(getStateSnapshot()?.counter, 1);
  });
});
