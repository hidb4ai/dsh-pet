/**
 * Route assembly: Collect the assembly period object PetRouteDeps, connect it to the field route, and hang the
 * processing function to webServer.
 *
 * The route layer only recognizes this deps table and does not recognize the closure of apply; the asset path and
 * protocol details belong to ../http.ts. It must always be true: the HTTP prefix route consumes the same
 * handlePetRoute as the desktop Helper pipe (the behavior of both ends is strictly consistent).
 * @module dsh-pet/src/host/plugin/http-route
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { ROUTE_SEGMENT } from '../../shared/constants.ts';
import { readBody, sendFile, sendJson, sendText, type RouteResult } from '../http.ts';
import { failureBody } from '../routes/result.ts';
import { createPetRouter } from '../routes/index.ts';
import type { PetRouteDeps } from '../routes/types.ts';
import type { HostContext } from './context.ts';
import type { MemoryConfigStore } from './memory-binding.ts';

/** The processing function of a single business request: URL has been parsed and the method has been normalized. */
export type HttpRouteHandler = (
  url: string,
  method: string,
  body?: string,
  signal?: AbortSignal,
) => Promise<RouteResult>;

/**
 * The HTTP processing function is constructed from the dependency table.
 * @param deps - route layer dependency (store, path, action function).
 * @returns is distributed to the processing function of the domain route by prefix.
 */
export function createHttpRoute(deps: PetRouteDeps): {
  handlePetRoute: HttpRouteHandler;
  memoryConfig: MemoryConfigStore;
} {
  // Configuration request covers complete read and write: the next update must read the configuration after the
  // previous completion. GET /config are also queued to avoid reading an empty file when writing is not completed and
  // falling back to the built-in default.
  let configQueue: Promise<void> = Promise.resolve();

  /**
   * Single business route (HTTP persist to disk shares the same implementation as the desktop Helper pipeline): input
   * rawUrl + method + body text, return RouteResult, each consumer persists to disk - there is only one copy of the
   * business logic, and both ends are naturally consistent. signal Optional: Abort the pending wait when the caller is
   * disconnected (only the wait branch of / playback will be used; the pipeline side will not be transmitted).
   */
  const handlePetRoute = async (
    rawUrl: string,
    method: string,
    body?: string,
    signal?: AbortSignal,
  ): Promise<RouteResult> => {
    const url = new URL(rawUrl, 'http://localhost');
    const rest = decodeURIComponent(url.pathname.slice(ROUTE_SEGMENT.length + 1));
    const run = (): Promise<RouteResult> => dispatchPetRoute(url, rest, method, body, signal);
    // The three paths for writing configuration (PUT/POST /config, POST /pet-display, POST /pet-config) are all
    // "read current configuration → whitelist and rebuild the entire pets → write disk". The concurrency interleaving
    // will cover each other and must share a serial queue; GET /config is also queued to avoid reading an empty file
    // when writing is not completed and falling back to the built-in default.
    const isConfigQueue = rest === 'config' || ((rest === 'pet-display' || rest === 'pet-config') && method === 'POST');
    if (isConfigQueue) {
      const pending = configQueue.then(run, run);
      configQueue = pending.then(
        () => undefined,
        () => undefined,
      );
      return pending;
    }
    return run();
  };

  // route layer dependency table: explicit parameter passing replaces closure capture, so modules in each field can evolve independently (see ./routes/index.ts )
  const dispatchPetRoute = createPetRouter(deps);

  const configUrl = new URL(ROUTE_SEGMENT + '/config', 'http://localhost');
  const mainOf = (result: RouteResult): Record<string, unknown> => {
    if (result.kind !== 'json') throw new Error('pet_settings_failed');
    const body = result.obj as { ok?: boolean; main?: Record<string, unknown> };
    if (result.status !== 200 || body.ok === false || !body.main) throw new Error('pet_settings_failed');
    return body.main;
  };
  return {
    handlePetRoute,
    memoryConfig: {
      read: async () => mainOf(await handlePetRoute(configUrl.pathname, 'GET')),
      update(change) {
        const pending = configQueue.then(async () => {
          const main = mainOf(await dispatchPetRoute(configUrl, 'config', 'GET'));
          const patch = change(main);
          if (patch)
            mainOf(await dispatchPetRoute(configUrl, 'config', 'PUT', JSON.stringify({ ...patch, pets: main.pets })));
        });
        configQueue = pending.catch(() => {});
        return pending;
      },
    },
  };
}

