/**
 * Single test of the decision-making layer of the playback request animation (`POST /dsh-pet-7340/anim`).
 *
 * There are two core parts of the contract (issue #122, after Article 1, there are two forms):
 * name = The name must be in the allowed set of the pet (the menu can be clicked on animation ∪ the gameplay has its
 * own animation) - "The name is the file name" on the playback side. Playing non-existent animations will only fail
 * silently (404 → Loading failure → Showed as "no response when clicked"), so this check must be nailed;
 * url = The asset address provided by the third party. The pool is not checked, but it must be the complete URL of
 * http/https. Choose one of the two and it will be determined by this module. This module only relies on configuration
 * and can be completely tested offline.
 *
 * Use Node to build test runner (node:test) without introducing any npm dependencies.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { animationNames, decideAnim } from './anim.ts';

/** Animation configuration with the same shape as assets/config.jsonc: 7 pools covering the menu tree + gameplay pool baifan */
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
    workStatus: [
      ['档位0-A', '档位0-B'], // Array slot: multiple candidates
      '档位1', // Single candidate
    ],
  },
  baifan: ['开心小跑', '侧身急躁跑', '期待开饭', '吃饭·碗饭', '吃饭团'],
};

const cfg = {
  main: {
    animations: ANIMATIONS,
    pets: [
      { id: 'main', name: '蓝毛小女仆' },
      { id: 'test1', name: '测试宠' },
    ],
  },
};

/** Convenient call for decision-making: only cover the parameters of concern this time */
const decide = (over: Partial<Parameters<typeof decideAnim>[0]> = {}) =>
  decideAnim({ cfg, requested: 'main', name: '东张西望', url: undefined, ...over });

describe('animationNames —— Clickable animation in the menu + built-in animation in the gameplay', () => {
  test('All seven pools of the menu have been received (these are what the menu tree takes)', () => {
    const names = animationNames(ANIMATIONS);
    for (const n of [
      '待机呼吸休闲', // idle
      '东张西望', // turn
      '被鼠标拖拽悬空反馈', // drag
      '点击回应-开心跃动', // clicks
      '原地漂浮踏步', // moves.actions[].name
      '原地专心玩魔方', // categories[].actions
      '举牌文字', // noMirror classification is still available playback request
      '看钱包', // events.balance
      '深度思考碎碎念', // events.whisper
      '档位0-A', // events.workStatus array slot flattening
      '档位0-B',
      '档位1',
    ]) {
      assert.ok(names.includes(n), `Missing ${n}`);
    }
  });

  test('The gameplay pool (animations.baifan) is also in the whitelist, ranking behind the menu pool', () => {
    const names = animationNames(ANIMATIONS);
    for (const n of ['开心小跑', '侧身急躁跑', '期待开饭', '吃饭·碗饭', '吃饭团']) {
      assert.ok(names.includes(n), `Missing gameplay animation ${n}`);
    }
    assert.ok(names.indexOf('开心小跑') > names.indexOf('看钱包'), 'The gameplay pool is ranked after the menu pool');
  });

  test('Sequentially align the menu tree: idle → turn → drag → clicks → moves → categories → events', () => {
    assert.deepEqual(animationNames(ANIMATIONS).slice(0, 5), [
      '待机呼吸休闲',
      '东张西望',
      '被鼠标拖拽悬空反馈',
      '点击回应-开心跃动',
      '点击回应-害羞惊讶',
    ]);
  });

  test('deduplicate: The same animation appears in multiple pools only once', () => {
    const dup = { idle: ['A', 'A'], clicks: ['A'], events: { whisper: [['A', 'B']] } };
    assert.deepEqual(animationNames(dup), ['A', 'B']);
  });

  test('If the shape is invalid, the pool will be empty (no throwing)', () => {
    for (const bad of [undefined, null, 42, 'x', [], { idle: 'not-array' }, { moves: { actions: 'x' } }]) {
      assert.deepEqual(animationNames(bad), []);
    }
  });

  test('Filter non-character strings and empty strings (mixing dirty values into the configuration will not make it a valid animation name)', () => {
    const dirty = { idle: ['A', '', null, 3, undefined, 'B'] };
    assert.deepEqual(animationNames(dirty), ['A', 'B']);
  });
});

