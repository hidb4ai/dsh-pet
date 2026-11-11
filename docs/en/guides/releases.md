# Publish a release

English · [简体中文](../../zh/guides/releases.md) · [Documentation](../README.md)

The package is `dsh-pet-powercontext`, starting at `0.1.0-beta.1`. The [Release workflow](../../../.github/workflows/release.yml) validates PRs and manual runs; only a pushed `v*` tag enters publication.

## Prepare

1. Merge the intended changes into `master`.
2. Set the version in `dsh-pet/package.json` and `openapi.yaml` together, then commit and merge that change. The first release already uses `0.1.0-beta.1`.
3. To publish npm, configure repository Actions variable `NPM_PUBLISH=true` and Actions secret `NPM_TOKEN` with publish access. Use an npm token suitable for unattended publication; never commit it to `.npmrc`. If the variable is absent or false, only GitHub Release and the desktop artifact are published.
4. Push the matching tag from the intended commit:

```sh
git switch master
git pull --ff-only origin master
git tag v0.1.0-beta.1
git push origin v0.1.0-beta.1
```

Use a new version/tag for later releases. The workflow checks the committed version; it does not rewrite it.

## Automatic sequence

| Stage                   | Work                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------ |
| Validate                | Check package name, version and exact tag match                                      |
| Build                   | Install locked dependencies; run unit tests and full `npm pack` prepack checks       |
| Exercise                | Run Chromium UI/script tests; install the archive and check CLI `--help` / `--check` |
| Preserve                | Generate SHA256SUMS and upload the tested package as an Actions artifact for 14 days |
| Publish npm, if enabled | Verify checksum, publish the same archive with lifecycle scripts disabled            |
| Create GitHub Release   | Generate notes and attach the archive and checksum                                   |
| Build desktop           | Call the Windows workflow and attach `dsh-pet-win-x64.zip` to that release           |

Versions ending in `alpha.N`, `beta.N` or `rc.N` use that npm dist-tag and a GitHub prerelease. Stable versions use `latest`. PRs and **Run workflow**, even when selecting a tag, do not publish.

## Failure and retry

Build/test failures stop publication. When npm is enabled, its failure prevents the GitHub Release step. A later Windows failure does not roll back npm or GitHub Release: rerun `release-app` manually with the existing tag to attach the ZIP.

A registry version is immutable. If npm succeeded but a later step failed, do not assume rerunning the whole release will skip npm; this workflow does not implement that recovery. Check which assets exist before choosing the retry step. Use a new version for changed package contents.

## Local package check

From the inner package directory, run `npm pack --pack-destination /absolute/path/outside/the/repository`. This runs the full prepack chain. Keep archives, smoke-test homes and logs outside the checkout; on local Linux use `/data/codex-tmp/` and set `TMPDIR` there.
