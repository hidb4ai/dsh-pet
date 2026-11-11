/**
 * Model candidate chain unit test - verify "The model of the entry configuration takes precedence, and if it fails,
 * the model of the current conversation" The construction rules of this chain:
 * - whisperModel / chatModel leave blank (built-in default) → only the model of the current dialogue is on the chain
 * (no other candidates are added);
 * - Filled → The configured model is in the front and the model of the current dialogue is in the back (the generation
 * side tries in order, and the latter will be used to try again if the former fails);
 * - The two sources are the same choice → deduplicate only leaves one (otherwise if it fails, it will try again with
 * the same model and wait for a timeout in vain);
 * - There is no model configured in the current conversation → only the configured one is left; neither side can get
 * it → Empty link (generates a side response "The model is not configured in the current conversation").
 *
 * This module does not import @deepseek-ai/dsh-llm (pure logic), so it can be run directly in node:test - the same
 * reason that chat.test.ts only tests memes.ts.
 *
 * Running method: node --experimental-strip-types --test src/host/model-selection.test.ts
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { configuredModel, currentModel, modelCandidates, modelLabel, type ModelRef } from './model-selection.ts';

/** Create a host ctx: currentSelection returns the given selection (undefined = not configured, 'throw' = throws an error) */
function ctxOf(sel: ModelRef | undefined | 'throw'): { agentDefaultModel: { currentSelection(): ModelRef } } {
  return {
    agentDefaultModel: {
      currentSelection: () => {
        if (sel === 'throw') throw new Error('当前对话未配置模型');
        return sel as unknown as ModelRef;
      },
    },
  };
}

describe('configuredModel - whisperModel / chatModel in the entry configuration', () => {
  test('Both fields are not empty → this selection', () => {
    assert.deepEqual(
      configuredModel({ whisperModel: { provider: 'deepseek', model: 'deepseek-chat' } }, 'whisperModel'),
      {
        provider: 'deepseek',
        model: 'deepseek-chat',
      },
    );
  });

  test('Leave both blank (built-in default) → undefined (= follow current conversation)', () => {
    assert.equal(configuredModel({ whisperModel: { provider: '', model: '' } }, 'whisperModel'), undefined);
  });

  test('Only half filled in / Wrong structure → undefined (The combiner has been blocked, defend again here)', () => {
    const bad: unknown[] = [
      { provider: 'deepseek', model: '' },
      { provider: '', model: 'deepseek-chat' },
      { provider: 'deepseek' },
      'deepseek/deepseek-chat',
      ['deepseek', 'deepseek-chat'],
      null,
    ];
    for (const value of bad) {
      assert.equal(
        configuredModel({ chatModel: value }, 'chatModel'),
        undefined,
        `${JSON.stringify(value)} should be treated as unspecified`,
      );
    }
    assert.equal(configuredModel({}, 'chatModel'), undefined, 'Missing entire fields are also considered unspecified');
    assert.equal(
      configuredModel(undefined, 'chatModel'),
      undefined,
      'No error must be thrown when an entry is missing',
    );
  });

  test('The blank spaces on both sides are trim (when writing the configuration, swiping more spaces with your hand does not count as another model)', () => {
    assert.deepEqual(
      configuredModel({ chatModel: { provider: ' deepseek ', model: ' deepseek-chat ' } }, 'chatModel'),
      {
        provider: 'deepseek',
        model: 'deepseek-chat',
      },
    );
  });

  test('The two keys do not communicate with each other: whisperModel does not read chatModel', () => {
    const conf = { whisperModel: { provider: 'a', model: 'a1' }, chatModel: { provider: 'b', model: 'b1' } };
    assert.equal(configuredModel(conf, 'whisperModel')?.provider, 'a');
    assert.equal(configuredModel(conf, 'chatModel')?.provider, 'b');
  });
});

describe('currentModel - the model of the current conversation', () => {
  test('There is a choice → Return as is', () => {
    assert.deepEqual(currentModel(ctxOf({ provider: 'deepseek', model: 'deepseek-reasoner' })), {
      provider: 'deepseek',
      model: 'deepseek-reasoner',
    });
  });

  test('Not configured/throw error/ctx is incomplete → undefined (never throw upward)', () => {
    assert.equal(currentModel(ctxOf(undefined)), undefined);
    assert.equal(currentModel(ctxOf('throw')), undefined);
    assert.equal(currentModel({}), undefined);
  });
});

describe('modelCandidates - candidate chain (configuration priority → current conversation fallback)', () => {
  const configured: ModelRef = { provider: 'deepseek', model: 'deepseek-chat' };
  const current: ModelRef = { provider: 'opencode', model: 'big-model' };

  test('Leave the configuration blank → only the model of the current conversation is on the chain (the old behavior remains unchanged verbatim)', () => {
    assert.deepEqual(modelCandidates(ctxOf(current), undefined), [current]);
  });

  test('Configured → The configured one comes first and the current conversation comes last (fallback retry)', () => {
    assert.deepEqual(modelCandidates(ctxOf(current), configured), [configured, current]);
  });

  test('The two sources are the same → deduplicate (if you don’t try it again with the same model)', () => {
    assert.deepEqual(modelCandidates(ctxOf(configured), configured), [configured]);
  });

  test('There is no model configured in the current conversation → only the configured one is left', () => {
    assert.deepEqual(modelCandidates(ctxOf(undefined), configured), [configured]);
  });

  test('Neither side can get it → Empty link (the generation side will reply "No model is configured in the current dialogue" accordingly)', () => {
    assert.deepEqual(modelCandidates(ctxOf(undefined), undefined), []);
  });
});

describe('modelLabel - Error/log label', () => {
  test('provider/model', () => {
    assert.equal(modelLabel({ provider: 'deepseek', model: 'deepseek-chat' }), 'deepseek/deepseek-chat');
  });
});
