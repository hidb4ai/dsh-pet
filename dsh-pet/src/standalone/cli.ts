#!/usr/bin/env node
/**
 * Standalone entry: run a local pet without starting DSH.
 *
 * Wire the shim context, local HTTP server and desktop helper; manage shutdown and exit status.
 * Reuse plugin and host implementations for routes, configuration and windows.
 * Invariant: listen before apply; every exit path shares the same cleanup.
 * @module dsh-pet/src/standalone/cli
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { flattenPetList, readAllConfig } from '../host/config.ts';
import { dshHomeDir, packageRoot } from '../host/helper-process.ts';
import { apply } from '../host/index.ts';
import { defaultLog, setDefaultLogger } from '../host/log-file.ts';
import { runCheck, packageVersion } from './check.ts';
import { createStandaloneAi } from './ai-provider.ts';
import { createRequestSecurity } from './request-security.ts';
import { writeStandaloneRuntime } from './runtime-state.ts';
import { createStandaloneContext, type RegisteredRoute, type StandaloneLogger } from './context.ts';
import { createStandaloneLogger } from './logger.ts';
import { configPathsFor, describePets, isDesktopVisible, parseArgs, USAGE } from './options.ts';
import { listenStandaloneServer } from './server.ts';
import { ROUTE_SEGMENT } from '../shared/constants.ts';
import { createSetup, setupMemoryBinding } from './setup.ts';
import { openSetup } from './open-setup.ts';

/** Start the server and resolve its port before applying the plugin. */
async function run(logger: StandaloneLogger, options: { port: number; setup: boolean }): Promise<void> {
  const home = dshHomeDir();
  const paths = configPathsFor(packageRoot, home);

  // Fail early with an actionable message when missing defaults would break every host request.
  if (!existsSync(paths.defaultFile)) {
    logger.error(
      `Bundled defaults are missing: ${paths.defaultFile}. If running source directly resolves the root to src/, ` +
        'use the built entry: npm run bundle, then node lib/standalone.js (or npm run standalone).',
    );
    process.exitCode = 1;
    return;
  }

  const routes: RegisteredRoute[] = [];
  // The server needs a /shutdown callback before the cleanup function can capture it.
  // Use a replaceable forwarder until the cleanup implementation is available.
  let forwardShutdown: (reason: string) => void = () => {};
  const portRef = { value: options.port };
  const ai = createStandaloneAi(home, logger);
  const security = createRequestSecurity();
  const setup = createSetup(
    home,
    ai,
    setupMemoryBinding(() => `http://127.0.0.1:${portRef.value}`, security.token),
  );
  const context = createStandaloneContext({
    port: () => portRef.value,
    logger,
    routes,
    ai,
    authenticatedUrl: security.authenticatedUrl,
    // Tray quit and POST /shutdown share the same cleanup path.
    shutdown: (reason) => forwardShutdown(reason),
  });
  // Define cleanup after the server, as described above forwardShutdown.
  const server = await listenStandaloneServer({
    routes,
    logger,
    port: options.port,
    security,
    ai,
    setup,
    status: () => ({
      name: 'dsh-pet-standalone',
      pid: process.pid,
      pluginRoot: packageRoot,
      plugin: { root: packageRoot, version: packageVersion(packageRoot) },
      port: portRef.value,
      uptimeSec: Math.round(process.uptime()),
    }),
    onShutdown: () => forwardShutdown('POST /shutdown'),
  });
  portRef.value = server.port;
  let releaseRuntime: () => void;
  try {
    releaseRuntime = writeStandaloneRuntime(home, {
      port: server.port,
      token: security.token,
      settingsUrl: security.authenticatedUrl(`http://127.0.0.1:${server.port}`),
      pluginRoot: packageRoot,
    });
  } catch (error) {
    await context.dispose();
    await server.close();
    throw error;
  }

  let shuttingDown = false;
  const shutdown = async (reason: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`Shutting down (${reason})...`);
    // Dispose plugin effects (helper and timers) before closing the server.
    try {
      await setup.dispose();
      await context.dispose();
    } finally {
      await server.close();
      releaseRuntime();
    }
    logger.info('Shutdown complete.');
  };
  const requestShutdown = (reason: string): void => {
    shutdown(reason)
      .then(() => process.exit(0))
      .catch((error: unknown) => {
        logger.error(`Shutdown failed: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      });
  };
  forwardShutdown = (reason) => requestShutdown(reason);
  process.on('SIGINT', () => requestShutdown('SIGINT'));
  process.on('SIGTERM', () => requestShutdown('SIGTERM'));

  // Register routes, the state store and the desktop helper bridge.
  apply(context.ctx);
  setup.resume();
  if (options.setup || !ai.isReady()) openSetup(security.authenticatedUrl(`http://127.0.0.1:${server.port}`));

  let pets: Record<string, unknown>[] = [];
  let configSource = paths.userFile;
  try {
    pets = flattenPetList(readAllConfig(paths));
    if (!existsSync(paths.userFile)) configSource = `${paths.userFile} (missing; using bundled defaults)`;
  } catch (error) {
    logger.warn(
      `Configuration read failed (server remains available; affected routes report errors): ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const desktopVisible = pets.filter(isDesktopVisible);
  for (const line of [
    '',
    '===== dsh-pet standalone (DSH not required) =====',
    `  Plugin      dsh-pet-powercontext@${packageVersion(packageRoot)}  ${packageRoot}`,
    `  Route       http://127.0.0.1:${server.port}${ROUTE_SEGMENT}/`,
    `  Config      ${configSource}`,
    `  Pets        ${describePets(pets)}`,
    desktopVisible.length === 0
      ? '  Desktop     0 pets: set display to desktop or both to show windows (server remains active)'
      : `  Desktop     ${desktopVisible.length} pets`,
    ai.isReady()
      ? '  AI          Local API enabled; automatic whispers follow the settings toggle'
      : '  AI          Not configured or disabled; no model requests. Open AI settings from the context menu',
    ai.getSettings().balanceProvider
      ? `  Balance     Provider: ${ai.getSettings().balanceProvider}; use Check balance in settings`
      : '  Balance     Select a balance provider in AI settings',
    '  Unavailable DSH session work states / system notifications',
    '  Exit        Ctrl+C, POST /shutdown or Quit in the system tray menu',
    '',
  ]) {
    logger.info(line);
  }
  if (context.failures.length > 0) {
    logger.warn(
      `${context.failures.length} initialization steps failed (see logs); routes remain available and affected endpoints report errors`,
    );
  }
}

/** Run the CLI and return its exit status. */
async function main(): Promise<number> {
  const parsed = parseArgs(process.argv.slice(2));
  if ('error' in parsed) {
    console.error(`dsh-pet-standalone: ${parsed.error}\n`);
    console.error(USAGE);
    return 2;
  }
  const { options } = parsed;
  if (options.help) {
    console.log(USAGE);
    return 0;
  }
  // Standalone often runs without a terminal; persist logs and share the logger with the plugin.
  const logger = createStandaloneLogger({ file: join(dshHomeDir(), 'dsh-pet', 'logs.txt') });
  // Pure modules use the default log sink because they have no ctx.logger.
  setDefaultLogger(logger);
  if (options.check) return runCheck(logger);
  await run(logger, options);
  return 0;
}

// This is the bin executable entry, so start unconditionally.
// import.meta.main requires Node 24+; argv[1] comparisons fail for pnpm bin symlinks.
main()
  .then((code) => {
    if (code !== 0) process.exit(code);
  })
  .catch((error: unknown) => {
    defaultLog(
      'error',
      `dsh-pet-standalone: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
    );
    process.exit(1);
  });
