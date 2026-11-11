/**
 * Completed contract testing of notification text source (src/host/plugin/session-notify.ts).
 *
 * Verify two things: the reply text follows the completion frame; the cache "dequeues after the timer" - the activity
 * gate determines which one is still alive and will advance return. If the deletion is placed in the timer, a session
 * text will be left here that will never be cleared.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { createSessionNotify } from './session-notify.ts';

/** A "conversation completed" cleanup event. */
const COMPLETED = { type: 'turn/end', data: { reason: { kind: 'completed' } } };

/** Wait for the asynchronous beat to finish (the timer is a fake clock, microtask is still true). */
const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/**
 * Create a minimal instance.
 *
 * @param activity - the active family returned by the activity gate; the default means "no running activity" (query
 * failure and no waterfall are the same).
 * @returns instance with pushed notification frame.
 */
function make(activity?: () => Promise<unknown[]>) {
  const frames: unknown[] = [];
  const notify = createSessionNotify({
    ctx: activity ? { waterfall: activity } : {},
    publishWorkStatus: () => {},
    state: { writeSection: (_name: string, value: unknown) => frames.push(value) },
    workStatus: { clear: () => {}, stateOf: () => null },
  } as never);
  return { notify, frames };
}

describe('scheduleCompletionNotify - lifecycle of reply text', () => {
  test('Completion: The frame contains text and is dequeued when the timer is scheduled.', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { notify, frames } = make();
    notify.lastReplyText.set('s1', '改完了');
    notify.scheduleCompletionNotify('s1', COMPLETED);
    assert.equal(
      notify.lastReplyText.has('s1'),
      false,
      'Dequeue as soon as it is retrieved. You cannot wait for the timer to expire before deleting it.',
    );

    t.mock.timers.tick(1500);
    await settle();

    assert.equal(frames.length, 1);
    const data = (frames[0] as { event: { data: { text?: string } } }).event.data;
    assert.equal(data.text, '改完了');
  });

  test('The activity gate determines that it is still alive: no frames are pushed, but the cache does not remain either.', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { notify, frames } = make(async () => [{ kind: 'job' }]);
    notify.lastReplyText.set('s2', '这一轮先不用');
    notify.scheduleCompletionNotify('s2', COMPLETED);
    t.mock.timers.tick(1500);
    await settle();

    assert.equal(frames.length, 0, 'The completion notification does not play while running while still alive.');
    assert.equal(notify.lastReplyText.size, 0, 'The one returned early cannot leave any residue.');
  });

  test('No text: push frames as usual, just without text', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { notify, frames } = make();
    notify.scheduleCompletionNotify('s3', COMPLETED);
    t.mock.timers.tick(1500);
    await settle();

    const data = (frames[0] as { event: { data: Record<string, unknown> } }).event.data;
    assert.equal('text' in data, false);
  });

  test('Cache isolation by session: the body of another session will not come through', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { notify, frames } = make();
    notify.lastReplyText.set('a', 'A 的回复');
    notify.lastReplyText.set('b', 'B 的回复');
    notify.scheduleCompletionNotify('b', COMPLETED);
    t.mock.timers.tick(1500);
    await settle();

    const data = (frames[0] as { event: { data: { text?: string } } }).event.data;
    assert.equal(data.text, 'B 的回复');
    assert.equal(notify.lastReplyText.get('a'), 'A 的回复', 'The other conversation should not be deleted easily.');
  });
});
