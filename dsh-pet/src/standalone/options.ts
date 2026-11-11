/**
 * Parse standalone CLI arguments and derive paths without I/O.
 *
 * Convert argv to options and mirror host configuration paths without reading or creating files.
 * The host owns path conventions; tests keep this read-only mirror aligned.
 * Invariant: --check can resolve the same paths as DSH without calling apply.
 * @module dsh-pet/src/standalone/options
 */
import { join } from 'node:path';

import type { ConfigPaths } from '../host/config.ts';
import { DEFAULT_STANDALONE_PORT } from './server.ts';

/** Parsed CLI options. */
export interface CliOptions {
  port: number;
  check: boolean;
  help: boolean;
  setup: boolean;
}

/** CLI help text. */
export const USAGE = `dsh-pet standalone (DSH is not required)

Usage: dsh-pet-powercontext [options]

Options:
  --port <port>  Listen on this port (default ${DEFAULT_STANDALONE_PORT}; try the next port if busy)
  --check        Report configuration, pets and Electron status without opening windows
  --setup        Start the pet and open setup for chat and local long-term memory
  -h, --help     Show this help

Notes:
  Standalone pets use transparent, always-on-top desktop windows. Browser overlays require DSH.
  Configure a provider in the local AI settings to enable chat and whispers. No model requests
  are sent before configuration. Supported balance providers can also be selected there.
  DSH session work states and system notifications require the DSH host.
`;

/**
 * Parse CLI arguments.
 * @param argv - Arguments excluding the Node executable and script path.
 * @returns Options or an error; the caller prints usage and exits with status 2 on failure.
 */
export function parseArgs(argv: string[]): { options: CliOptions } | { error: string } {
  const options: CliOptions = { port: DEFAULT_STANDALONE_PORT, check: false, help: false, setup: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? '';
    if (arg === '--setup') {
      options.setup = true;
    } else if (arg === '--check') {
      options.check = true;
    } else if (arg === '-h' || arg === '--help') {
      options.help = true;
    } else if (arg === '--port' || arg.startsWith('--port=')) {
      const raw = arg === '--port' ? String(argv[index + 1] ?? '') : arg.slice('--port='.length);
      if (arg === '--port') index += 1;
      const value = Number(raw);
      if (!Number.isInteger(value) || value < 1 || value > 65535) {
        return { error: `--port requires an integer from 1 to 65535; received ${JSON.stringify(raw)}` };
      }
      options.port = value;
    } else {
      return { error: `Unknown argument: ${arg}` };
    }
  }
  return { options };
}

/**
 * Derive configuration paths using the same conventions as the host.
 * @param root - Plugin package root.
 * @param home - DSH_HOME。
 * @returns Paths matching host resolution.
 */
export function configPathsFor(root: string, home: string): ConfigPaths {
  const userRoot = join(home, 'dsh-pet');
  return {
    defaultFile: join(root, 'assets', 'config.jsonc'),
    userFile: join(userRoot, 'main-config.jsonc'),
    legacyUserFile: join(userRoot, 'main-config.json'),
    petDir: join(userRoot, 'pet'),
  };
}

/** Format the pet list, retaining each display value for inspection. */
export function describePets(pets: Record<string, unknown>[]): string {
  if (pets.length === 0) return '(no pets: the configured pets array is empty)';
  return pets
    .map((pet) => `${String(pet.id ?? '?')}(size=${String(pet.size ?? '?')}, display=${String(pet.display ?? '?')})`)
    .join('  ');
}

/**
 * Check desktop visibility from display=desktop or both; used for diagnostics only.
 * @param pet - Pet configuration entry.
 * @returns Whether the pet is visible on the desktop.
 */
export function isDesktopVisible(pet: Record<string, unknown>): boolean {
  const display = pet.display;
  return display === 'desktop' || display === 'both';
}
