/**
 * "Model fallback" test on the generation side - verify the actual behavior of the A scheme (issue #75): whisperModel
 * / chatModel of the entry configuration takes precedence; it fails to call fallback (the credentials are deleted /
 * the model is removed / the service provider is not equipped with key) Go to the current dialogue model and try
 * again; if it still fails, throw out the reason for the last failure (the current dialogue model).
 *
 * Use the fake ctx.llm.stream driver (not touching the real service provider, not connected to the Internet): Press
 * provider to decide whether to throw an error, return an empty stream or normal text this time, and record the
 * provider/model for each call - the order and number of fallbacks are the invariants to be nailed in this document.
 *
 * In addition, the verify call shape: each call has the calling identity sessionId; the real reason for "not getting
 * the text" is reported in the stream termination block.
 *
 * Running method: node --experimental-strip-types --test src/host/model-fallback.test.ts
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { generateWhisper } from './whisper.ts';
import { generateChat } from './chat.ts';
import { PET_CALL_IDENTITY } from './llm-call.ts';
import type { ModelRef } from './model-selection.ts';

/** Behavior of a call: ok = normal text output; throw = error thrown in the stream; empty = empty stream with no termination block; fail = stream terminated with error and no text */
type Behavior = 'ok' | 'throw' | 'empty' | 'fail';

const CONFIGURED: ModelRef = { provider: 'configured', model: 'cheap-model' };
const CURRENT: ModelRef = { provider: 'current', model: 'main-model' };

/** Make a fake ctx: currentSelection returns current (' throw ' = throw an error), llm.stream behaves according to provider */
function fakeCtx(current: ModelRef | 'throw', behavior: Record<string, Behavior>) {
  const calls: ModelRef[] = [];
  /** Complete parameters for each call (including sessionId) */
  const options: Record<string, unknown>[] = [];
  const ctx = {
    agentDefaultModel: {
      currentSelection: (): ModelRef => {
        if (current === 'throw') throw new Error('当前对话未配置模型');
        return current;
      },
    },
    llm: {
      // Claim "No reasoning metadata": supportsReasoningOff returns false without appending reasoningEffort
      resolveModelInfo: async () => ({}),
      stream: (o: ModelRef) => {
        calls.push({ provider: o.provider, model: o.model });
        options.push(o as unknown as Record<string, unknown>);
        const b = behavior[o.provider] ?? 'throw';
        return (async function* () {
          if (b === 'throw') throw new Error(o.provider + ' 不可用');
          if (b === 'empty') return;
          if (b === 'fail') {
            yield {
              type: 'finish',
              reason: {
                kind: 'error',
                failure: { message: o.provider + ' 400：缺少必需的路由头', code: 'HTTP_400' },
              },
            };
            return;
          }
          yield { type: 'text-delta', index: 0, text: '你好呀' };
        })();
      },
    },
  };
  return { ctx, calls, options };
}

describe('generateWhisper - Configuration model priority, failure fallback current conversation', () => {
  test('The configured model is available → only adjust it once, without touching the model of the current conversation', async () => {
    const { ctx, calls } = fakeCtx(CURRENT, { configured: 'ok', current: 'ok' });
    const r = await generateWhisper(ctx, { system: '人设', preferred: CONFIGURED });
    assert.deepEqual(r, { ok: true, text: '你好呀' });
    assert.deepEqual(
      calls,
      [CONFIGURED],
      'The model of the current conversation must not be adjusted when the configuration is available.',
    );
  });

  test('The configured model throws an error → fallback to the model of the current conversation and try again', async () => {
    const { ctx, calls } = fakeCtx(CURRENT, { configured: 'throw', current: 'ok' });
    const r = await generateWhisper(ctx, { system: '人设', preferred: CONFIGURED });
    assert.deepEqual(r, { ok: true, text: '你好呀' }, 'normal text should be returned if fallback is successful');
    assert.deepEqual(calls, [CONFIGURED, CURRENT], 'The order must be "configured → current conversation"');
  });

  test('The configured model returns an empty stream (the model does not return text) → the same fallback', async () => {
    const { ctx, calls } = fakeCtx(CURRENT, { configured: 'empty', current: 'ok' });
    const r = await generateWhisper(ctx, { system: '人设', preferred: CONFIGURED });
    assert.deepEqual(r, { ok: true, text: '你好呀' });
    assert.deepEqual(calls, [CONFIGURED, CURRENT]);
  });

  test('Both failed → Return the reason for the last (current dialogue model) failure', async () => {
    const { ctx, calls } = fakeCtx(CURRENT, { configured: 'throw', current: 'throw' });
    const r = await generateWhisper(ctx, { system: '人设', preferred: CONFIGURED });
    assert.equal(r.ok, false);
    assert.equal(r.ok === false && r.reason, 'generate-error');
    assert.equal(
      r.ok === false && r.message,
      'current 不可用',
      'The error should come from the model of the current conversation (the one the user is actually using)',
    );
    assert.deepEqual(calls, [CONFIGURED, CURRENT]);
  });

  test('No model assigned (leave blank) → only adjust the model of the current conversation once (the old behavior remains unchanged verbatim)', async () => {
    const { ctx, calls } = fakeCtx(CURRENT, { current: 'ok' });
    const r = await generateWhisper(ctx, { system: '人设' });
    assert.deepEqual(r, { ok: true, text: '你好呀' });
    assert.deepEqual(calls, [CURRENT]);
  });

  test('Neither side can get the model → provider-missing, and LLM is not called once', async () => {
    const { ctx, calls } = fakeCtx('throw', {});
    const r = await generateWhisper(ctx, { system: '人设' });
    assert.deepEqual(r, { ok: false, reason: 'provider-missing', message: '当前对话未配置模型' });
    assert.deepEqual(calls, []);
  });

  test('The configured model is the same as the current conversation → deduplicate, only try once on failure', async () => {
    const { ctx, calls } = fakeCtx(CONFIGURED, { configured: 'throw' });
    const r = await generateWhisper(ctx, { system: '人设', preferred: CONFIGURED });
    assert.equal(r.ok, false);
    assert.deepEqual(calls, [CONFIGURED], 'The same model cannot be tried twice (waiting for a timeout in vain)');
  });
});

