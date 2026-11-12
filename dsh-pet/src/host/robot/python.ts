/** Locate the private robot runtime without discovering or modifying system Python. */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PACKAGE_ROOT } from '../paths.ts';

/** Resolve a bundled runtime, including Electron resources outside the ASAR. */
export function resolveRobotPython(
  configured: string,
  packageRoot = PACKAGE_ROOT,
  resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath,
): string {
  if (configured !== 'bundled') return configured;
  const roots = [
    ...(resourcesPath ? [join(resourcesPath, 'astra-runtime')] : []),
    join(packageRoot, 'runtime', 'astra-native'),
  ];
  for (const root of roots) {
    if (!existsSync(join(root, 'manifest.json'))) continue;
    const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8')) as Record<string, unknown>;
    if (manifest.platform !== `${process.platform}-${process.arch}` || manifest.sdkVersion !== '2.0.0')
      throw new Error('The bundled robot runtime does not match this platform or SDK version.');
    const executable = join(root, 'python', ...(process.platform === 'win32' ? ['python.exe'] : ['bin', 'python3']));
    if (!existsSync(executable)) throw new Error('The bundled Python executable is missing.');
    return executable;
  }
  throw new Error('Install the full robot package for this platform, or select a custom Python environment.');
}
