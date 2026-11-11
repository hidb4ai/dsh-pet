/**
 * Pseudo ctx in standalone mode: Let the host side of the plugin run outside of DSH.
 *
 * Responsible for completing the Cordis semantics and downgraded avatars required by apply. The route table is still
 * provided by the plugin host side; the window logic is not implemented, and the HTTP boundary is provided by ./
 * server. This must always be true: stand-ins only fail explicitly, and a single failure of effect does not bring down
 * the entire plugin.
 * @module dsh-pet/src/standalone/context
 */
import type { IncomingMessage, ServerResponse } from 'node:http';

import { createLlmFacade, createOfflineLlm, type StandaloneModelService } from './llm-facade.ts';

/** The unregistered service provider id reported by the balance route in standalone mode. */
export const STANDALONE_PROVIDER = 'standalone';

/** The log interface in standalone mode is consistent with the use of ctx.logger by the plugin. */
export interface StandaloneLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  debug(message: string): void;
}

/** The plugin registers a route to ctx.webServer. */
export interface RegisteredRoute {
  /** prefix or exact, transparent transmission as it is. */
  kind: string;
  /** route path; standalone mode matches against it, no hard-coded prefix. */
  path: string;
  /** True Node HTTP handler, write the response header and body by yourself. */
  handler: (req: IncomingMessage, res: ServerResponse) => unknown;
}

/** Option to create fake ctx. */
export interface StandaloneContextOptions {
  /** Port or port value function, used to configure the desktop Helper configuration address. */
  port: number | (() => number);
  /** Log export. */
  logger: StandaloneLogger;
  /** route collection array; service and apply share the same array. */
  routes?: RegisteredRoute[];
  /** The optional AI service, when missing, the model capability is clearly unavailable. */
  ai?: StandaloneModelService;
  /** A wrapper that appends access credentials to an address. */
  authenticatedUrl?: (baseUrl: string) => string;
  /**
   * Ability to shut down an entire standalone mode process ("Exit" of the Helper system tray on the desktop).
   *
   * Only standalone mode is provided: Desktop mode within DSH does not hang this field, turning off the entire DSH
   * should not be decided by a pet.
   */
  shutdown?: (reason: string) => void;
}

/** Pseudo ctx with its lifecycle. */
export interface StandaloneContext {
  /** Pseudo ctx handed to apply. */
  ctx: Record<string, unknown>;
  /** Route registered during apply, in register order. */
  routes: RegisteredRoute[];
  /** Exceptions recorded during initialization, each item has been logged. */
  failures: string[];
  /** Release all effect: Stop the desktop Helper and clear the period timer. */
  dispose(): Promise<void>;
}

/**
 * webServer substitute: The plugin register route according to the prefix, and server in standalone mode matches the
 * same array.
 *
 * The port is read with getter: the service listens first and the port is determined before apply. The value will be
 * fixed to 0 during construction.
 */
function createWebServer(routes: RegisteredRoute[], portOf: () => number) {
  return {
    get port(): number {
      return portOf();
    },
    register(spec: RegisteredRoute): () => void {
      routes.push({ kind: spec.kind, path: spec.path, handler: spec.handler });
      return () => {
        const index = routes.findIndex((route) => route.handler === spec.handler);
        if (index >= 0) routes.splice(index, 1);
      };
    },
  };
}

/**
 * effect semantics of Cordis: run the register function once and collect the release function it returns. Single
 * failure is only recorded and logged, so that the entire plugin will not be shut down.
 */
function createEffectRunner(
  disposers: Array<() => unknown>,
  failures: string[],
  logger: StandaloneLogger,
): (fn: () => unknown) => unknown {
  return (fn) => {
    try {
      const dispose = fn();
      if (typeof dispose === 'function') disposers.push(dispose as () => unknown);
      return dispose;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(message);
      logger.error(`Initialization step failed and was skipped: ${message}`);
      return undefined;
    }
  };
}

/**
 * provide / get semantics of Cordis: first check the register table, and then fallback to the attributes of the pseudo
 * ctx itself. The standalone mode directly hangs the optional capabilities on the pseudo ctx. Without fallback, the
 * existing capabilities will be judged as non-available.
 */
function createServiceRegistry(services: Map<string, unknown>, attrs: () => Record<string, unknown>) {
  return {
    provide(name: string, value: unknown): () => void {
      services.set(name, value);
      return () => {
        if (services.get(name) === value) services.delete(name);
      };
    },
    get(name: string): unknown {
      const registered = services.get(name);
      if (registered !== undefined) return registered;
      return attrs()[name];
    },
  };
}

/**
 * Creating a pseudo ctx in standalone mode.
 * @param options - Port, logger and optional route collection array.
 * @returns pseudo ctx, route list, initialization failure record and release function.
 */
export function createStandaloneContext(options: StandaloneContextOptions): StandaloneContext {
  const { logger, ai } = options;
  const routes = options.routes ?? [];
  const failures: string[] = [];
  /** effect release function, then register is released first. */
  const disposers: Array<() => unknown> = [];
  /** Service hung out through provide. */
  const services = new Map<string, unknown>();
  let disposed = false;

  const portOf = (): number => (typeof options.port === 'function' ? options.port() : options.port);
  const webServer = createWebServer(routes, portOf);

  const context: Record<string, unknown> = {
    effect: createEffectRunner(disposers, failures, logger),
    ...createServiceRegistry(services, () => context),
    /** There is no DSH session event in standalone mode: no subscribe, and the working status remains idle. */
    on(): () => void {
      return () => {};
    },
    logger,
    webServer,
    connection: { authenticatedUrl: options.authenticatedUrl ?? ((baseUrl: string): string => baseUrl) },
    ...(ai
      ? {
          standaloneAi: {
            isReady: () => ai.isReady(),
            // The balance adopts the standalone mode and its own service provider and key: DSH’s credential store and account services are not present here.
            balanceAuth: () => ai.balanceAuth(),
          },
        }
      : {}),
    // System tray exit ability switch: host route only checks whether this field is present, and the shutdown implementation is provided by cli.ts.
    ...(options.shutdown ? { shutdownApp: options.shutdown } : {}),
    commands: { register: (): (() => void) => () => {} },
    agentDefaultModel: {
      currentSelection: (): { provider: string; model: string } =>
        ai?.currentSelection() ?? { provider: STANDALONE_PROVIDER, model: '' },
    },
    credentials: { resolve: async (): Promise<undefined> => undefined },
    llm: ai ? createLlmFacade(ai) : createOfflineLlm(),
  };

  return {
    ctx: context,
    routes,
    failures,
    async dispose(): Promise<void> {
      if (disposed) return;
      disposed = true;
      ai?.dispose();
      for (const dispose of disposers.splice(0).reverse()) {
        try {
          await dispose();
        } catch (error) {
          logger.warn(`Cleanup step failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    },
  };
}
