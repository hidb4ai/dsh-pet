/**
 * Pure logic test of dialogue action linkage: list range, text of prompt words, and analysis of reply tags.
 *
 * Three contracts:
 * 1. The list only takes `animations.categories` , and standby/turn/drag/click/move/event animations will not be
 * entered;
 * 2. The instructions and pictures must be in the same sentence pattern (optional, select according to context, do not
 * write if there is no suitable one), and list each name;
 * 3. Parse and strip off all action tags (including invalid names), and only adopt the first one in the whitelist.
 *
 * Use Node to build test runner (node:test) without introducing any npm dependencies.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { actionInstruction, chatActionNames, extractChatAction } from './chat-action.ts';

/** Minimum animation configuration with the same shape as assets/config.jsonc: In addition to categories, there are various pools that should not be included in the list */
const ANIMATIONS = {
  idle: ['待机呼吸休闲'],
  turn: ['东张西望'],
  drag: ['被鼠标拖拽悬空反馈'],
  clicks: ['点击回应-开心跃动', '点击回应-害羞惊讶'],
  moves: {
    default: { minDist: 60, maxDist: 240 },
    actions: [{ name: '原地漂浮踏步' }, { name: '螃蟹走路' }],
  },
  categories: [
    { id: '玩魔方', actions: ['原地专心玩魔方'] },
    { id: '文字类', noMirror: true, actions: ['举牌文字'] },
  ],
  events: {
    balance: ['看钱包'],
    whisper: ['深度思考碎碎念'],
    workStatus: [['档位0-A', '档位0-B'], '档位1'],
  },
};

describe('chatActionNames——Dialogue linkage action range (only categories)', () => {
  test('Take all actions under categories, deduplicate and keep the configuration order', () => {
    const names = chatActionNames({
      idle: ['待机'],
      categories: [
        { id: 'A', actions: ['甲', '乙'] },
        { id: 'B', actions: ['乙', '丙'] },
      ],
      events: { whisper: ['碎碎念'] },
    });
    assert.deepEqual(names, ['甲', '乙', '丙']);
  });

  test('Does not include standby/turn/drag/click/move/event animation', () => {
    const names = chatActionNames(ANIMATIONS);
    for (const excluded of [
      '待机呼吸休闲',
      '东张西望',
      '被鼠标拖拽悬空反馈',
      '点击回应-开心跃动',
      '原地漂浮踏步',
      '看钱包',
      '深度思考碎碎念',
    ]) {
      assert.equal(names.includes(excluded), false, excluded + ' 不应进入对话动作范围');
    }
    assert.deepEqual(names, ['原地专心玩魔方', '举牌文字']);
  });

  test('Invalid input → empty list (no error thrown, actual path when the switch is turned off)', () => {
    for (const bad of [
      undefined,
      null,
      'x',
      42,
      {},
      { categories: 'oops' },
      { categories: [null, 1, { actions: 'x' }] },
    ]) {
      assert.deepEqual(chatActionNames(bad), []);
    }
  });
});

describe('actionInstruction——Inject the action command of user text', () => {
  test('The same sentence pattern as the picture: optional, choose according to context, do not write if there is no suitable one', () => {
    const text = actionInstruction(['优雅女仆舞']);
    assert.ok(text.includes('[动作]'), 'Must have [Action] section');
    assert.ok(text.includes('挑最贴合当前语境的'), 'Select based on context, not random selection');
    assert.ok(text.includes('没有合适的就完全不要写这个标记'), 'No forced selection');
  });

  test('Each name occupies its own line (same as the picture list)', () => {
    const names = ['优雅女仆舞', '原地小憩沉眠'];
    const text = actionInstruction(names);
    for (const name of names) assert.ok(text.includes('- ' + name), '清单里缺 ' + name);
    assert.equal(text.split('\n').filter((line) => line.startsWith('- ')).length, names.length);
  });

  test('The tag format is consistent with parsing: start a new line and write [action: name]', () => {
    const text = actionInstruction(['优雅女仆舞']);
    assert.ok(text.includes('[动作:名称]'));
    assert.ok(text.includes('名称原样照抄'));
  });
});

describe('extractChatAction - Adoption and stripping of action markers', () => {
  const NAMES = ['优雅女仆舞', '原地小憩沉眠', '轻快摇摆舞'];

  test('Hit → peel off mark, return action name', () => {
    const r = extractChatAction('好呀～看我转一圈！\n[动作:轻快摇摆舞]', NAMES);
    assert.equal(r.text, '好呀～看我转一圈！');
    assert.equal(r.action, '轻快摇摆舞');
  });

  test('Full-width colons and spaces before and after the name can be recognized', () => {
    assert.equal(extractChatAction('好的\n[动作：优雅女仆舞]', NAMES).action, '优雅女仆舞');
    assert.equal(extractChatAction('好的\n[动作:  原地小憩沉眠  ]', NAMES).action, '原地小憩沉眠');
  });

  test('The name is not in the whitelist → strip the mark but do not adopt it (do not expose the mark to the user)', () => {
    const r = extractChatAction('好的\n[动作:自创动作]', NAMES);
    assert.equal(r.action, undefined);
    assert.equal(r.text, '好的');
  });

  test('Multiple tags → Only the first one in the whitelist is adopted, and the rest are stripped', () => {
    const r = extractChatAction('嗯\n[动作:不存在]\n[动作:优雅女仆舞]\n[动作:轻快摇摆舞]', NAMES);
    assert.equal(r.action, '优雅女仆舞');
    assert.equal(r.text.includes('[动作'), false);
  });

  test('No mark → return as is (the text is unchanged)', () => {
    const r = extractChatAction('嗯嗯，我明白了', NAMES);
    assert.equal(r.text, '嗯嗯，我明白了');
    assert.equal(r.action, undefined);
  });

  test('write-only tag has no body → text is empty (caller does not pop bubble accordingly)', () => {
    const r = extractChatAction('[动作:优雅女仆舞]', NAMES);
    assert.equal(r.text, '');
    assert.equal(r.action, '优雅女仆舞');
  });

  test('Empty list → marked for stripping but not adopted (path when switch is off)', () => {
    const r = extractChatAction('好的\n[动作:优雅女仆舞]', []);
    assert.equal(r.action, undefined);
    assert.equal(r.text, '好的');
  });
});
