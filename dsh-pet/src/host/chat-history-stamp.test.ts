/**
 * Time prefix test for conversation history (issue #261) - verify the actual messages shape sent to the model:
 * - user historical message exceeds the 30-minute threshold → the text is preceded by `[月日 时:分]` ;
 * - assistant historical information is not included: the model will copy the format on its own side, and the prefix
 * is only marked on user;
 * - Not included within the threshold (continuous chatting); user input in this round will never be included.
 *
 * Use fake ctx.llm.stream to block the complete request parameters (not connected to the Internet), and the assertion
 * is the real payload instead of the return value of the formatting function. Running method: node --
 * experimental-strip-types --test src/host/chat-history-stamp.test.ts
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { generateChat } from './chat.ts';

const PROVIDER = { provider: 'current', model: 'main-model' };

/** Create a fake ctx and record the complete parameters of each stream into options. */
function fakeCtx() {
  const options: Record<string, unknown>[] = [];
  const ctx = {
    agentDefaultModel: { currentSelection: () => PROVIDER },
    llm: {
      resolveModelInfo: async () => ({}),
      stream: (o: unknown) => {
        options.push(o as Record<string, unknown>);
        return (async function* () {
          yield { type: 'text-delta', index: 0, text: '好呀' };
        })();
      },
    },
  };
  return { ctx, options };
}

/** Get the plain text of the index message (this test only cares about the first text block). */
function textOf(sent: Record<string, unknown>, index: number): string {
  const messages = sent.messages as { content: { type: string; text?: string }[] }[];
  return messages[index].content[0].text ?? '';
}

/** A conversation: history is passed in as it is, and the first stream parameter actually sent to the model is returned. */
async function send(
  history: { role: 'user' | 'assistant'; content: string; ts: number }[],
): Promise<Record<string, unknown>> {
  const { ctx, options } = fakeCtx();
  const result = await generateChat({ ctx, system: '人设', history, userText: '鲸鲸，你今天干了什么？' });
  assert.equal(result.ok, true, 'The generation should be successful, otherwise it means false ctx is not connected.');
  return options[0];
}

describe('generateChat - time prefix of historical messages', () => {
  test('user message two days apart → with [month, day, hour:minute] prefix', async () => {
    const oldTs = Date.now() - 50 * 60 * 60 * 1000;
    const sent = await send([
      { role: 'user', content: '睡觉了鲸鲸，午安', ts: oldTs },
      { role: 'assistant', content: '晚安～做个好梦', ts: oldTs },
    ]);
    assert.match(textOf(sent, 0), /^\[\d{1,2}月\d{1,2}日 \d{2}:\d{2}\] 睡觉了鲸鲸，午安$/);
  });

  test('assistant historical messages do not have a prefix (the model will copy its own format)', async () => {
    const oldTs = Date.now() - 50 * 60 * 60 * 1000;
    const sent = await send([
      { role: 'user', content: '睡觉了鲸鲸，午安', ts: oldTs },
      { role: 'assistant', content: '晚安～做个好梦', ts: oldTs },
    ]);
    assert.equal(textOf(sent, 1), '晚安～做个好梦');
  });

  test('Continuous conversations within threshold (within 30 minutes) → no prefix', async () => {
    const recent = Date.now() - 5 * 60 * 1000;
    const sent = await send([
      { role: 'user', content: '在吗', ts: recent },
      { role: 'assistant', content: '在的', ts: recent },
    ]);
    assert.equal(textOf(sent, 0), '在吗');
    assert.equal(textOf(sent, 1), '在的');
  });

  test('This round of user input will never be prefixed (it is "now", which is explained by [present])', async () => {
    const oldTs = Date.now() - 50 * 60 * 60 * 1000;
    const sent = await send([{ role: 'assistant', content: '晚安', ts: oldTs }]);
    const messages = sent.messages as { content: { text?: string }[] }[];
    assert.equal(textOf(sent, messages.length - 1), '鲸鲸，你今天干了什么？');
  });

  test('History of New Year’s Eve → Prefixed with year', async () => {
    const year = new Date().getFullYear();
    const lastYearTs = new Date(year - 1, 11, 31, 23, 59).getTime();
    const sent = await send([{ role: 'user', content: '新年快乐', ts: lastYearTs }]);
    assert.ok(
      textOf(sent, 0).startsWith(`[${year - 1}年12月31日 23:59] 新年快乐`),
      `Actual: ${JSON.stringify(textOf(sent, 0))}`,
    );
  });
});
