/**
 * Contract test setting page dictionary (src/client/settings/locales/).
 *
 * Three contracts: The key set of each language is exactly the same as zh (more keys and fewer keys will report an
 * error in the type period, and the runtime is used again); `{n}` / `{id}` / `{profile}` This type of interpolation
 * placeholder must correspond to Chinese one-to-one, otherwise UI will directly print out the original placeholder
 * after translation; Latin / There must be no Chinese characters left in the Cyrillic alphabet language (trace of
 * missing translation), and no blank values are allowed (empty tags are just invisible holes in the settings page).
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { dicts, zh } from './index.ts';

const placeholders = (text: string): string[] => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

// Only search the Chinese characters themselves: The presence of full-width quotation marks such as "" in non-Chinese
// text is a typesetting habit, and the presence of Chinese characters is a missed translation. Chinese
// characters themselves do not determine missed translations: Japanese is written in Chinese characters, and only
// Latin/Cyrillic alphabet languages use it as a missed translation signal.
const cjk = /[\u4e00-\u9fff]/;

/** Languages that allow Chinese characters to appear: Chinese, and Japanese. */
const HAN_LANGUAGES = new Set(['zh', 'ja']);

/** Language id and its dictionary; `Record<Key, string>` has been guaranteed by the type, here it is traversed according to the same shape. */
const pairs = Object.entries(dicts) as Array<[string, Record<keyof typeof zh, string>]>;

describe('Setting page dictionary', () => {
  test("Each language's key set is consistent with zh", () => {
    const zhKeys = Object.keys(zh).sort();
    for (const [language, dict] of pairs) {
      assert.deepEqual(Object.keys(dict).sort(), zhKeys, `The key set of ${language} is inconsistent with zh`);
    }
  });

  test('Interpolation placeholders are consistent: the set of placeholders for each key is the same as in Chinese', () => {
    for (const [language, dict] of pairs) {
      for (const key of Object.keys(zh) as Array<keyof typeof zh>) {
        assert.deepEqual(
          placeholders(dict[key]),
          placeholders(zh[key]),
          `${language}. The placeholder of ${key} is inconsistent with Chinese: the interpolation will fail and the original placeholder will be printed in UI`,
        );
      }
    }
  });

  test('Copy available: None are blank, there are no Chinese characters in Latin/Cyrillic languages', () => {
    for (const [language, dict] of pairs) {
      for (const [key, value] of Object.entries(dict)) {
        assert.ok(value.trim().length > 0, `${language} . ${key} is blank`);
        if (HAN_LANGUAGES.has(language)) continue;
        assert.ok(
          !cjk.test(value),
          `${language} . ${key} There is still Chinese that has not been translated: ${value}`,
        );
      }
    }
  });
});
