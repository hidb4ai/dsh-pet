/**
 * Storage location list unit test - verify that each path displayed in the "unmount and storage" setting page: must be
 * consistent with the real writing party (userRoot of index.ts, Electron landing directory of helper-process.ts,
 * app.setName of main.js, @electron / get env-paths cacheRoot ) are consistent on a platform-by-platform basis.
 *
 * Among them, DESKTOP_APP_NAME directly reads runtime/electron-helper/main.js. Verification - when the name changes on
 * both sides are not synchronized, the settings page will display a directory that never exists, and it must be red
 * here.
 *
 * Running method: node --experimental-strip-types --test src/host/storage-paths.test.ts
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { DESKTOP_APP_NAME, profileNameFrom, storageEntries } from './storage-paths.ts';

/** Injection input for each platform (the benchmark directories are all hard-coded to avoid using the real environment) */
const base = {
  userDataRoot: '/dsh-home/dsh-pet',
  electronDir: '/dsh-home/electron',
  home: '/home/u',
  packageRoot: '/dsh-home/profiles/web/node_modules/dsh-pet',
};

/** Get the path of an entry */
function pathOf(entries: ReturnType<typeof storageEntries>, key: string): string {
  const hit = entries.find((e) => e.key === key);
  assert.ok(hit, '缺少条目 ' + key);
  return hit.path;
}

describe('storageEntries - The writing path is transparently transmitted as it is (without spelling the directory name yourself)', () => {
  test('userData and electron are the paths given by the caller, and none of the characters will be changed.', () => {
    // Deliberately give a path that does not comply with any default convention: if this module secretly spells 'dsh-pet' / 'electron', it will be red here
    const entries = storageEntries({
      userDataRoot: 'Z:\\weird\\place',
      electronDir: 'Z:\\another\\runtime',
      home: '/home/u',
      packageRoot: '/pkg',
      platform: 'win32',
      env: {},
    });
    assert.equal(pathOf(entries, 'userData'), 'Z:\\weird\\place');
    assert.equal(pathOf(entries, 'electron'), 'Z:\\another\\runtime');
  });
});

describe('storageEntries ——Platform-by-platform path derivation', () => {
  test('win32: System-level directory goes to APPDATA/LOCALAPPDATA', () => {
    const entries = storageEntries({
      ...base,
      platform: 'win32',
      env: { APPDATA: 'C:\\AppData\\Roaming', LOCALAPPDATA: 'C:\\AppData\\Local' },
    });
    assert.equal(pathOf(entries, 'userData'), base.userDataRoot);
    assert.equal(pathOf(entries, 'electron'), base.electronDir);
    assert.equal(pathOf(entries, 'desktopCache'), join('C:\\AppData\\Roaming', DESKTOP_APP_NAME));
    // env-paths has one more layer of Cache under Windows
    assert.equal(pathOf(entries, 'electronCache'), join('C:\\AppData\\Local', 'electron', 'Cache'));
    assert.equal(pathOf(entries, 'package'), base.packageRoot);
  });

  test('win32: APPDATA/LOCALAPPDATA is missing → fallback to AppData under home', () => {
    const entries = storageEntries({ ...base, platform: 'win32', env: {} });
    assert.equal(pathOf(entries, 'desktopCache'), join('/home/u', 'AppData', 'Roaming', DESKTOP_APP_NAME));
    assert.equal(pathOf(entries, 'electronCache'), join('/home/u', 'AppData', 'Local', 'electron', 'Cache'));
  });

  test('darwin：Application Support + Library/Caches', () => {
    const entries = storageEntries({ ...base, platform: 'darwin', env: {} });
    assert.equal(pathOf(entries, 'desktopCache'), join('/home/u', 'Library', 'Application Support', DESKTOP_APP_NAME));
    assert.equal(pathOf(entries, 'electronCache'), join('/home/u', 'Library', 'Caches', 'electron'));
  });

  test('linux: XDG variable takes precedence. If not set, fallback to ~/.config and ~/.cache', () => {
    const xdg = storageEntries({
      ...base,
      platform: 'linux',
      env: { XDG_CONFIG_HOME: '/xdg/config', XDG_CACHE_HOME: '/xdg/cache' },
    });
    assert.equal(pathOf(xdg, 'desktopCache'), join('/xdg/config', DESKTOP_APP_NAME));
    assert.equal(pathOf(xdg, 'electronCache'), join('/xdg/cache', 'electron'));

    const fallback = storageEntries({ ...base, platform: 'linux', env: {} });
    assert.equal(pathOf(fallback, 'desktopCache'), join('/home/u', '.config', DESKTOP_APP_NAME));
    assert.equal(pathOf(fallback, 'electronCache'), join('/home/u', '.cache', 'electron'));
  });

  test('The order of entries is fixed: user data → runtime → cache → plugin body', () => {
    const keys = storageEntries({ ...base, platform: 'win32', env: {} }).map((e) => e.key);
    assert.deepEqual(keys, ['userData', 'electron', 'desktopCache', 'electronCache', 'package']);
  });

  test('exists is determined immediately from the disk (the real existing directory is true, the uncreated directory is false)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-pet-storage-test-'));
    try {
      const mk = () =>
        storageEntries({
          userDataRoot: join(dir, 'dsh-pet'),
          electronDir: join(dir, 'electron'),
          home: dir,
          packageRoot: dir,
          platform: 'win32',
          env: {},
        });
      // packageRoot = dir itself exists → true; dsh-pet / has not been created yet → false
      assert.equal(mk().find((e) => e.key === 'package')?.exists, true);
      assert.equal(mk().find((e) => e.key === 'userData')?.exists, false);

      mkdirSync(join(dir, 'dsh-pet'), { recursive: true });
      assert.equal(mk().find((e) => e.key === 'userData')?.exists, true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('profileNameFrom —— profile name in unmount command', () => {
  test('Reverse from < DSH_HOME >/ profiles /< name >/ node_modules /< pkg >', () => {
    assert.equal(profileNameFrom("C:\\Users\\p'c\\.dsh\\profiles\\web\\node_modules\\dsh-pet"), 'web');
    assert.equal(profileNameFrom('/home/u/.dsh/profiles/custom/node_modules/dsh-pet'), 'custom');
  });

  test('Unable to infer → undefined (I would rather return the placeholder than guess the wrong one)', () => {
    assert.equal(profileNameFrom('/dsh-home/profiles/node_modules/dsh-pet'), undefined);
    assert.equal(profileNameFrom('/some/link/dsh-pet'), undefined);
    assert.equal(profileNameFrom(''), undefined);
  });
});

describe('DESKTOP_APP_NAME ——Anti-drift with practical application on desktop', () => {
  test('Consistent with app.setName of runtime/electron-helper/main.js', () => {
    const src = readFileSync(new URL('../../runtime/electron-helper/main.js', import.meta.url), 'utf8');
    const m = /app\.setName\(\s*['"]([^'"]+)['"]\s*\)/.exec(src);
    assert.ok(m, 'app.setName not found in main.js');
    assert.equal(m[1], DESKTOP_APP_NAME);
  });
});