describe('generateChat - the same set of fallback rules (chatModel)', () => {
  test('The configured model throws an error → fallback to the model of the current conversation', async () => {
    const { ctx, calls } = fakeCtx(CURRENT, { configured: 'throw', current: 'ok' });
    const r = await generateChat({
      ctx,
      system: '人设',
      history: [],
      userText: '在吗',
      pool: [],
      preferred: CONFIGURED,
    });
    assert.deepEqual(r, { ok: true, text: '你好呀' });
    assert.deepEqual(calls, [CONFIGURED, CURRENT]);
  });

  test('Leave blank → only use the model of the current conversation (old behavior)', async () => {
    const { ctx, calls } = fakeCtx(CURRENT, { current: 'ok' });
    const r = await generateChat({
      ctx,
      system: '人设',
      history: [],
      userText: '在吗',
      pool: [],
      preferred: undefined,
    });
    assert.deepEqual(r, { ok: true, text: '你好呀' });
    assert.deepEqual(calls, [CURRENT]);
  });

  test('Neither side can get the model → provider-missing, and LLM is not called once', async () => {
    const { ctx, calls } = fakeCtx('throw', {});
    const r = await generateChat({
      ctx,
      system: '人设',
      history: [],
      userText: '在吗',
      pool: [],
      preferred: undefined,
    });
    assert.deepEqual(r, { ok: false, reason: 'provider-missing', message: '当前对话未配置模型' });
    assert.deepEqual(calls, []);
  });
});

describe('Call shape - calling identity and real failure reason', () => {
  test('Dialog call with calling identity sessionId', async () => {
    const { ctx, options } = fakeCtx(CURRENT, { current: 'ok' });
    await generateChat({ ctx, system: '人设', history: [], userText: '在吗', pool: [], preferred: undefined });
    assert.equal(options.length, 1);
    assert.equal(options[0].sessionId, PET_CALL_IDENTITY);
  });

  test('Whisper is called with the same identity, but fallback does not change the value twice.', async () => {
    const { ctx, options } = fakeCtx(CURRENT, { configured: 'empty', current: 'ok' });
    await generateWhisper(ctx, { system: '人设', preferred: CONFIGURED });
    assert.deepEqual(
      options.map((o) => o.sessionId),
      [PET_CALL_IDENTITY, PET_CALL_IDENTITY],
      'Fallback must use the same identity twice',
    );
  });

  test('The stream terminates with error and has no text → report the real reason in the termination block', async () => {
    const { ctx } = fakeCtx(CURRENT, { current: 'fail' });
    const r = await generateChat({
      ctx,
      system: '人设',
      history: [],
      userText: '在吗',
      pool: [],
      preferred: undefined,
    });
    assert.equal(r.ok, false);
    assert.equal(r.ok === false && r.message, 'current 400：缺少必需的路由头');
  });

  test('Empty stream with no terminating block → still "Model did not return text" (old behavior unchanged verbatim)', async () => {
    const { ctx } = fakeCtx(CURRENT, { configured: 'empty', current: 'empty' });
    const r = await generateChat({
      ctx,
      system: '人设',
      history: [],
      userText: '在吗',
      pool: [],
      preferred: CONFIGURED,
    });
    assert.equal(r.ok === false && r.message, '模型未返回文本');
  });
});
