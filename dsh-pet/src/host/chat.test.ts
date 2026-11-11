/**
 * Dialog mark parsing unit test - verify the selection rules of "model image selection/action selection":
 * - in the hit pool → adopt and strip the markup from the text (the markup must not remain in the user-visible text);
 * - Name outside the pool (model illusion) → no pictures and keep the text as it is (reply will never be lost due to
 * parsing failure);
 * - Only the mark is returned and the text is not returned → It is regarded as unselected (otherwise the bubble will
 * be empty).
 *
 * Both analytical functions are pure functions and have no LLM dependencies (picture selection is in memes.ts, action
 * selection is in chat-action.ts), so this test only import them - to avoid pulling up the @deepseek-ai/dsh-llm
 * dependency chain of chat.ts.
 *
 * Running method: node --experimental-strip-types --test src/host/chat.test.ts
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { extractChatAction } from './chat-action.ts';
import { extractChatImage, memeCatalog, type MemeEntry } from './memes.ts';

const POOL: MemeEntry[] = [
  { name: '可爱', desc: '卖萌立绘' },
  { name: '死掉了', desc: '累瘫阵亡' },
  { name: '就一碗', desc: '蹭饭大碗' },
];

describe('extractChatImage - Adoption and stripping of model selections', () => {
  test('Hit pool → keep text, return image name, strip mark', () => {
    const r = extractChatImage('今天好累啊，我先瘫了\n[图:死掉了]', POOL);
    assert.equal(r.text, '今天好累啊，我先瘫了');
    assert.equal(r.image, '死掉了');
  });

  test('Marks can also be stripped if they are in line with the text (the model does not always wrap)', () => {
    const r = extractChatImage('来我家吃饭吧就一碗 [图:就一碗]', POOL);
    assert.equal(r.text, '来我家吃饭吧就一碗');
    assert.equal(r.image, '就一碗');
  });

  test('Unmarked → Return as is without pictures (dialogue pictures are optional embellishments)', () => {
    const r = extractChatImage('嗯嗯，我明白了', POOL);
    assert.equal(r.text, '嗯嗯，我明白了');
    assert.equal(r.image, undefined);
  });

  test('Name outside the pool (model illusion) → No pictures, and the text remains as it is (including tags and does not swallow the text)', () => {
    const raw = '哈哈好的\n[图:不存在的表情包]';
    const r = extractChatImage(raw, POOL);
    assert.equal(r.image, undefined);
    assert.equal(r.text, raw); // No stripping: Since it has not been adopted, the original text will not be touched.
  });

  test('Only reply with mark and no text → regarded as unselected (to prevent the bubble from emptying)', () => {
    const r = extractChatImage('[图:可爱]', POOL);
    assert.equal(r.image, undefined);
    assert.equal(r.text, '[图:可爱]');
  });

  test('Full-width colon / extra white space / spaces before and after the name are recognized', () => {
    assert.equal(extractChatImage('好的\n[图：可爱]', POOL).image, '可爱');
    assert.equal(extractChatImage('好的\n[图:  死掉了  ]', POOL).image, '死掉了');
  });

  test('Empty pool → No graph can be parsed (the actual path when the switch is turned off)', () => {
    const r = extractChatImage('好的\n[图:可爱]', []);
    assert.equal(r.image, undefined);
    assert.equal(r.text, '好的\n[图:可爱]');
  });

  test('Marks in the middle (not at the end) will not be recognized - only the end will be recognized to avoid accidentally damaging the square brackets in the text.', () => {
    const raw = '[图:可爱] 然后呢？';
    const r = extractChatImage(raw, POOL);
    assert.equal(r.image, undefined);
    assert.equal(r.text, raw);
  });
});

describe('memeCatalog - Candidate list for models to see', () => {
  test('One line per line: name + colon + description, for model selection based on context', () => {
    const cat = memeCatalog(POOL);
    assert.ok(cat.includes('- 可爱：卖萌立绘'));
    assert.ok(cat.includes('- 死掉了：累瘫阵亡'));
    assert.ok(cat.includes('- 就一碗：蹭饭大碗'));
    assert.equal(cat.split('\n').length, POOL.length);
  });
});

describe('Coexistence of graphics and action markers - peeling sequence when both switches are turned on at the same time', () => {
  const NAMES = ['优雅女仆舞', '原地小憩沉眠'];

  test('Two markers appear at the same time: take one of each, leaving only the text in the text', () => {
    const acted = extractChatAction('好呀～看我转一圈！\n[动作:优雅女仆舞]\n[图:可爱]', NAMES);
    const picked = extractChatImage(acted.text, POOL);
    assert.equal(acted.action, '优雅女仆舞');
    assert.equal(picked.image, '可爱');
    assert.equal(picked.text, '好呀～看我转一圈！');
  });

  test('The order is reversed (picture in front, action in the back) and the skin will be peeled off as well.', () => {
    const acted = extractChatAction('好呀\n[图:可爱]\n[动作:原地小憩沉眠]', NAMES);
    const picked = extractChatImage(acted.text, POOL);
    assert.equal(acted.action, '原地小憩沉眠');
    assert.equal(picked.image, '可爱');
    assert.equal(picked.text, '好呀');
  });

  test('write-only action: keep the image parsing as it is, do not add images out of thin air', () => {
    const acted = extractChatAction('嗯嗯\n[动作:优雅女仆舞]', NAMES);
    const picked = extractChatImage(acted.text, POOL);
    assert.equal(acted.action, '优雅女仆舞');
    assert.equal(picked.image, undefined);
    assert.equal(picked.text, '嗯嗯');
  });

  test('write-only diagram: Action analysis is not adopted (actual path when the action switch is turned off)', () => {
    const acted = extractChatAction('嗯嗯\n[图:可爱]', []);
    const picked = extractChatImage(acted.text, POOL);
    assert.equal(acted.action, undefined);
    assert.equal(picked.image, '可爱');
    assert.equal(picked.text, '嗯嗯');
  });

  test('The action name is invalid, and the picture name is also invalid: the action mark is peeled off, and the picture mark is retained as it is according to the picture matching rules.', () => {
    const acted = extractChatAction('嗯\n[动作:自创动作]\n[图:池外图]', NAMES);
    const picked = extractChatImage(acted.text, POOL);
    assert.equal(acted.action, undefined);
    assert.equal(picked.image, undefined);
    assert.equal(picked.text, '嗯\n[图:池外图]');
  });
});
