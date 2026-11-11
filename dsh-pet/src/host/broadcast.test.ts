/**
 * Single test of the decision-making layer of third-party feeding (`POST /dsh-pet-7340/broadcast`, issue #76).
 *
 * Why test this layer instead of only HTTP: The contract of this function is these verification rules (the text is not
 * empty, the pet exists, the picture must be in the meme pool in the package when giving the name, the
 * complete address of http/https must be given when giving url, and the two forms cannot be given at the same time).
 * The route layer cannot read assets in the package in source code form (PACKAGE_ROOT is parsed into < pkg >/ src),
 * and cannot cover these branches - so the rules are extracted to ./broadcast for single testing, and the route can
 * only be transported.
 *
 * Use Node to build test runner (node:test) without introducing any npm dependencies.
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  decideBroadcast,
  decideBubbleClear,
  normalizeBroadcastAnim,
  normalizeBroadcastDuration,
  normalizeBroadcastText,
  normalizeBroadcastVoice,
} from './broadcast.ts';

/** Two pictures that really exist in the pool */
const IN_POOL = '可爱';
const IN_POOL2 = '大的要来啦';
/** It is written in the configuration, but there is no corresponding png → readMemePool on the disk. It will be eliminated and counted as "not in the pool" when feeding. */
const NO_FILE = '缺文件的图';

let tempRoot = '';
let memesDir = '';
let cfg: Record<string, Record<string, unknown>>;

/**
 * Convenient call for decision-making: only the parameters of concern this time are covered, and the rest are
 * defaulted. memeDirs defaults to the "shared emoticon directory" chain (= non-exclusive fallback chain), which is in
 * the same order as host's memeDirsFor.
 */
const decide = (over: Partial<Parameters<typeof decideBroadcast>[0]> = {}) =>
  decideBroadcast({
    cfg,
    requested: 'main',
    text: '主人，该喝水了',
    image: undefined,
    url: undefined,
    duration: 10000,
    anim: true,
    memeDirs: () => [memesDir],
    ...over,
  });

before(() => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-pet-broadcast-'));
  memesDir = join(root, 'memes');
  mkdirSync(memesDir, { recursive: true });
  writeFileSync(join(memesDir, `${IN_POOL}.png`), 'x');
  writeFileSync(join(memesDir, `${IN_POOL2}.png`), 'x');
  tempRoot = root;

  cfg = {
    main: {
      memes: { [IN_POOL]: '卖萌', [IN_POOL2]: '预警', [NO_FILE]: '文件缺失的那张' },
      pets: [
        { id: 'main', name: '蓝毛小女仆' },
        { id: 'test1', name: '测试宠' },
      ],
    },
  };
});

