/**
 * Behavioral test of voice cache (src/host/voice/cache.ts). Use real temporary directories with real fs: The value of
 * this module is in the file behavior. Each use case creates its own directory without interfering with each other.
 */
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { cacheKey, cachePath, ensureCacheDir, pruneCache } from './cache.ts';

/** Run the test case in a separate temporary directory and clean it up after completion. */
async function withDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-pet-voice-cache-'));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('cacheKey: The same input is stable, if the source/tone/speech speed/text is different, it will be different.', () => {
  const base = cacheKey('edge', 'zh-CN-XiaoxiaoNeural', '+0%', '你好');
  assert.equal(base, cacheKey('edge', 'zh-CN-XiaoxiaoNeural', '+0%', '你好'), 'The same input must be stable');
  assert.notEqual(
    base,
    cacheKey('my-tts', 'zh-CN-XiaoxiaoNeural', '+0%', '你好'),
    'Old audio cannot be hit after changing the implementation',
  );
  assert.notEqual(base, cacheKey('edge', 'zh-CN-YunxiNeural', '+0%', '你好'));
  assert.notEqual(base, cacheKey('edge', 'zh-CN-XiaoxiaoNeural', '+10%', '你好'));
  assert.notEqual(base, cacheKey('edge', 'zh-CN-XiaoxiaoNeural', '+0%', '你好 '), 'Spaces are not normalized');
});

test('cachePath: Fixed to fall under userRoot/voice-cache and end with . mp3', () => {
  assert.equal(cachePath(join('root'), 'abc'), join('root', 'voice-cache', 'abc.mp3'));
});

test('ensureCacheDir: Create the directory when it does not exist. No error will be reported if repeated calls are made.', () =>
  withDir(async (dir) => {
    const created = await ensureCacheDir(dir);
    assert.equal(created, join(dir, 'voice-cache'));
    await ensureCacheDir(dir);
  }));

test('pruneCache: When the maximum number of records is exceeded, delete them from the oldest one.', () =>
  withDir(async (dir) => {
    for (const [index, name] of ['a.mp3', 'b.mp3', 'c.mp3'].entries()) {
      const file = join(dir, name);
      await writeFile(file, Buffer.alloc(10));
      const stamp = new Date(2026, 0, 1 + index);
      await utimes(file, stamp, stamp);
    }
    const removed = await pruneCache(dir, { maxFiles: 2, maxBytes: 1_000_000 });
    assert.equal(removed, 1, 'Only delete the one that exceeds the upper limit');
    const left = await readdir(dir);
    assert.equal(left.includes('a.mp3'), false, 'The oldest a.mp3 should be deleted');
    assert.deepEqual(left.sort(), ['b.mp3', 'c.mp3']);
  }));

test('pruneCache: Return 0 instead of throwing an error when the directory does not exist', () =>
  withDir(async (dir) => {
    assert.equal(await pruneCache(join(dir, 'missing')), 0);
  }));
