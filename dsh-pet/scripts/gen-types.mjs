#!/usr/bin/env node
/**
 * Use local tsc to generate the type declaration under lib/types, which is required for the prepack validation check
 * of the release chain.
 *
 * The dts pipeline of tsdown is incompatible with the dual entry point (host/client). The build fails when it is
 * turned on, so the statement is output separately. The directory layout must be consistent with the types path of
 * package.json exports: the host side falls on lib/types/index.d.ts and the browser side falls on
 * lib/types/client/index.d.ts. Only declarations are generated, JS is not built, and type checking is not performed
 * (typecheck is another chain).
 * @module dsh-pet/scripts/gen-types
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const TYPES = join(ROOT, 'lib', 'types');
const HOST_OUT = join(TYPES, 'host');

rmSync(TYPES, { recursive: true, force: true });
mkdirSync(TYPES, { recursive: true });

// Directly call tsc in this warehouse without going through npm/npx: there is only pnpm or pure node in the
// environment without npx, so there is no need to reserve additional cmd / c branches for Windows. Analyze
// createRequire: Under the isolation layout of pnpm, typescript is only chained once in node_modules, and
// require.resolve is more reliable than the manual path.
const require = createRequire(import.meta.url);
const tscEntry = require.resolve('typescript/lib/tsc.js');
const tsc = spawnSync(process.execPath, [tscEntry, '-p', 'tsconfig.types.json'], {
  cwd: ROOT,
  stdio: 'inherit',
});
if (tsc.status !== 0) {
  console.error(`[gen-types] Declaration generation failed (exit ${tsc.status})`);
  process.exit(tsc.status ?? 1);
}

// The host side declaration is moved up to the lib/types/root ( lib/types/index.d.ts ), and the client subtree remains unchanged.
if (existsSync(HOST_OUT)) {
  for (const name of readdirSync(HOST_OUT)) {
    renameSync(join(HOST_OUT, name), join(TYPES, name));
  }
  rmSync(HOST_OUT, { recursive: true, force: true });
}

console.log('[gen-types] Generated lib/types declarations');
