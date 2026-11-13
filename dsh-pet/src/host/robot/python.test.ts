/** Verify deterministic runtime selection and prevent implicit system-Python fallback. */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { resolveRobotPython } from './python.ts';
import { defaultRobotConfig, robotConfigSchema } from './config.ts';

test('bundled Python is the default and missing runtime never falls back to PATH', () => {
  assert.equal(defaultRobotConfig().python, 'bundled');
  assert.ok(robotConfigSchema.safeParse(defaultRobotConfig()).success);
  const root = mkdtempSync(join(tmpdir(), 'astra-python-'));
  try {
    assert.throws(() => resolveRobotPython('bundled', root, ''), /full robot package/);
    assert.equal(resolveRobotPython('/custom/python3', root, ''), '/custom/python3');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('npm and Electron use private runtimes with platform validation', () => {
  const root = mkdtempSync(join(tmpdir(), 'astra-python-'));
  try {
    for (const packaged of [false, true]) {
      const directory = packaged ? join(root, 'resources', 'astra-runtime') : join(root, 'runtime', 'astra-native');
      const executable = join(
        directory,
        'python',
        ...(process.platform === 'win32' ? ['python.exe'] : ['bin', 'python3']),
      );
      mkdirSync(join(directory, 'python', 'bin'), { recursive: true });
      writeFileSync(executable, '');
      const manifest = join(directory, 'manifest.json');
      writeFileSync(manifest, JSON.stringify({ platform: `${process.platform}-${process.arch}`, sdkVersion: '2.0.0' }));
      const resources = packaged ? join(root, 'resources') : '';
      assert.equal(resolveRobotPython('bundled', root, resources), executable);
      writeFileSync(manifest, JSON.stringify({ platform: 'unsupported', sdkVersion: '2.0.0' }));
      assert.throws(() => resolveRobotPython('bundled', root, resources), /does not match/);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
