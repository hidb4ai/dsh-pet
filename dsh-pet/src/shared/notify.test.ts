/**
 * Unit test of notification title - verify the convention of "the session name enters the title": the title of
 * completed is the session name (if there is no name, fallback "conversation is completed"); error / max-tokens /
 * Approval / Question uses "session name · event", the event type is not swallowed up by the session name; there is no
 * session name (host does not contain sessionId, the session is not in the list, the session is blank) fallback fixed
 * copy; very long session names are truncated by 30 characters, and the title only occupies one line.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { frameToToast, MAX_BODY } from './notify.ts';

/** Approval frame: The title is fixed to "Applying for Permissions", use it to observe how the session name is spelled into the title. */
const approvalFrame = { type: 'approval/requested', sessionId: 's1', toolName: 'bash', reason: '要写 /tmp' };

describe('frameToToast: The session name is entered into the title', () => {
  test('When there is a session name, it is "session name·event"', () => {
    assert.equal(frameToToast(approvalFrame, '修复通知标题')?.title, '修复通知标题 · 正在申请权限');
  });

  test('When there is no session name, empty string, or pure blank, only the event type is left.', () => {
    assert.equal(frameToToast(approvalFrame)?.title, '正在申请权限');
    assert.equal(frameToToast(approvalFrame, '')?.title, '正在申请权限');
    assert.equal(frameToToast(approvalFrame, '   ')?.title, '正在申请权限');
  });

  test('The session name is truncated after a long press of 30 characters, but the event type is not truncated.', () => {
    assert.equal(frameToToast(approvalFrame, '会话'.repeat(30))?.title, '会话'.repeat(15) + '… · 正在申请权限');
  });
});

describe('frameToToast: Completion notification', () => {
  const done = (text?: string) => ({
    type: 'session/event',
    sessionId: 's1',
    event: { type: 'turn/end', data: { reason: { kind: 'completed' }, text } },
  });

  test('The title is the session name itself, no longer appended with "Conversation Completed"', () => {
    const t = frameToToast(done('改完了'), '修复通知标题');
    assert.equal(t?.title, '修复通知标题');
    assert.equal(t?.body, '改完了');
  });

  test('fallback "Conversation completed" when there is no session name', () => {
    assert.equal(frameToToast(done('改完了'))?.title, '对话完成');
    assert.equal(frameToToast(done('改完了'), '   ')?.title, '对话完成');
  });

  test('The text is still truncated at character 80, and the title and text do not affect each other.', () => {
    const long = 'x'.repeat(MAX_BODY + 10);
    const t = frameToToast(done(long), 'a'.repeat(100));
    assert.equal(t?.body, 'x'.repeat(MAX_BODY) + '…');
    assert.equal(t?.title, 'a'.repeat(30) + '…');
  });
});

describe('frameToToast: Other events carry session names', () => {
  test('error is "Session name·Generation failed", the text is still an error message', () => {
    const frame = {
      type: 'session/event',
      sessionId: 's1',
      event: { type: 'turn/end', data: { reason: { kind: 'error', error: { message: '连接超时' } } } },
    };
    const t = frameToToast(frame, '跑测试');
    assert.equal(t?.title, '跑测试 · 生成失败');
    assert.equal(t?.body, '连接超时');
    assert.equal(frameToToast(frame)?.title, '生成失败');
  });

  test('max-tokens / Approval / Question the same prefix session name', () => {
    const maxTokens = { type: 'session/event', event: { type: 'turn/end', data: { reason: { kind: 'max-tokens' } } } };
    assert.equal(frameToToast(maxTokens, '长文档')?.title, '长文档 · 输出被截断');
    assert.equal(frameToToast(approvalFrame, '部署')?.title, '部署 · 正在申请权限');

    const question = { type: 'question/requested', sessionId: 's1', questions: [{ question: '选哪个？' }] };
    assert.equal(frameToToast(question, '选型')?.title, '选型 · 模型在等你回答');
    assert.equal(frameToToast(question)?.title, '模型在等你回答');
  });

  test('host/agent-error has no session dimension and the title remains "Generation failed"', () => {
    const t = frameToToast({ type: 'host/agent-error', message: '进程崩了' }, '任何名字');
    assert.equal(t?.title, '生成失败');
    assert.equal(t?.body, '进程崩了');
  });
});

describe('frameToToast: branch that is not played', () => {
  test('aborted / interrupted / Unknown type returns null', () => {
    for (const kind of ['aborted', 'interrupted']) {
      const frame = { type: 'session/event', event: { type: 'turn/end', data: { reason: { kind } } } };
      assert.equal(frameToToast(frame, '这条也不该弹'), null);
    }
    assert.equal(frameToToast({ type: 'unknown/frame' }, '同样'), null);
  });
});