describe('decideAnim - Name verification', () => {
  test('empty / pure blank / non-character string → bad-request', () => {
    for (const name of ['', '   ', undefined, null, 42, {}]) {
      const d = decide({ name });
      assert.equal(d.ok, false);
      assert.equal(d.ok === false && d.reason, 'bad-request');
    }
  });

  test('Blank space before and after the name → trim followed by judgment and passed', () => {
    const d = decide({ name: '  东张西望  ' });
    assert.equal(d.ok, true);
    assert.equal(d.ok === true && d.name, '东张西望');
  });

  test('Name outside the pool → unknown-animation (there is no fallback on the playback end, so it must be stopped here)', () => {
    for (const name of ['根本不存在的动画', '东张西望.webm', '../../etc/passwd', '待机呼吸']) {
      const d = decide({ name });
      assert.equal(d.ok, false, `${name} should not pass`);
      assert.equal(d.ok === false && d.reason, 'unknown-animation');
    }
  });

  test('The names of all pools (menu + gameplay) can playback request', () => {
    for (const name of animationNames(ANIMATIONS)) {
      assert.equal(decide({ name }).ok, true, `${name} must be available for on-demand playback`);
    }
  });
});

describe('decideAnim ——Pet selection', () => {
  test('Specify an existing pet → use it', () => {
    const d = decide({ requested: 'test1' });
    assert.equal(d.ok, true);
    assert.equal(d.ok === true && d.petId, 'test1');
  });

  test('Do not specify pet → pet-required (the default chain has been deleted: never fall back to the "current desktop pet"/the first one in the list)', () => {
    for (const empty of ['', '   ']) {
      const d = decide({ requested: empty });
      assert.equal(d.ok, false);
      assert.equal(d.ok === false && d.reason, 'pet-required');
    }
  });

  test('Specified pet that does not exist → unknown-pet', () => {
    const d = decide({ requested: 'ghost' });
    assert.equal(d.ok, false);
    assert.equal(d.ok === false && d.reason, 'unknown-pet');
    assert.match(d.ok === false ? d.message : '', /ghost/);
  });

  test('Pet id contains dot number as usual (id is not divided according to dot number)', () => {
    const dotted = { main: { ...cfg.main, pets: [{ id: 'a.b', name: '点号宠' }] } };
    const d = decide({ cfg: dotted, requested: 'a.b' });
    assert.equal(d.ok, true);
    assert.equal(d.ok === true && d.petId, 'a.b');
  });

  test('The animation pool is determined by the entry it belongs to, and the pool does not cross entries.', () => {
    const two = {
      main: { animations: { idle: ['主池动画'] }, pets: [{ id: 'main', name: 'A' }] },
      pack1: { animations: { idle: ['包池动画'] }, pets: [{ id: 'pack1', name: 'B' }] },
    };
    assert.equal(decide({ cfg: two, requested: 'main', name: '包池动画' }).ok, false);
    assert.equal(decide({ cfg: two, requested: 'pack1', name: '主池动画' }).ok, false);
    assert.equal(decide({ cfg: two, requested: 'main', name: '主池动画' }).ok, true);
    assert.equal(decide({ cfg: two, requested: 'pack1', name: '包池动画' }).ok, true);
  });
});

