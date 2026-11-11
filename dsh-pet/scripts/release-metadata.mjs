/** 校验发布包身份与标签，输出供打包和发布步骤共用的版本元数据。 */
import { appendFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 根据包版本选择 npm 标签；推送版本标签时要求它与包版本完全相同。 */
export function releaseMetadata({ name, version, eventName, ref }) {
  if (name !== 'dsh-pet-powercontext') throw new Error(`Unexpected package name: ${name}`);
  const match = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(alpha|beta|rc)\.(?:0|[1-9]\d*))?$/.exec(version);
  if (!match) throw new Error(`Expected a stable version or alpha.N, beta.N, rc.N prerelease: ${version}`);
  if (eventName === 'push' && ref !== `refs/tags/v${version}`) {
    throw new Error(`Release tag must equal v${version}; received ${ref}`);
  }
  return {
    archive: `${name}-${version}.tgz`,
    npm_tag: match[1] ?? 'latest',
    prerelease: String(Boolean(match[1])),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const metadata = releaseMetadata({
    name: pkg.name,
    version: pkg.version,
    eventName: process.env.GITHUB_EVENT_NAME,
    ref: process.env.GITHUB_REF,
  });
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      Object.entries(metadata)
        .map(([key, value]) => `${key}=${value}\n`)
        .join(''),
    );
  }
  console.log(JSON.stringify(metadata));
}
