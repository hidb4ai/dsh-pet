/** 发布版本与 npm 标签的行为约束，防止测试版覆盖 latest 或错标签发布。 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { releaseMetadata } from '../release-metadata.mjs';

const candidate = {
  name: 'dsh-pet-powercontext',
  version: '0.1.0-beta.1',
  eventName: 'push',
  ref: 'refs/tags/v0.1.0-beta.1',
};

test('首个测试版发布到 beta，并使用包版本生成归档名', () => {
  assert.deepEqual(releaseMetadata(candidate), {
    archive: 'dsh-pet-powercontext-0.1.0-beta.1.tgz',
    npm_tag: 'beta',
    prerelease: 'true',
  });
});

test('正式版使用 latest，其他预发布版保持自己的通道', () => {
  for (const [version, npmTag] of [
    ['1.0.0', 'latest'],
    ['1.1.0-alpha.2', 'alpha'],
    ['1.1.0-rc.1', 'rc'],
  ]) {
    const metadata = releaseMetadata({ ...candidate, version, ref: `refs/tags/v${version}` });
    assert.equal(metadata.npm_tag, npmTag);
    assert.equal(metadata.prerelease, String(npmTag !== 'latest'));
  }
});

test('标签与包版本不同或事件来自普通分支时拒绝发布', () => {
  for (const ref of ['refs/tags/v0.1.0', 'refs/tags/v9.0.0', 'refs/heads/main']) {
    assert.throws(() => releaseMetadata({ ...candidate, ref }), /Release tag must equal/);
  }
});

test('PR 与手动验证使用包内版本，不把 ref 当成发布版本', () => {
  for (const eventName of ['pull_request', 'workflow_dispatch']) {
    assert.equal(releaseMetadata({ ...candidate, eventName, ref: 'refs/pull/12/merge' }).npm_tag, 'beta');
  }
});

test('拒绝旧包名、非法版本和不能映射通道的版本', () => {
  assert.throws(() => releaseMetadata({ ...candidate, name: 'dsh-pet' }), /Unexpected package name/);
  for (const version of ['01.0.0', '0.1.0-beta.01', '0.1.0-preview.1', '0.1.0\nnpm_tag=latest', undefined]) {
    assert.throws(() => releaseMetadata({ ...candidate, version }), /Expected a stable version/);
  }
});
