/**
 * The port and option shapes of independent services: default port, scanning upper limit and external capabilities.
 *
 * Pure types and constants, no implementation. Must always hold: Default port changes synchronize the CLI help text
 * with CONFIG.md.
 * @module dsh-pet/src/standalone/server/options
 */
import { type RegisteredRoute, type StandaloneLogger } from '../context.ts';
import { type RequestSecurity } from '../request-security.ts';
import { type StandaloneSettingsService } from '../settings.ts';
import type { SetupService } from '../setup.ts';

/** Default listening port. */
export const DEFAULT_STANDALONE_PORT = 3080;

/** The maximum number of backward delays when the port is occupied. */
export const PORT_SCAN_LIMIT = 25;

/** Startup options. */
export interface StandaloneServerOptions {
  /** Plugin register route. */
  routes: RegisteredRoute[];
  /** Log export. */
  logger: StandaloneLogger;
  /** Preferred port. */
  port?: number;
  /** Status returned by health check. */
  status?: () => unknown;
  /** Shutdown callback. */
  onShutdown?: () => void;
  /** Access the verification facade. */
  security?: RequestSecurity;
  /** Set up services. */
  ai?: StandaloneSettingsService;
  /** First-run installation and managed local memory. */
  setup?: SetupService;
  /** The text reading time limit is only covered by the timeout test. */
  bodyTimeoutMs?: number;
}

/** Service started. */
export interface StandaloneServer {
  /** Actual listening port. */
  port: number;
  /** Access verification facade for this run. */
  security: RequestSecurity;
  /** Turn off listening and disconnect in-flight connections. */
  close(): Promise<void>;
}