after(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

describe('normalizeBroadcastText - text normalization (route and decision-making layer share the same rule)', () => {
  test('Non-character strings are always returned to zero (not an error, nor character stringification)', () => {
    for (const v of [undefined, null, 123, {}, [], true]) {
      assert.equal(normalizeBroadcastText(v), '', `${JSON.stringify(v)} should be normalized to an empty string`);
    }
  });

  test('Pure blank and front and rear blanks: trim post judgment', () => {
    assert.equal(normalizeBroadcastText('   '), '');
    assert.equal(normalizeBroadcastText('\n\t '), '');
    assert.equal(normalizeBroadcastText('  说话  '), '说话');
  });
});

describe('decideBroadcast —— No length limit', () => {
  test('Very long text is passed as usual (the content length is the responsibility of the caller)', () => {
    // There is no length limit or frequency limit for feeding: the host only guarantees "moving if it is not empty", without truncation or discarding.
    const long = 'x'.repeat(100000);
    const d = decide({ text: long });
    assert.equal(d.ok, true);
    assert.equal(d.ok === true && d.text.length, 100000);
  });
});

describe('decideBroadcast - text verification', () => {
  test('Empty / pure blank / missing field → bad-request', () => {
    for (const text of ['', '   ', undefined, null, 42]) {
      const d = decide({ text });
      assert.equal(d.ok, false);
      assert.equal(d.ok === false && d.reason, 'bad-request');
    }
  });

  test('Text trim is written after (the white space before and after does not enter the bubble)', () => {
    const d = decide({ text: '  该喝水了  ' });
    assert.equal(d.ok, true);
    assert.equal(d.ok === true && d.text, '该喝水了');
  });
});

describe('decideBroadcast ——Pet selection', () => {
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

  test('Specify a pet that does not exist → unknown-pet (explicit failure, not silently writing a leaf that no one reads)', () => {
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
});

describe('decideBroadcast ——The emoticon pool with pictures only recognizes the desktop pet entry', () => {
  test('Hit in the pool → Pass, and use the canonical name in the pool', () => {
    const d = decide({ image: IN_POOL });
    assert.equal(d.ok, true);
    assert.equal(d.ok === true && d.image, IN_POOL);
  });

  test('Blank before and after the name → trim can still hit', () => {
    const d = decide({ image: `  ${IN_POOL2}  ` });
    assert.equal(d.ok, true);
    assert.equal(d.ok === true && d.image, IN_POOL2);
  });

  test('No picture: Default/empty string/null → passed without image field', () => {
    for (const image of [undefined, '', '   ', null]) {
      const d = decide({ image });
      assert.equal(d.ok, true);
      assert.equal(d.ok === true && 'image' in d, false, 'The image field should not appear when there is no picture.');
    }
  });

  test('Name outside the pool → unknown-image (anti-hallucination name)', () => {
    const d = decide({ image: '根本没有这张图' });
    assert.equal(d.ok, false);
    assert.equal(d.ok === false && d.reason, 'unknown-image');
  });

  test('The configuration is written but the disk is missing files → It is not considered to be in the pool (same conventions as whisper/dialogue)', () => {
    const d = decide({ image: NO_FILE });
    assert.equal(d.ok, false);
    assert.equal(d.ok === false && d.reason, 'unknown-image');
  });

  test('External URL is not accepted (prevent third parties from injecting off-site addresses)', () => {
    for (const image of ['https://evil.example/x.png', '//evil.example/x.png', '/etc/passwd', '../../x.png']) {
      const d = decide({ image });
      assert.equal(d.ok, false, `${image} shall not be used as accompanying images`);
      assert.equal(d.ok === false && d.reason, 'unknown-image');
    }
  });

  test('The picture pool is empty (memes is not configured) → any pictures are not included in the pool', () => {
    const empty = { main: { ...cfg.main, memes: {} } };
    const d = decide({ cfg: empty, image: IN_POOL });
    assert.equal(d.ok, false);
    assert.equal(d.ok === false && d.reason, 'unknown-image');
  });

  test('Pictures do not cross pet string pools: judged according to memes of the corresponding entry', () => {
    // The file pet entry comes with memes (excluding cute) → feeding test1 cute should fail
    const two = {
      main: { ...cfg.main, pets: [{ id: 'main', name: 'A' }] },
      pack1: { ...cfg.main, memes: { [IN_POOL2]: '预警' }, pets: [{ id: 'pack1', name: 'B' }] },
    };
    assert.equal(decide({ cfg: two, requested: 'pack1', image: IN_POOL }).ok, false);
    assert.equal(decide({ cfg: two, requested: 'pack1', image: IN_POOL2 }).ok, true);
    assert.equal(decide({ cfg: two, requested: 'main', image: IN_POOL }).ok, true);
  });

  test('The directory chain is fetched by entry: pictures in the category-exclusive directory must be fed to the pet to be considered a hit.', () => {
    // pack1 comes with its own meme directory (exclusive: it is the only one in the chain), main takes the shared directory
    const ownDir = join(tempRoot, 'pack1-memes');
    mkdirSync(ownDir, { recursive: true });
    writeFileSync(join(ownDir, '自家图.png'), 'x');
    const own = { 自家图: '这个种类自己带的', [IN_POOL]: '共用目录里那张同名图' };
    const two = {
      main: { ...cfg.main, pets: [{ id: 'main', name: 'A' }] },
      pack1: { ...cfg.main, memes: own, pets: [{ id: 'pack1', name: 'B' }] },
    };
    // There is no shared directory in the exclusive chain → Cuteness, which is only found in the directory in the package, is not counted as a hit; the home image is a hit
    const dirs = (entry: string) => (entry === 'pack1' ? [ownDir] : [memesDir]);
    assert.equal(decide({ cfg: two, memeDirs: dirs, requested: 'pack1', image: IN_POOL }).ok, false);
    assert.equal(decide({ cfg: two, memeDirs: dirs, requested: 'pack1', image: '自家图' }).ok, true);
    assert.equal(decide({ cfg: two, memeDirs: dirs, requested: 'main', image: IN_POOL }).ok, true);
  });
});

describe('normalizeBroadcastDuration —— bubble duration (issue #122 Article 5)', () => {
  test('Default / null → 10 s (the behavior of the old caller remains unchanged)', () => {
    assert.equal(normalizeBroadcastDuration(undefined), 10000);
    assert.equal(normalizeBroadcastDuration(null), 10000);
  });

  test('The valid value is revealed as it is; `0` is a valid value (literal meaning: not displayed); there is no upper limit', () => {
    assert.equal(normalizeBroadcastDuration(0), 0);
    assert.equal(normalizeBroadcastDuration(1), 1);
    assert.equal(normalizeBroadcastDuration(3000), 3000);
    assert.equal(normalizeBroadcastDuration(999999999), 999999999);
  });

  test('Negative number / non-finite number / non-number → null (route returns bad-request accordingly)', () => {
    for (const v of [-1, -0.5, NaN, Infinity, -Infinity, '3000', {}, [], true]) {
      assert.equal(normalizeBroadcastDuration(v), null, `${JSON.stringify(v)} should be deemed illegal`);
    }
  });
});

describe('normalizeBroadcastAnim - animation linkage switch (only strictly false can be turned off)', () => {
  test('Closed only if strictly false', () => {
    assert.equal(normalizeBroadcastAnim(false), false);
  });

  test('For the rest, press "Require linkage": default, true, character string "false", 0, null are all considered enabled.', () => {
    for (const v of [undefined, null, true, 'false', 0, 1, {}]) {
      assert.equal(normalizeBroadcastAnim(v), true, `${JSON.stringify(v)} should be processed as a linkage`);
    }
  });
});

describe('normalizeBroadcastVoice——Broadcast switch (only read true strictly)', () => {
  test('Only read true strictly', () => {
    assert.equal(normalizeBroadcastVoice(true), true);
  });

  test('The default and other values are ignored: undefined, null, false, the character string "true", and 1 are silent.', () => {
    for (const v of [undefined, null, false, 'true', 1, 0, {}]) {
      assert.equal(normalizeBroadcastVoice(v), false, `${JSON.stringify(v)} should not speak out`);
    }
  });
});

describe('decideBroadcast - The new parameters enter the conclusion as they are (the effective values written into the leaves are the parsed effective values)', () => {
  test('Default resolved to explicit value: 10 s + linkage', () => {
    const d = decide();
    assert.equal(d.ok, true);
    assert.equal(d.ok === true && d.duration, 10000);
    assert.equal(d.ok === true && d.anim, true);
  });

  test('The value given by caller is brought out as it is (including duration =0 and anim = false)', () => {
    const d = decide({ duration: 0, anim: false });
    assert.equal(d.ok, true);
    assert.equal(d.ok === true && d.duration, 0);
    assert.equal(d.ok === true && d.anim, false);
  });

  test('The failed branch does not have these two fields (the caller will not mistakenly think that it is effective)', () => {
    const d = decide({ text: '', duration: 0, anim: false });
    assert.equal(d.ok, false);
    assert.equal(d.ok === false && 'duration' in d, false);
  });
});

describe('decideBubbleClear —— clear bubble (only "clear which pet" will fail)', () => {
  test('Specify existing pet → Pass', () => {
    const d = decideBubbleClear({ cfg, requested: 'test1' });
    assert.equal(d.ok, true);
    assert.equal(d.ok === true && d.petId, 'test1');
  });

  test('pet default → pet-required (same conventions as / broadcast)', () => {
    const d = decideBubbleClear({ cfg, requested: '' });
    assert.equal(d.ok, false);
    assert.equal(d.ok === false && d.reason, 'pet-required');
  });

  test('Non-existent pet → unknown-pet (explicit failure, do not write a leaf that no one reads)', () => {
    const d = decideBubbleClear({ cfg, requested: 'ghost' });
    assert.equal(d.ok, false);
    assert.equal(d.ok === false && d.reason, 'unknown-pet');
    assert.match(d.ok === false ? d.message : '', /ghost/);
  });

  test('There is no such failure as "bubble does not exist": the empty state is also ok (idempotent)', () => {
    // The decision-making layer cannot see that the bubble is currently visible and hidden, and should not have created a failure branch for it in the first place.
    assert.equal(decideBubbleClear({ cfg, requested: 'main' }).ok, true);
  });
});

describe('decideBroadcast ——url form with pictures (third party’s own asset, issue #122 Article 1)', () => {
  const URL_OK = 'https://cdn.example.com/拒绝换壁纸.png';

  test('Give to url → Pass, and **do not check the emoticon pool**: the picture is in the hands of a third party, and of course it is not in the pool', () => {
    const d = decide({ url: URL_OK });
    assert.equal(d.ok, true);
    assert.equal(d.ok === true && d.url, URL_OK);
    assert.equal(d.ok === true && d.image, undefined, 'url form should not be given simultaneously with image');
  });

  test('url before and after blank → trim after judgment', () => {
    const d = decide({ url: '  ' + URL_OK + '  ' });
    assert.equal(d.ok === true && d.url, URL_OK);
  });

  test('The same-origin relative address is not acceptable - it must be complete URL', () => {
    const d = decide({ url: '/dsh-pet-wallpaper/asset/x.png' });
    assert.equal(d.ok, false);
    assert.equal(d.ok === false && d.reason, 'bad-request');
  });

  test('Only http / https are released: all other scheme are bad-request', () => {
    for (const url of ['file:///C:/secret.png', 'ftp://example.com/x.png', 'javascript:alert(1)']) {
      const d = decide({ url });
      assert.equal(d.ok, false, `${url} should not pass`);
      assert.equal(d.ok === false && d.reason, 'bad-request');
    }
  });

  test('image and url are given at the same time → bad-request (choose one of the two forms, do not guess for the caller)', () => {
    const d = decide({ image: IN_POOL, url: URL_OK });
    assert.equal(d.ok, false);
    assert.equal(d.ok === false && d.reason, 'bad-request');
  });

  test('unknown-image is not generated in the url form (that verification only belongs to the name form)', () => {
    // The file name in the address is not in the pool at all: the name must be in the form unknown-image, and the form url still passes.
    const d = decide({ url: 'https://cdn.example.com/池里没有这张.png' });
    assert.equal(d.ok, true);
  });

  test('Plain text paths are not affected: image / url are not given → still passed without image field', () => {
    const d = decide({ image: undefined, url: undefined });
    assert.equal(d.ok, true);
    assert.equal(d.ok === true && 'image' in d, false);
    assert.equal(d.ok === true && 'url' in d, false);
  });

  test('Text and pet verification are still the same in url state', () => {
    assert.equal(decide({ text: '', url: URL_OK }).ok, false);
    const d = decide({ url: URL_OK, requested: 'ghost' });
    assert.equal(d.ok === false && d.reason, 'unknown-pet');
  });
});
