/**
 * host notification frame generation pure logic unit test - verify "DSH host event → shared/notify.ts contract frame":
 * turn/end (completed/error/max-tokens bombs, aborted, etc. do not bomb), approval/asked, tool/call (ask_user_question
 * parses questions), agent/error (message extraction), as well as session gate shouldNotifySession (subagent is not
 * sent, ordinary fork is sent as usual) and activity gate (issue #114: only blocks "dialogue completion" + criterion
 * hasBlockingActivity).
 *
 * Running method: node --experimental-strip-types --test src/host/notify-events.test.ts
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  agentErrorFrame,
  hasBlockingActivity,
  type HostNotifyFrame,
  isCompletionTurnEnd,
  lastAssistantText,
  parseToolQuestions,
  reduceNotifyFrame,
  sessionIdOf,
  shouldNotifySession,
  turnEndNotifyKind,
} from './notify-events.ts';

describe('turnEndNotifyKind —— turn/end reason.kind → Notification Category', () => {
  test('completed / error / max-tokens bomb', () => {
    assert.equal(turnEndNotifyKind('completed'), 'completed');
    assert.equal(turnEndNotifyKind('error'), 'error');
    assert.equal(turnEndNotifyKind('max-tokens'), 'max-tokens');
  });

  test('aborted / interrupted / blocked / Unknown → Do not play', () => {
    assert.equal(turnEndNotifyKind('aborted'), null);
    assert.equal(turnEndNotifyKind('interrupted'), null);
    assert.equal(turnEndNotifyKind('blocked'), null);
    assert.equal(turnEndNotifyKind(undefined), null);
  });
});

describe('reduceNotifyFrame —— session/event sub-event → frame', () => {
  test('turn/end completed → session/event frame (reason transparent transmission as it is)', () => {
    const frame = reduceNotifyFrame({
      type: 'turn/end',
      data: { reason: { kind: 'completed' } },
    });
    assert.deepEqual(frame, {
      type: 'session/event',
      event: { type: 'turn/end', data: { reason: { kind: 'completed' } } },
    });
  });

  test('turn/end error → frame, error.message transparent transmission', () => {
    const frame = reduceNotifyFrame({
      type: 'turn/end',
      data: { reason: { kind: 'error', error: { message: 'boom' } } },
    });
    assert.deepEqual(frame, {
      type: 'session/event',
      event: { type: 'turn/end', data: { reason: { kind: 'error', error: { message: 'boom' } } } },
    });
  });

  test('turn/end aborted → null (not played)', () => {
    assert.equal(reduceNotifyFrame({ type: 'turn/end', data: { reason: { kind: 'aborted' } } }), null);
  });

  test('approval/asked → approval/requested frame (toolName/reason band)', () => {
    const frame = reduceNotifyFrame({
      type: 'approval/asked',
      data: { id: 'a1', toolName: 'pwsh', reason: '需要权限', callId: 'c1' },
    });
    assert.deepEqual(frame, { type: 'approval/requested', toolName: 'pwsh', reason: '需要权限' });
  });

  test('approval/asked without reason → frame without reason field', () => {
    assert.deepEqual(reduceNotifyFrame({ type: 'approval/asked', data: { toolName: 'pwsh' } }), {
      type: 'approval/requested',
      toolName: 'pwsh',
    });
  });

  test('tool/call ask_user_question → question/requested frame (parsing arguments)', () => {
    const frame = reduceNotifyFrame({
      type: 'tool/call',
      data: { name: 'ask_user_question', arguments: '{"questions":[{"id":"q1","question":"选哪个？"}]}' },
    });
    assert.deepEqual(frame, {
      type: 'question/requested',
      questions: [{ id: 'q1', question: '选哪个？' }],
    });
  });

  test('tool/call non-question tool / none questions / invalid arguments → null', () => {
    assert.equal(reduceNotifyFrame({ type: 'tool/call', data: { name: 'pwsh' } }), null);
    assert.equal(
      reduceNotifyFrame({ type: 'tool/call', data: { name: 'ask_user_question', arguments: '{"questions":[]}' } }),
      null,
    );
    assert.equal(
      reduceNotifyFrame({ type: 'tool/call', data: { name: 'ask_user_question', arguments: 'not json' } }),
      null,
    );
  });

  test('Unknown event / None type → null', () => {
    assert.equal(reduceNotifyFrame({ type: 'todo/write' }), null);
    assert.equal(reduceNotifyFrame({}), null);
  });
});

describe('parseToolQuestions —— arguments JSON Analysis', () => {
  test('Valid questions array', () => {
    assert.deepEqual(parseToolQuestions('{"questions":[{"question":"A"}]}'), [{ question: 'A' }]);
  });
  test('Invalid JSON / non-array / non-character string → null', () => {
    assert.equal(parseToolQuestions('nope'), null);
    assert.equal(parseToolQuestions('{"questions":"x"}'), null);
    assert.equal(parseToolQuestions(undefined), null);
  });
});

describe('agentErrorFrame —— agent/error → host/agent-error frame', () => {
  test('Error object extraction message', () => {
    assert.deepEqual(agentErrorFrame(new Error('boom')), { type: 'host/agent-error', message: 'boom' });
  });
  test('character string transparent transmission', () => {
    assert.deepEqual(agentErrorFrame('直接失败'), { type: 'host/agent-error', message: '直接失败' });
  });
  test('None message → empty string fallback', () => {
    assert.deepEqual(agentErrorFrame(undefined), { type: 'host/agent-error', message: '' });
  });
});

describe('shouldNotifySession - Session Gate (issue #82)', () => {
  // The following three header are all measured true values on this machine (dsh-pet warehouse workspace, DSH session format v4).
  const subagent = {
    id: '7590c092-5e81-4d0b-92de-4c85e65fef61',
    header: {
      id: '7590c092-5e81-4d0b-92de-4c85e65fef61',
      cwd: 'D:\\Source\\windows\\Downloads\\pet',
      parentSession: 'session-08286e28-0ad9-4076-9a2c-6f333645cbb1',
      isSeeded: false,
      origin: 'subagent',
      delegationDepth: 1,
    },
  };
  const forkedMain = {
    id: 'session-08286e28-0ad9-4076-9a2c-6f333645cbb1',
    header: {
      id: 'session-08286e28-0ad9-4076-9a2c-6f333645cbb1',
      cwd: 'D:\\Source\\windows\\Downloads\\pet',
      parentSession: 'session-d600d115-f8ed-4ee3-a70e-48c0d792e285',
      isSeeded: true,
      delegationDepth: 0,
    },
  };
  const root = {
    id: 'session-d600d115-f8ed-4ee3-a70e-48c0d792e285',
    header: {
      id: 'session-d600d115-f8ed-4ee3-a70e-48c0d792e285',
      cwd: 'D:\\Source\\windows\\Downloads\\pet',
      isSeeded: false,
      delegationDepth: 0,
    },
  };

  test('Subagent (origin = subagent) → not sent', () => {
    assert.equal(shouldNotifySession(subagent), false);
  });

  test('origin is missing but delegationDepth >0 (after the subagent is fork) → not sent', () => {
    assert.equal(shouldNotifySession({ header: { id: 'x', delegationDepth: 1 } }), false);
  });

  test('Root session (no parentSession / no origin / depth =0) → send', () => {
    assert.equal(shouldNotifySession(root), true);
  });

  // This is the key to the entire judgment: Generally, fork (changing the model to rebuild the conversation, etc.)
  // also contains parentSession. Filtering by parentSession will mute the main conversation in progress at the same
  // time - this is the conversation actually tested on this machine.
  test('Ordinary fork (with parentSession, origin missing, depth =0) → as issued (parentSession sub-agent is not allowed)', () => {
    assert.equal(shouldNotifySession(forkedMain), true);
    assert.equal(forkedMain.header.parentSession !== undefined, true, 'Premise: It does carry parentSession');
    assert.equal('origin' in forkedMain.header, false, 'Premise: It does not have origin');
  });

  test('The criterion is not available → all will be released (never mute the entire notification)', () => {
    assert.equal(shouldNotifySession(undefined), true);
    assert.equal(shouldNotifySession(null), true);
    assert.equal(shouldNotifySession({}), true);
    assert.equal(shouldNotifySession({ header: null }), true);
    assert.equal(shouldNotifySession({ header: 'not-an-object' }), true);
    assert.equal(shouldNotifySession({ header: {} }), true);
  });

  test('Wrong field shape → Release (do not treat outliers as subagents)', () => {
    assert.equal(shouldNotifySession({ header: { origin: 'main' } }), true);
    assert.equal(shouldNotifySession({ header: { delegationDepth: '1' } }), true);
    assert.equal(shouldNotifySession({ header: { delegationDepth: -1 } }), true);
    assert.equal(shouldNotifySession({ header: { delegationDepth: Number.NaN } }), true);
    assert.equal(shouldNotifySession({ header: { delegationDepth: 0 } }), true);
  });
});

describe('isCompletionTurnEnd —— activity gate only blocks "dialogue completion" (issue #114)', () => {
  test('turn/end + completed → true (the only frame that requires idle confirmation first)', () => {
    assert.equal(isCompletionTurnEnd({ type: 'turn/end', data: { reason: { kind: 'completed' } } }), true);
  });

  test('Other kind of turn/end → false (failure/truncation is "something really happened", follow the bomb)', () => {
    assert.equal(isCompletionTurnEnd({ type: 'turn/end', data: { reason: { kind: 'error' } } }), false);
    assert.equal(isCompletionTurnEnd({ type: 'turn/end', data: { reason: { kind: 'max-tokens' } } }), false);
    assert.equal(isCompletionTurnEnd({ type: 'turn/end', data: { reason: { kind: 'aborted' } } }), false);
    assert.equal(isCompletionTurnEnd({ type: 'turn/end', data: {} }), false);
  });

  test('Permission application / user selection / missing field → false (notifications waiting for other people to operate must not be silenced by the activity gate)', () => {
    assert.equal(isCompletionTurnEnd({ type: 'approval/asked', data: { toolName: 'pwsh' } }), false);
    assert.equal(
      isCompletionTurnEnd({ type: 'tool/call', data: { name: 'ask_user_question', arguments: '{}' } }),
      false,
    );
    assert.equal(isCompletionTurnEnd(undefined), false);
    assert.equal(isCompletionTurnEnd(null), false);
    assert.equal(isCompletionTurnEnd({}), false);
  });
});

describe('sessionIdOf —— activity gate timer session key', () => {
  test('header.id priority → fallback top id → fallback unknown', () => {
    assert.equal(sessionIdOf({ id: 'top', header: { id: 'hdr' } }), 'hdr');
    assert.equal(sessionIdOf({ id: 'top', header: {} }), 'top');
    assert.equal(sessionIdOf({ id: 'top' }), 'top');
    assert.equal(sessionIdOf({}), 'unknown');
    assert.equal(sessionIdOf(null), 'unknown');
    assert.equal(sessionIdOf(undefined), 'unknown');
  });
});

describe('hasBlockingActivity —— activity gate criterion (issue #114)', () => {
  test('Only the turn family → Release (your turn in this conversation has just ended, you are not allowed to block yourself)', () => {
    assert.equal(hasBlockingActivity([{ kind: 'turn' }]), false);
  });

  test("Running team member/subordinate sub-agent (subagent) → Block (the protagonist of the team's false positive)", () => {
    assert.equal(hasBlockingActivity([{ kind: 'turn' }, { kind: 'subagent', items: [{ id: 'm1' }] }]), true);
  });

  test('Background task (job)/active scheduled reminder (schedule) → block', () => {
    assert.equal(hasBlockingActivity([{ kind: 'job', items: [{ id: 'j1', label: 'x' }] }]), true);
    assert.equal(hasBlockingActivity([{ kind: 'schedule' }]), true);
  });

  test('Empty/not an array/wrong shape → release (if the criterion is not available, the notification will never be silenced)', () => {
    assert.equal(hasBlockingActivity([]), false);
    assert.equal(hasBlockingActivity(undefined), false);
    assert.equal(hasBlockingActivity(null), false);
    assert.equal(hasBlockingActivity('nope'), false);
    assert.equal(hasBlockingActivity({ kind: 'subagent' }), false, 'Not an array = wrong shape, let go');
    assert.equal(hasBlockingActivity([null, 42, {}, { kind: 7 }]), false);
  });

  test('Unknown family → Release (host Adding a new family will not invalidate the entire notification)', () => {
    assert.equal(hasBlockingActivity([{ kind: 'something-new' }]), false);
  });
});

describe('lastAssistantText —— Take the last text from assistant/message', () => {
  test('Take the last text block and flatten the blank', () => {
    assert.equal(
      lastAssistantText({
        type: 'assistant/message',
        data: { message: { content: [{ type: 'text', text: '  改了  三处\n并跑了测试  ' }] } },
      }),
      '改了 三处 并跑了测试',
    );
  });

  test('Skip reasoning block, only recognize text', () => {
    assert.equal(
      lastAssistantText({
        type: 'assistant/message',
        data: {
          message: {
            content: [
              { type: 'reasoning', text: '这条不该出现' },
              { type: 'text', text: '真正的回复' },
            ],
          },
        },
      }),
      '真正的回复',
    );
  });

  test('Extra long words are truncated to 200 characters, non-assistant/message will always be null', () => {
    const long = lastAssistantText({
      type: 'assistant/message',
      data: { message: { content: [{ type: 'text', text: 'x'.repeat(300) }] } },
    });
    assert.equal(long?.length, 200);
    assert.equal(lastAssistantText({ type: 'turn/end', data: {} }), null);
    assert.equal(lastAssistantText({ type: 'assistant/message', data: {} }), null);
  });
});

describe('reduceNotifyFrame ——Complete frame with reply beginning', () => {
  /** Get the turn/end data in the frame; the frame itself is in a loose shape, only the shared side knows `event`, here we borrow unknown to transfer it once. */
  const frameData = (frame: HostNotifyFrame | null): Record<string, unknown> =>
    (frame as unknown as { event: { data: Record<string, unknown> } }).event.data;

  test('completed + with text → with text in the frame', () => {
    const frame = reduceNotifyFrame({ type: 'turn/end', data: { reason: { kind: 'completed' } } }, '改完了');
    assert.equal(frameData(frame).text, '改完了');
  });

  test('completed but no text → do not write text field', () => {
    const frame = reduceNotifyFrame({ type: 'turn/end', data: { reason: { kind: 'completed' } } });
    assert.equal('text' in frameData(frame), false);
  });

  test('error does not hang the text (the reason for failure is reason.error)', () => {
    const frame = reduceNotifyFrame(
      { type: 'turn/end', data: { reason: { kind: 'error', error: { message: 'boom' } } } },
      '这段不该出现',
    );
    assert.equal('text' in frameData(frame), false);
  });
});
