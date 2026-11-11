/**
 * Single test of user-data decision: only test the part that does not touch Electron.
 *
 * Why it is worth a single test: When the fallback path is calculated incorrectly, helper under the restricted token
 * will still be stuck before ready, and the real machine CI cannot reproduce the restricted token. Here, the injected
 * fs is used to verify the three branches of "writable/unwritable/failed to roll back".
 *
 * Running method: node --test scripts/tests/user-data.test.mjs (npm run test:ui will be brought)
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const { dshHomeDir, isWritableDir, resolveUserDataDir } = require('../../runtime/electron-helper/main/user-data.js');

/** False fs: Only the directories listed in Set can be written, and other writes will throw EACCES. */
function fakeFs(writableDirs) {
  return {
    mkdirSync: () => {},
    writeFileSync: (file) => {
      if (!writableDirs.has(dirname(file))) {
        const error = new Error('EACCES: permission denied');
        error.code = 'EACCES';
        throw error;
      }
    },
    unlinkSync: () => {},
  };
}

describe('dshHomeDir - DSH main directory analysis', () => {
  test('DSH_HOME priority: use the environment variable if it is set', () => {
    assert.equal(dshHomeDir({ DSH_HOME: join('root', 'custom') }, join('root', 'home')), join('root', 'custom'));
  });

  test('DSH_HOME not set: fallback to ~/.dsh', () => {
    assert.equal(dshHomeDir({}, join('root', 'home')), join('root', 'home', '.dsh'));
  });
});

describe('isWritableDir——You must actually write it in before it can be written.', () => {
  test('Real temporary directory: writable', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-pet-userdata-'));
    try {
      assert.equal(isWritableDir(dir), true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('Write rejected: not writable', () => {
    assert.equal(isWritableDir(join('appdata', 'helper'), { fs: fakeFs(new Set()) }), false);
  });
});

describe('resolveUserDataDir - rollback decision', () => {
  const currentDir = join('appdata', 'dsh-pet-electron-helper');
  const dshHome = join('root', '.dsh');

  test('The original directory is writable: do not change the directory', () => {
    const out = resolveUserDataDir({ currentDir, dshHome, appMode: false, fs: fakeFs(new Set([currentDir])) });
    assert.deepEqual(out, { dir: currentDir, fallback: false, error: null });
  });

  test('The original directory cannot be written: fall back to electron-profile under $DSH_HOME', () => {
    const fallbackDir = join(dshHome, 'dsh-pet', 'electron-profile');
    const out = resolveUserDataDir({ currentDir, dshHome, appMode: false, fs: fakeFs(new Set([fallbackDir])) });
    assert.deepEqual(out, { dir: fallbackDir, fallback: true, error: null });
  });

  test('Independent application mode: fall back to app-profile to avoid grabbing the same copy of profile with helper', () => {
    const fallbackDir = join(dshHome, 'dsh-pet', 'app-profile');
    const out = resolveUserDataDir({ currentDir, dshHome, appMode: true, fs: fakeFs(new Set([fallbackDir])) });
    assert.deepEqual(out, { dir: fallbackDir, fallback: true, error: null });
  });

  test('Neither the original directory nor the fallback directory is writable: keep the original directory and bring back the error', () => {
    const out = resolveUserDataDir({ currentDir, dshHome, appMode: false, fs: fakeFs(new Set()) });
    assert.equal(out.dir, currentDir);
    assert.equal(out.fallback, false);
    assert.ok(out.error instanceof Error, 'The original error should be brought back for log output');
  });
});
