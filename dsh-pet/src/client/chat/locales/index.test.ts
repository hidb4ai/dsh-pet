/**
 * Contract test of dialog panel dictionary: 8 language key sets are consistent, each item is non-empty, and English
 * fallback benchmark exists.
 *
 * Only nail the structure, not the specific copy - the translation wording will change, but the key set and
 * completeness will not. Running method: node --experimental-strip-types --test
 * src/client/chat/locales/index.test.ts
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { dicts, NS, zh } from './index.ts';

describe('Dialog Panel Dictionary - Keysets and Integrity', () => {
  test('The namespace is fixed to pet.chat', () => {
    assert.equal(NS, 'pet.chat');
  });

  test('Complete in 8 languages: zh / en / ja / es / fr / de / ru / pt', () => {
    assert.deepEqual(Object.keys(dicts), ['zh', 'en', 'ja', 'es', 'fr', 'de', 'ru', 'pt']);
  });

  test('The key set of each language is exactly the same as zh → missing or redundant keys will be found', () => {
    const baseline = Object.keys(zh).sort();
    for (const [id, dict] of Object.entries(dicts)) {
      assert.deepEqual(Object.keys(dict).sort(), baseline, `The key set of ${id} should be consistent with zh`);
    }
  });

  test('Each copy is a non-empty character string → no empty placeholder is left', () => {
    for (const [id, dict] of Object.entries(dicts)) {
      for (const [key, value] of Object.entries(dict)) {
        assert.equal(typeof value, 'string', `${id} . ${key} should be a character string`);
        assert.notEqual(value.trim(), '', `${id} . ${key} should not be empty`);
      }
    }
  });

  test('Placeholders are not overwritten by translation → Parameter keys keep the same name in 8 languages', () => {
    const placeholders = (value: string): string[] => (value.match(/\{[a-zA-Z]+\}/g) ?? []).sort();
    for (const [key, value] of Object.entries(zh)) {
      const expected = placeholders(value);
      for (const [id, dict] of Object.entries(dicts)) {
        assert.deepEqual(
          placeholders(dict[key as keyof typeof dict]),
          expected,
          `${id} . The placeholder for ${key} should be consistent with zh`,
        );
      }
    }
  });
});
