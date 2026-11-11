/**
 * Report standalone configuration and Electron resolution without starting the app.
 *
 * Do not start a host, open windows or make network requests that could alter the failure state.
 * Use the same pure modules, configuration and resolution rules as the runtime.
 * Invariant: report observed facts and exit nonzero if bundled defaults are missing.
 * @module dsh-pet/src/standalone/check
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { flattenPetList, readAllConfig } from '../host/config.ts';
import {
  dshHomeDir,
  electronLandingDir,
  hasGraphicalDisplay,
  packageRoot,
  resolveElectronPath,
} from '../host/helper-process.ts';
import type { StandaloneLogger } from './context.ts';
import { configPathsFor, describePets, isDesktopVisible } from './options.ts';

/** Read the package version, or return unknown if unavailable. */
export function packageVersion(root: string): string {
  try {
    const parsed = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version?: unknown };
    return typeof parsed.version === 'string' ? parsed.version : 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Print the diagnostic report.
 * @param logger - Output logger.
 * @returns Exit status: 0 on success, 1 when defaults are missing or configuration cannot be read.
 */
export function runCheck(logger: StandaloneLogger): number {
  const home = dshHomeDir();
  const paths = configPathsFor(packageRoot, home);
  const electron = resolveElectronPath();
  const lines: string[] = [
    `Node            ${process.version}（${process.platform}-${process.arch}）`,
    `Plugin          dsh-pet-powercontext@${packageVersion(packageRoot)}  ${packageRoot}`,
    `DSH_HOME        ${home}`,
    `User config     ${paths.userFile}${existsSync(paths.userFile) ? '' : ' (missing; using bundled defaults)'}`,
    `Pet directory   ${paths.petDir}${existsSync(paths.petDir) ? '' : ' (missing)'}`,
    `Defaults        ${paths.defaultFile}${existsSync(paths.defaultFile) ? '' : '  [missing]'}`,
    `Electron        ${electron ?? `Not found (first launch downloads to ${electronLandingDir()})`}`,
    `Display         ${hasGraphicalDisplay() ? 'available' : 'none (desktop windows skipped; use DSH_PET_DESKTOP_FORCE=1 with remote desktop/Xvfb)'}`,
  ];

  const fail = (message: string): number => {
    // Print the full report before errors so all environment details remain visible.
    for (const line of lines) logger.info(line);
    logger.error(message);
    return 1;
  };

  if (!existsSync(paths.defaultFile)) {
    // Running source directly resolves the package root to src; suggest the built entry.
    return fail(
      'Bundled defaults could not be read. Running source directly may have resolved the package root to src/. ' +
        'Use the built standalone entry: npm run bundle, then node lib/standalone.js or npm run standalone.',
    );
  }

  try {
    const merged = readAllConfig(paths);
    const entries = Object.keys(merged);
    lines.push(`Config entries  ${entries.length}: ${entries.join(', ') || '(empty)'}`);
    for (const entry of entries) {
      // Summarize pets and idle animations per entry to expose empty configurations.
      const conf = merged[entry] ?? {};
      const pets = Array.isArray(conf.pets) ? (conf.pets as Record<string, unknown>[]) : [];
      const animations = conf.animations as { idle?: unknown[] } | undefined;
      const idle = Array.isArray(animations?.idle) ? animations.idle.length : 0;
      lines.push(`  Entry ${entry}: ${pets.length} pets  ${describePets(pets)} | ${idle} idle animations`);
    }
    const desktopVisible = flattenPetList(merged).filter(isDesktopVisible);
    // Only display=desktop or both creates desktop windows.
    lines.push(
      `Desktop pets    ${desktopVisible.length}${
        desktopVisible.length === 0 ? ' (set display to desktop or both to show pets in standalone mode)' : ''
      }`,
    );
    for (const line of lines) logger.info(line);
    logger.info('Configuration and Electron checks passed. Start with npm run standalone.');
    return 0;
  } catch (error) {
    return fail(`Could not read configuration: ${error instanceof Error ? error.message : String(error)}`);
  }
}
