/** Behavior constraints between the release version and the npm tag to prevent the test version from covering latest or being released with the wrong tag. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { releaseMetadata } from '../release-metadata.mjs';

const candidate = {
  name: 'dsh-pet-powercontext',
  version: '0.1.0-beta.1',
  eventName: 'push',
  ref: 'refs/tags/v0.1.0-beta.1',
};

test('The first beta version is released to beta and uses the package version to generate the archive name', () => {
  assert.deepEqual(releaseMetadata(candidate), {
    archive: 'dsh-pet-powercontext-0.1.0-beta.1.tgz',
    npm_tag: 'beta',
    prerelease: 'true',
  });
});

test('The official version uses latest, other pre-release versions maintain their own channels', () => {
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

test('Refuse to publish when the tag is different from the package version or the event comes from the normal branch', () => {
  for (const ref of ['refs/tags/v0.1.0', 'refs/tags/v9.0.0', 'refs/heads/main']) {
    assert.throws(() => releaseMetadata({ ...candidate, ref }), /Release tag must equal/);
  }
});

test('PR and manual verification use the package version, and ref is not regarded as the release version', () => {
  for (const eventName of ['pull_request', 'workflow_dispatch']) {
    assert.equal(releaseMetadata({ ...candidate, eventName, ref: 'refs/pull/12/merge' }).npm_tag, 'beta');
  }
});

test('Reject old package names, invalid versions and versions that cannot map channels', () => {
  assert.throws(() => releaseMetadata({ ...candidate, name: 'dsh-pet' }), /Unexpected package name/);
  for (const version of ['01.0.0', '0.1.0-beta.01', '0.1.0-preview.1', '0.1.0\nnpm_tag=latest', undefined]) {
    assert.throws(() => releaseMetadata({ ...candidate, version }), /Expected a stable version/);
  }
});
