/**
 * host working status pure logic unit test - verify two things: ① "goal The middle wheel of the automatic continuation
 * wheel turn/end completed is not judged as successful": middle wheel → result (no celebration); cleanup wheel
 * complete → success / blocked → error; Non-goal wheel original behavior remains unchanged. ② Task details text
 * and aggregate by session (issue #59): Take the last one of multiple in_progress and complete the list → null, super
 * long truncation by code point; task of WorkStatusStore is hung on the session entry, and it is the same origin and
 * session as state when displayed. The entry will disappear as soon as the copy is cleared (the root cause of
 * "permanently remaining after the task is completed").
 *
 * Running method: node --experimental-strip-types --test src/host/work-status.test.ts
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  completedState,
  currentTaskFromTodo,
  goalUpdateAction,
  reduceWorkStatus,
  TASK_TEXT_MAX,
  WorkStatusStore,
  type HostWorkStatusState,
} from './work-status.ts';

describe('goalUpdateAction —— update_goal arguments Analysis', () => {
  test('complete / blocked identification', () => {
    assert.equal(goalUpdateAction('{"action":"complete","goal_id":"g1"}'), 'complete');
    assert.equal(goalUpdateAction('{"action":"blocked","blocked_reason":"x"}'), 'blocked');
  });

  test('Other actions/default/invalid JSON → null (processed as not cleanup)', () => {
    assert.equal(goalUpdateAction('{"action":"edit"}'), null);
    assert.equal(goalUpdateAction('{"action":"pause"}'), null);
    assert.equal(goalUpdateAction(''), null);
    assert.equal(goalUpdateAction('not json'), null);
    assert.equal(goalUpdateAction('null'), null);
  });
});

describe('completedState —— turn/end completed final judgment', () => {
  test('non-goal wheel / no context → success (original behavior, backwards compatible)', () => {
    assert.equal(completedState(undefined), 'success');
    assert.equal(completedState({}), 'success');
    assert.equal(completedState({ goalRound: false, closing: null }), 'success');
  });

  test('Intermediate wheel of automatic continuation wheel (goalRound && not cleanup) → result (Complete of this round ≠ task completed, no celebration)', () => {
    assert.equal(completedState({ goalRound: true }), 'result');
    assert.equal(completedState({ goalRound: true, closing: null }), 'result');
  });

  test('cleanup wheel complete → success; blocked → error', () => {
    assert.equal(completedState({ goalRound: true, closing: 'complete' }), 'success');
    assert.equal(completedState({ goalRound: true, closing: 'blocked' }), 'error');
  });
});

describe('reduceWorkStatus - event compression with turn context', () => {
  const endCompleted = {
    type: 'turn/end',
    data: { turn: 5, reason: { kind: 'completed' } },
  };

  test('Intermediate wheel completed → result', () => {
    assert.equal(reduceWorkStatus(endCompleted, { goalRound: true, closing: null }), 'result');
  });

  test('cleanup wheel completed → success / blocked → error', () => {
    assert.equal(reduceWorkStatus(endCompleted, { goalRound: true, closing: 'complete' }), 'success');
    assert.equal(reduceWorkStatus(endCompleted, { goalRound: true, closing: 'blocked' }), 'error');
  });

  test('Normal wheel (no context passed) → success (backwards compatible)', () => {
    assert.equal(reduceWorkStatus(endCompleted), 'success');
    assert.equal(reduceWorkStatus(endCompleted, {}), 'success');
  });

  test('Others turn/end reason are not affected: error / blocked / aborted', () => {
    assert.equal(reduceWorkStatus({ type: 'turn/end', data: { reason: { kind: 'error' } } }), 'error');
    assert.equal(reduceWorkStatus({ type: 'turn/end', data: { reason: { kind: 'max-tokens' } } }), 'error');
    assert.equal(reduceWorkStatus({ type: 'turn/end', data: { reason: { kind: 'blocked' } } }), 'waiting');
    // aborted → null: caller cleans up the session and returns it to idle (existing semantics do not fall back)
    assert.equal(reduceWorkStatus({ type: 'turn/end', data: { reason: { kind: 'aborted' } } }), null);
  });

  test('Non-turn/end events are not affected by turn context', () => {
    assert.equal(reduceWorkStatus({ type: 'turn/start', data: { turn: 6 } }, { goalRound: true }), 'thinking');
    assert.equal(reduceWorkStatus({ type: 'tool/call', data: { name: 'read' } }, { goalRound: true }), 'working');
    assert.equal(reduceWorkStatus({ type: 'tool/result', data: {} }), 'result');
  });
});

describe('currentTaskFromTodo ——Task details copy (issue #59)', () => {
  const todo = (...items: Array<[string, string]>) => ({
    data: { todos: items.map(([status, content]) => ({ status, content })) },
  });

  test('Single in_progress → its copy', () => {
    assert.equal(
      currentTaskFromTodo(todo(['completed', '第一步'], ['in_progress', '正在执行 phase1'])),
      '正在执行 phase1',
    );
  });

  test('Multiple in_progress → Take **the last** (the most recent step)', () => {
    // Cause: agent marks the new step as in_progress but forgets to close the previous step; taking the first one will always stop at the earliest step.
    const event = todo(['in_progress', '正在执行 phase1'], ['in_progress', '正在执行 phase2']);
    assert.equal(currentTaskFromTodo(event), '正在执行 phase2');
  });

  test('None in_progress → fallback to the first pending; none → null', () => {
    assert.equal(currentTaskFromTodo(todo(['completed', 'a'], ['pending', 'b'], ['pending', 'c'])), 'b');
    assert.equal(currentTaskFromTodo(todo(['completed', 'a'], ['completed', 'b'])), null);
    assert.equal(currentTaskFromTodo(todo()), null);
  });

  test('Empty list / missing field / non-array / blank content → null (never produce empty string bubble )', () => {
    assert.equal(currentTaskFromTodo({}), null);
    assert.equal(currentTaskFromTodo({ data: {} }), null);
    assert.equal(currentTaskFromTodo({ data: { todos: 'x' as unknown as [] } }), null);
    assert.equal(currentTaskFromTodo(todo(['in_progress', '   '])), null);
    assert.equal(currentTaskFromTodo(todo(['in_progress', ''])), null);
  });

  test('Very long copy is truncated according to code points and added with ellipsis, and it is not truncated when it reaches the upper limit.', () => {
    const long = '甲'.repeat(TASK_TEXT_MAX + 1);
    const cut = currentTaskFromTodo(todo(['in_progress', long]));
    assert.equal(cut, `${'甲'.repeat(TASK_TEXT_MAX)}…`);
    assert.equal(Array.from(cut ?? '').length, TASK_TEXT_MAX + 1); // 40 characters + ellipsis
    assert.equal(currentTaskFromTodo(todo(['in_progress', '乙'.repeat(TASK_TEXT_MAX)])), '乙'.repeat(TASK_TEXT_MAX));
  });

  test('Truncation does not split surrogate pairs (emoji will not be truncated into half characters)', () => {
    const text = '🐟'.repeat(TASK_TEXT_MAX + 5);
    const cut = currentTaskFromTodo(todo(['in_progress', text])) ?? '';
    assert.equal(Array.from(cut).length, TASK_TEXT_MAX + 1); // 40 emoji + ellipsis
    assert.equal(cut.includes('\uFFFD'), false);
    assert.equal(/[\uD800-\uDBFF]$/.test(cut), false, 'Must not end with an isolated high-ranking agent');
  });
});

describe('WorkStatusStore - aggregate and display by session (issue #59)', () => {
  test('Update ts only when state changes; do not update repeatedly if the same status is the same as seq (anti-swipe)', () => {
    const s = new WorkStatusStore();
    assert.equal(s.setState('a', 'thinking', 1), true);
    const ts1 = s.snapshot().ts;
    assert.equal(s.setState('a', 'thinking', 1), false, 'Same status as seq → no change');
    assert.equal(s.snapshot().ts, ts1);
    assert.equal(s.setState('a', 'working', 2), true);
    assert.equal(s.snapshot().state, 'working');
  });

  test('task is accessed with the session entry, and is accessed from the same session as state.', () => {
    const s = new WorkStatusStore();
    s.setState('a', 'working', 1);
    assert.equal(s.has('a'), true);
    assert.equal(s.setTask('a', '正在执行 phase1'), true);
    assert.deepEqual(
      { state: s.snapshot().state, task: s.snapshot().task },
      { state: 'working', task: '正在执行 phase1' },
    );
  });

  test('The snapshot takes sessionId of the current display session; idle is null', () => {
    const s = new WorkStatusStore();
    assert.equal(s.snapshot().sessionId, null);
    s.setState('alpha', 'thinking', 1);
    assert.equal(s.snapshot().sessionId, 'alpha');
    s.setState('beta', 'waiting', 2); // waiting (60) > thinking (30) → Change display session
    assert.equal(
      s.snapshot().sessionId,
      'beta',
      'When changing the display session, id must be changed together, otherwise the click will jump to the wrong page.',
    );
    s.clear('beta');
    assert.equal(
      s.snapshot().sessionId,
      'alpha',
      'When returning to the previous conversation, id will also come back.',
    );
  });

  test('Writing task in a session with no active entries does not take effect (no ghost copy will be created)', () => {
    const s = new WorkStatusStore();
    assert.equal(s.has('ghost'), false);
    assert.equal(s.setTask('ghost', '不该出现'), false);
    assert.equal(s.snapshot().task, null);
  });

  test('Multi-session: Display the one with the highest priority, task follows it (no conversation chaining)', () => {
    const s = new WorkStatusStore();
    s.setState('a', 'thinking', 1);
    s.setTask('a', 'A 的任务');
    s.setState('b', 'working', 2); // working (40) > thinking (30) → Show b
    assert.equal(s.snapshot().state, 'working');
    assert.equal(s.snapshot().task, null, 'b has no task details → does not display the copy of a');
    s.setTask('b', 'B 的任务');
    assert.equal(s.snapshot().task, 'B 的任务');
    // a is still active: After b falls out, the text of state and a is displayed back to a
    s.clear('b');
    assert.equal(s.snapshot().state, 'thinking');
    assert.equal(s.snapshot().task, 'A 的任务');
  });

  test('For the same state, take the larger seq (the most recent event takes precedence)', () => {
    const s = new WorkStatusStore();
    s.setState('a', 'working', 1);
    s.setTask('a', 'A');
    s.setState('b', 'working', 2);
    s.setTask('b', 'B');
    assert.equal(s.snapshot().task, 'B');
  });

  test('The entry is cleared → the copy disappears (this is the root cause of "remaining permanently after the task is completed")', () => {
    const s = new WorkStatusStore();
    s.setState('a', 'success', 1);
    s.setTask('a', '已经做完的旧任务');
    assert.equal(s.clear('a'), true);
    assert.equal(s.snapshot().state, null);
    assert.equal(s.snapshot().task, null, 'Old copy must not remain in subsequent activities');
    assert.equal(s.has('a'), false);
  });

  test('setTask ( null ) clear text: The path of fallback file text (in_progress/pending is no longer in the list)', () => {
    const s = new WorkStatusStore();
    s.setState('a', 'working', 1);
    s.setTask('a', 'phase1');
    s.setTask('a', null);
    assert.equal(s.snapshot().task, null);
  });

  test('Display priority table: waiting > error > working > thinking > result > success', () => {
    const order: HostWorkStatusState[] = ['waiting', 'error', 'working', 'thinking', 'result', 'success'];
    for (let i = 0; i < order.length - 1; i += 1) {
      const s = new WorkStatusStore();
      s.setState('low', order[i + 1], 10); // The serial number is larger: only priority can determine the outcome.
      s.setState('high', order[i], 1);
      assert.equal(s.snapshot().state, order[i], `${order[i]} must take precedence over ${order[i + 1]}`);
    }
  });
});
