/**
 * Translation of standalone mode settings page: key search, placeholder replacement, missing parameter fallback empty
 * string.
 *
 * Running method: node --experimental-strip-types --test src/standalone/settings-page/translate.test.ts
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { createTranslator } from './translate.ts';

/** Minimal dictionary containing only keys for testing, does not rely on the complete key set of the panel. */
const dict = {
  greeting: '你好，{name}',
  pair: '{pets} 只宠物，{messages} 条消息',
  plain: '纯文本',
};

describe('createTranslator —— Independent page text translation', () => {
  test('Without parameters → return the dictionary text as is', () => {
    const t = createTranslator(dict);
    assert.equal(t('plain'), '纯文本');
  });

  test('With parameters → Replace all `{name}` placeholders', () => {
    const t = createTranslator(dict);
    assert.equal(t('pair', { pets: 2, messages: 7 }), '2 只宠物，7 条消息');
  });

  test('Missing parameter → replace the placeholder with an empty string, leaving no original text', () => {
    const t = createTranslator(dict);
    assert.equal(t('greeting', {}), '你好，');
  });
});
