/**
 * Contract test of sleep state machine (src/client/pet/card/sleep-machine.ts).
 *
 * Four contracts: first enter start (once) and then loop (infinite playback); the loop segment must be renamed loop
 * after being pushed out by external animation; wake up to play end and then hand back the random chain once; be woken
 * up during the transition to fall asleep and not play end.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { createSleepMachine } from './sleep-machine.ts';
import type { CardHub } from './hub.ts';
import type { SleepState } from '../../../shared/state.ts';

/** Sleeping leaves: The three segment names are selected by the host, and the state machine is only responsible for broadcasting in order. */
const ASLEEP: SleepState = { sleeping: true, start: '睡觉-开始', loop: '睡觉-循环', end: '睡觉-起来' };
/** Waking leaves: only one field sleeping. */
const AWAKE: SleepState = { sleeping: false };

/** Create a runtime that only records source change calls; card members not used by this module are filled in by type assertion. */
function harness() {
  const calls: string[] = [];
  let anim = '待机呼吸休闲';
  let once = true;
  const hub = {
    cfg: () => ({ id: 'pet-1' }),
    card: {
      actions: {
        setAnim: (next: string) => {
          anim = next;
          calls.push('anim:' + next);
        },
        setOnce: (next: boolean) => {
          once = next;
          calls.push('once:' + next);
        },
        bumpSeq: () => calls.push('seq'),
      },
    },
    stopMotion: () => calls.push('stopMotion'),
    bubbles: { hideWork: () => calls.push('hideWork') },
  } as unknown as CardHub;
  return { hub, calls, anim: () => anim, once: () => once };
}

/** Create a state machine; handedBack records the number of times the random chain is returned. */
function setup(hub: CardHub) {
  let handedBack = 0;
  const sleep = createSleepMachine(
    hub,
    () => {
      handedBack += 1;
    },
    () => {},
  );
  return { sleep, handedBack: () => handedBack };
}

describe('sleep-machine ——Enter and loop', () => {
  test('Entering sleep: play start first (play only once) after the stop and go position, then switch to loop (loop) after playing', () => {
    const { hub, calls, anim, once } = harness();
    const { sleep } = setup(hub);

    sleep.apply(ASLEEP);

    assert.deepEqual(calls, ['stopMotion', 'hideWork', 'once:true', 'anim:睡觉-开始', 'seq']);
    assert.equal(sleep.sleeping(), true);
    assert.equal(sleep.phase(), 'start');

    assert.equal(
      sleep.consumeEnded(),
      true,
      'start will return to the state machine for processing after playing, and will not return to the random chain.',
    );
    assert.equal(anim(), '睡觉-循环');
    assert.equal(
      once(),
      false,
      'The loop segment must be broadcast indefinitely, otherwise ended will fall back to the state machine',
    );
    assert.equal(sleep.phase(), 'loop');
  });

  test('The loop segment is blocked by the balance animation: ended and then renamed loop instead of continuing the balance animation into an infinite loop.', () => {
    const { hub, calls, anim, once } = harness();
    const { sleep } = setup(hub);
    sleep.apply(ASLEEP);
    sleep.consumeEnded();
    // Replacement scene: The balance event directly changes the source (once = true), the sleeping position loop is removed, and ended will appear after the segment is played.
    hub.card.actions.setAnim('余额-钱袋如常');
    hub.card.actions.setOnce(true);
    calls.length = 0;

    assert.equal(
      sleep.consumeEnded(),
      true,
      'ended returns to the state machine for processing and does not return to the random chain.',
    );

    assert.equal(anim(), '睡觉-循环', 'The loop segment should be renamed instead of replaying the current foreground');
    assert.equal(once(), false, 'Infinite playback needs to be restored after pulling back the loop segment');
  });
});

describe('sleep-machine——Wake up', () => {
  test('Wake up: Play end, return the random chain once and return to wakefulness after playing', () => {
    const { hub, anim, once } = harness();
    const { sleep, handedBack } = setup(hub);
    sleep.apply(ASLEEP);
    sleep.consumeEnded();

    sleep.apply(AWAKE);

    assert.equal(anim(), '睡觉-起来');
    assert.equal(once(), true, 'The wake-up transition is only played once');
    assert.equal(sleep.phase(), 'end');

    assert.equal(sleep.consumeEnded(), true);
    assert.equal(handedBack(), 1, 'end should be returned to the random chain exactly once after playing');
    assert.equal(sleep.sleeping(), false);
  });

  test('Being woken up during the transition to falling asleep: Do not play end and directly cancel the fall asleep.', () => {
    const { hub, anim } = harness();
    const { sleep, handedBack } = setup(hub);
    sleep.apply(ASLEEP);

    sleep.apply(AWAKE);

    assert.equal(anim(), '睡觉-开始', 'You shouldn’t start playing if you haven’t really fallen asleep.');
    assert.equal(sleep.sleeping(), false);
    assert.equal(sleep.consumeEnded(), false, 'Not in sleep mode. ended returns the caller and handles it as usual.');
    assert.equal(handedBack(), 0);
  });

  test('Write the same sleeping leaf repeatedly: do not play it again from the beginning', () => {
    const { hub, calls } = harness();
    const { sleep } = setup(hub);
    sleep.apply(ASLEEP);
    calls.length = 0;

    sleep.apply(ASLEEP);

    assert.deepEqual(calls, [], 'The playback progress should not be reset when the leaf is rewritten once');
  });
});