/**
 * Hang the prefix route to host webServer and automatically remove it with the plugin unmount.
 * @param ctx - host context.
 * @param handlePetRoute - business processing function (the same one as desktop Helper pipeline reuse).
 */
export function registerHttpRoute(ctx: HostContext, handlePetRoute: HttpRouteHandler): void {
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: ROUTE_SEGMENT,
        handler: async (req: IncomingMessage, res: ServerResponse) => {
          let pathname: string;
          try {
            pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
          } catch {
            sendJson(res, 400, failureBody('bad-request', 'invalid request path'));
            return;
          }
          // The management entry point only accepts JSON; cross-site forms cannot trigger downloads, model calls, or process start and stop.
          if (
            req.method === 'POST' &&
            [ROUTE_SEGMENT + '/powercontext/setup', ROUTE_SEGMENT + '/robot'].includes(pathname)
          ) {
            if (
              req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json' ||
              req.headers['sec-fetch-site'] === 'cross-site'
            ) {
              sendJson(res, 415, failureBody('bad-request', 'application/json required'));
              return;
            }
          }
          // During suspended waiting (/ playback ? wait =), the caller may be disconnected early: the waiting is
          // terminated accordingly, otherwise the waiter will remain until timeout before recycling. 'close' will also
          // be triggered after normal response, but the monitoring has been removed at that time.
          const abort = new AbortController();
          const onClose = (): void => abort.abort();
          res.on('close', onClose);
          try {
            // PATCH also carries the body (pending partial update); GET / DELETE is not read to avoid waiting needlessly for an end event that will never come.
            const readsBody = req.method === 'PUT' || req.method === 'POST' || req.method === 'PATCH';
            const body = readsBody ? await readBody(req) : undefined;
            const result = await handlePetRoute(req.url ?? '/', req.method ?? 'GET', body, abort.signal);
            res.off('close', onClose);
            if (result.kind === 'json') sendJson(res, result.status, result.obj, result.headers);
            else if (result.kind === 'text') sendText(res, result.status, result.body);
            else if (result.kind === 'none') {
              /* caller has been disconnected: no longer written (will be thrown if written) */
            } else sendFile(req, res, result.file, result.contentType); // non-async: stream in open after itself pipe, error inside centralize
          } catch (e) {
            res.off('close', onClose);
            // The connection has been disconnected (it may also happen after the pending wait is aborted) → no more writing to avoid throwing errors again.
            if (!res.destroyed && !res.writableEnded) {
              // The request body exceeds the limit and the client is interrupted. This is a user-side problem and cannot be reported as 500; even the response cannot be written when the connection is disconnected.
              const code = (e as { code?: string }).code;
              if (code === 'body-too-large')
                sendJson(res, 413, failureBody('payload-too-large', 'request body too large'));
              else if (code !== 'client-aborted') {
                // Unexpected exception: only the true cause is entered in the log, and only the classified copy is returned in the response (may include absolute path, not leaked)
                ctx.logger?.warn?.(`[dsh-pet] route failed: ${e instanceof Error ? e.message : String(e)}`);
                sendJson(res, 500, failureBody('internal-error', 'dsh-pet: internal error'));
              }
            }
          }
        },
      }),
    `dsh-pet: ${ROUTE_SEGMENT} asset route`,
  );
}