describe('decideAnim —— url form (third party’s own asset, issue #122 Article 1)', () => {
  const URL_OK = 'https://cdn.example.com/拉侧栏.webm';

  test('Give url → Pass, and **do not check the animation pool**: of course there is no asset name in the pool held by others.', () => {
    const d = decide({ name: undefined, url: URL_OK });
    assert.equal(d.ok, true);
    assert.equal(d.ok === true && d.url, URL_OK);
    assert.equal(d.ok === true && d.name, undefined, 'The url pattern should not be given simultaneously with name');
  });

  test('Relative addresses from the same origin are not acceptable - they must be complete URL (`new URL` will be thrown for relative paths)', () => {
    const d = decide({ name: undefined, url: '/dsh-pet-wallpaper/asset/x.webm' });
    assert.equal(d.ok, false);
    assert.equal(d.ok === false && d.reason, 'bad-request');
  });

  test('url before and after blank → trim after judgment', () => {
    const d = decide({ name: undefined, url: '  ' + URL_OK + '  ' });
    assert.equal(d.ok === true && d.url, URL_OK);
  });

  test('Only http / https are released: all other scheme are bad-request', () => {
    for (const url of [
      'file:///C:/secret.webm', // el.src on the desktop is a direct connection, file: will let the renderer read any local file
      'ftp://example.com/x.webm',
      'javascript:alert(1)',
      'data:video/webm;base64,AAAA',
    ]) {
      const d = decide({ name: undefined, url });
      assert.equal(d.ok, false, `${url} should not pass`);
      assert.equal(d.ok === false && d.reason, 'bad-request');
    }
  });

  test('name and url are given at the same time / neither is given → bad-request (unknown intention, do not guess for the caller)', () => {
    for (const over of [
      { name: '东张西望', url: URL_OK },
      { name: undefined, url: undefined },
      { name: '', url: '' },
      { name: '   ', url: '   ' },
    ]) {
      const d = decide(over);
      assert.equal(d.ok, false, JSON.stringify(over) + ' 不应通过');
      assert.equal(d.ok === false && d.reason, 'bad-request');
    }
  });

  test('Pet verification in url mode is as usual: specify a pet that does not exist → unknown-pet', () => {
    const d = decide({ name: undefined, url: URL_OK, requested: 'ghost' });
    assert.equal(d.ok, false);
    assert.equal(d.ok === false && d.reason, 'unknown-pet');
  });

  test('The url form does not look at the name: any name in the address will still be allowed (no pool or file name check)', () => {
    const d = decide({ name: undefined, url: 'http://127.0.0.1:8080/dsh-pet-wallpaper/a/根本不在池里.webm' });
    assert.equal(d.ok, true);
  });
});

describe('decideAnim —— facing (orientation, optional)', () => {
  test('Not passed / null → passed and facing is absent (= renderer **immobile orientation**, not fallback left)', () => {
    for (const over of [{}, { facing: undefined }, { facing: null }]) {
      const d = decide(over);
      assert.equal(d.ok, true, JSON.stringify(over) + ' 应通过');
      assert.equal(d.ok === true && d.facing, undefined);
    }
  });

  test('left / right exposed as is', () => {
    for (const f of ['left', 'right'] as const) {
      const d = decide({ facing: f });
      assert.equal(d.ok, true);
      assert.equal(d.ok === true && d.facing, f);
    }
  });

  test('Invalid value → bad-request (not silently ignored, same conventions as mode / position)', () => {
    for (const bad of ['LEFT', 'Right', 'up', '', '   ', 42, true, {}, []]) {
      const d = decide({ facing: bad });
      assert.equal(d.ok, false, JSON.stringify(bad) + ' 不应通过');
      assert.equal(d.ok === false && d.reason, 'bad-request');
      assert.match(d.ok === false ? d.message : '', /facing/);
    }
  });

  test('url has the same form with facing', () => {
    const d = decide({ name: undefined, url: 'https://cdn.example.com/x.webm', facing: 'right' });
    assert.equal(d.ok, true);
    assert.equal(d.ok === true && d.url, 'https://cdn.example.com/x.webm');
    assert.equal(d.ok === true && d.facing, 'right');
  });

  test("facing invalid parsing error before pet (the parameter is the caller's fault, correct it first)", () => {
    const d = decide({ facing: 'up', requested: 'ghost' });
    assert.equal(d.ok, false);
    assert.equal(d.ok === false && d.reason, 'bad-request');
  });

  test('facing does not affect the verification of name / url', () => {
    assert.equal(decide({ name: '东张西望', url: 'https://x/y.webm', facing: 'left' }).ok, false);
    assert.equal(decide({ name: undefined, url: undefined, facing: 'left' }).ok, false);
  });
});
