/**
 * Public exit of standalone mode HTTP service: create listener and four built-in routes.
 *
 * Only re-export is done; the response tool is in ./server/respond and the processor is in ./server/handlers. This
 * must always be true: by default, only the loopback address is listened to, and the request body and response body
 * have upper limits.
 * @module dsh-pet/src/standalone/server
 */
export { DEFAULT_STANDALONE_PORT, PORT_SCAN_LIMIT } from './server/options.ts';
export type { StandaloneServer, StandaloneServerOptions } from './server/options.ts';
export { balanceHandler, modelsHandler, settingsHandler, testHandler, setupHandler } from './server/handlers.ts';
export { createRequestListener, listenStandaloneServer } from './server/listener.ts';
