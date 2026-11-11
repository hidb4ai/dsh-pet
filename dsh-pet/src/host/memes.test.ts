/**
 * Emoticon pool unit test - verify the alignment rules and image selection/verification semantics of "Configuration
 * memes ↔ Disk Image": Missing entries in the file must be eliminated (users do not have to change the configuration
 * simultaneously when deleting images), entries with empty descriptions, non-object/array and other invalid forms →
 * Empty pool (no error thrown, degraded to plain text whisper); Directory chain (category exclusive → User directory →
 * Package) Check the disk in order: if the picture is found in any directory on the chain, it is a hit; limitPool (the
 * upper limit of the number of dialogue pictures): 0/invalid = no limit, N >0 = take the first N picture.
 *
 * Running method: node --experimental-strip-types --test src/host/memes.test.ts
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { limitPool, matchMeme, pickMeme, readMemePool } from './memes.ts';

/** Create a temporary meme directory and write the same name png as names (the content is irrelevant, as long as it exists) */
function withMemes(names: string[], run: (memesDir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-pet-memes-test-'));
  try {
    const memesDir = join(dir, 'memes');
    mkdirSync(memesDir, { recursive: true });
    for (const n of names) writeFileSync(join(memesDir, n + '.png'), 'x');
    run(memesDir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('readMemePool - Configuration and disk alignment', () => {
  test('The hit entry is put into the pool (the description is blank)', () => {
    withMemes(['可爱', '吃白饭的大肥鱼'], (memesDir) => {
      const pool = readMemePool({ 可爱: ' 卖萌立绘 ', 吃白饭的大肥鱼: '躺平扒饭' }, [memesDir]);
      assert.equal(pool.length, 2);
      assert.equal(pool.find((m) => m.name === '可爱')?.desc, '卖萌立绘');
      assert.ok(pool.some((m) => m.name === '吃白饭的大肥鱼'));
    });
  });

  test('Pictures that are in the configuration but not on the disk → Delete (deleting pictures does not require simultaneous configuration changes)', () => {
    withMemes(['可爱'], (memesDir) => {
      const pool = readMemePool({ 可爱: '卖萌', 不存在的图: '随便写' }, [memesDir]);
      assert.deepEqual(
        pool.map((m) => m.name),
        ['可爱'],
      );
    });
  });

  test('There are pictures on the disk that are not written in the configuration → do not enter the pool (no way to know the description)', () => {
    withMemes(['可爱', '未登记的图'], (memesDir) => {
      const pool = readMemePool({ 可爱: '卖萌' }, [memesDir]);
      assert.equal(pool.length, 1);
    });
  });

  test('Description is empty/blank only/non-character string → eliminate', () => {
    withMemes(['a', 'b', 'c'], (memesDir) => {
      const pool = readMemePool({ a: '', b: '   ', c: 42 }, [memesDir]);
      assert.equal(pool.length, 0);
    });
  });

  test('Invalid memes form → empty pool without throwing error', () => {
    withMemes(['可爱'], (memesDir) => {
      for (const bad of [undefined, null, 42, 'str', ['可爱'] as unknown]) {
        assert.deepEqual(readMemePool(bad, [memesDir]), []);
      }
    });
  });

  test('Directory does not exist → Empty pool (not packaged/deleted but does not crash)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-pet-memes-test-'));
    try {
      assert.deepEqual(readMemePool({ 可爱: '卖萌' }, [join(dir, 'nope')]), []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('readMemePool —— Directory chain (type exclusive/user/in-package)', () => {
  /** Comparison of name sets: There is a special use case verify for the sequential semantics of the pool. Here we only care about "who entered the pool" */
  const names = (pool: { name: string }[]): string[] => pool.map((m) => m.name).sort();

  test('The order of the pool = the order written in the configuration ("the first N pictures" must be controllable by the user and cannot be in Pinyin order)', () => {
    withMemes(['次', '阿', '波'], (memesDir) => {
      const pool = readMemePool({ 次: 'C', 阿: 'A', 波: 'B' }, [memesDir]);
      assert.deepEqual(
        pool.map((m) => m.name),
        ['次', '阿', '波'],
        'Return to the original writing order; it used to be sorted by zh pinyin (it will become a/wave/times), which has been changed',
      );
    });
  });

  test('After eliminating missing items, the remaining items still maintain the writing order (not rearranged due to filtering)', () => {
    withMemes(['乙', '甲'], (memesDir) => {
      const pool = readMemePool({ 甲: 'A', 缺图: 'X', 乙: 'B' }, [memesDir]);
      assert.deepEqual(
        pool.map((m) => m.name),
        ['甲', '乙'],
      );
    });
  });

  test('The picture exists in any directory on the chain → hit (the order only determines who is found first)', () => {
    withMemes(['独占的图'], (ownDir) => {
      withMemes(['包内的图'], (pkgDir) => {
        assert.deepEqual(names(readMemePool({ 独占的图: '自己带的', 包内的图: '包里的' }, [ownDir, pkgDir])), [
          '包内的图',
          '独占的图',
        ]);
      });
    });
  });

  test('There is no directory in the chain → Eliminate (consistent with single directory conventions)', () => {
    withMemes(['a'], (dirA) => {
      withMemes(['b'], (dirB) => {
        assert.deepEqual(names(readMemePool({ a: 'A', b: 'B', c: 'C' }, [dirA, dirB])), ['a', 'b']);
      });
    });
  });

  test('Empty link → Empty pool (no directory checked)', () => {
    withMemes(['可爱'], () => {
      assert.deepEqual(readMemePool({ 可爱: '卖萌' }, []), []);
    });
  });

  test('Exclusive semantics are not in this function: when the chain is only given to one directory, pictures in other directories will not participate.', () => {
    withMemes(['同名图'], (ownDir) => {
      withMemes(['同名图', '只在包内'], (pkgDir) => {
        const memes = { 同名图: '自己的', 只在包内: '包里的' };
        // The caller (memeDirsFor of host/index.ts) only passes its own directory when the type is exclusive: only
        // pictures that are in the directory in the package are not entered into the pool - there is no such directory
        // in the chain at all, and the picture with the same name is also its own share.
        assert.deepEqual(names(readMemePool(memes, [ownDir])), ['同名图']);
        // Control: put the directory in the package into the chain (non-exclusive fallback chain), and the same picture will be put into the pool immediately
        assert.deepEqual(names(readMemePool(memes, [ownDir, pkgDir])), ['只在包内', '同名图']);
      });
    });
  });
});

describe('pickMeme —— Random drawing', () => {
  const pool = [
    { name: 'a', desc: 'A' },
    { name: 'b', desc: 'B' },
    { name: 'c', desc: 'C' },
  ];

  test('Empty pool → undefined', () => {
    assert.equal(pickMeme([]), undefined);
  });

  test('Press the random drop point to get the corresponding item', () => {
    assert.equal(pickMeme(pool, () => 0)?.name, 'a');
    assert.equal(pickMeme(pool, () => 0.5)?.name, 'b');
    assert.equal(pickMeme(pool, () => 0.99)?.name, 'c');
  });

  test('random returns 1 (boundary) without crossing the boundary', () => {
    assert.equal(pickMeme(pool, () => 1)?.name, 'a');
  });
});

describe('limitPool ——The upper limit of the number of dialogue pictures (chatImageLimit)', () => {
  const pool = [
    { name: 'a', desc: 'A' },
    { name: 'b', desc: 'B' },
    { name: 'c', desc: 'C' },
  ];

  test('limit > 0 → Take the first limit pictures in the pool', () => {
    assert.deepEqual(
      limitPool(pool, 2).map((m) => m.name),
      ['a', 'b'],
    );
    assert.deepEqual(
      limitPool(pool, 1).map((m) => m.name),
      ['a'],
    );
  });

  test('limit exceeds the pool size → return as is (no supplement, no error)', () => {
    assert.deepEqual(limitPool(pool, 99), pool);
  });

  test('0 = No limit (return unchanged, consistent with the old behavior verbatim)', () => {
    assert.deepEqual(limitPool(pool, 0), pool);
  });

  test('Negative numbers / non-finite numbers / non-numbers → all processed as "unlimited" (never return to empty pool)', () => {
    for (const bad of [-1, -0.5, NaN, Infinity, -Infinity, undefined as unknown as number]) {
      assert.deepEqual(limitPool(pool, bad), pool, `limit = ${String(bad)} must be returned as is`);
    }
  });

  test('Decimals are rounded down (there is no such ambiguous value as "take 2.5 pictures")', () => {
    assert.deepEqual(
      limitPool(pool, 2.9).map((m) => m.name),
      ['a', 'b'],
    );
  });

  test('Empty pool → Empty pool (any limit is unchanged)', () => {
    assert.deepEqual(limitPool([], 3), []);
  });
});

describe('matchMeme —— Model selection verification', () => {
  const pool = [
    { name: '可爱', desc: '卖萌' },
    { name: '死掉了', desc: '累瘫' },
  ];

  test('Hit in the pool → Return to this entry', () => {
    assert.equal(matchMeme(pool, '死掉了')?.desc, '累瘫');
  });

  test('Name outside the pool (model illusion) → undefined', () => {
    assert.equal(matchMeme(pool, '不存在的图'), undefined);
  });

  test('Blank/non-character string → undefined', () => {
    assert.equal(matchMeme(pool, ''), undefined);
    assert.equal(matchMeme(pool, '   '), undefined);
    assert.equal(matchMeme(pool, undefined as unknown as string), undefined);
  });

  test('Blank spaces before and after are tolerated (the model can hit even if there are multiple spaces)', () => {
    assert.equal(matchMeme(pool, ' 可爱 ')?.desc, '卖萌');
  });
});
