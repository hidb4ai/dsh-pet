/**
 * Desktop lifecycle: / reload re-parses the configuration and restarts Helper, / quit closes the host application.
 *
 * It is not responsible for the reactivation and restart of the Helper process itself (owned by ./helper-process).
 * Dependency (PetRouteDeps) is passed in explicitly, and the module does not read global information or create status.
 * @module dsh-pet/src/host/routes/desktop
 */
import type { PetRouteDeps, RouteInput } from './types.ts';
import type { RouteResult } from '../http.ts';
import { failResult, methodNotAllowed, okResult } from './result.ts';

/** Desktop lifecycle field: undefined is returned for misses and response is returned for hits. */
export async function handleDesktopRoutes(deps: PetRouteDeps, input: RouteInput): Promise<RouteResult | undefined> {
  const { log, optionalService, requestRestart } = deps;
  const { method, rest } = input;

  // Desktop "Reload Configuration" (right-click menu → POST /reload): Restart desktop Helper, and all windows will be
  // rebuilt according to the latest configuration. Using the same restart path as saving (requestRestart), changes in
  // the number of pets / display / size will also take effect - renderer in-place re-pull cannot do these things. The
  // initiator is helper, which is about to be restarted, so instead of await, 200 will be returned immediately.
  if (rest === 'reload') {
    if (method !== 'POST') return methodNotAllowed();
    void requestRestart();
    return okResult({ reloading: true });
  }

  // system tray "exit" (system tray menu → GET detection capability/POST execution, issue #178). You cannot let helper
  // itself app.quit(): In BRIDGE mode, it is pulled up by the host. Exiting will be treated as a crash and restarted
  // with exponential backoff. If you click it, it will only flash for a while, but the process is still there; the
  // host must execute "stop Helper + shut down the service + exit". This capability is only provided in standalone
  // mode, DSH within canQuit:false.
  if (rest === 'quit') {
    // The capability is soft-fetched upon request: DSH host does not have this service (the naked read attribute will
    // be thrown, see the description of optionalService), so it gets undefined → canQuit:false, and the exit menu item
    // does not appear; the standalone mode fetch → menu is available.
    const quit = optionalService('shutdownApp');
    const canQuit = typeof quit === 'function';
    if (method === 'GET') return okResult({ canQuit });
    if (method !== 'POST') return methodNotAllowed();
    // Failure by action endpoint conventions returns 200+ structured result (consistent with /pet-display): Exit not supported not a protocol layer error.
    if (!canQuit) {
      return failResult('unsupported', '宿主未提供退出能力（DSH 内请关闭桌面模式）');
    }
    // Not await: cleanup will first stop the Helper that initiated the request, and the response is not guaranteed to
    // be delivered (the same situation as / reload). Push it to the next tick and then execute it, so that 200 is
    // written out first.
    setImmediate(() => {
      try {
        (quit as (reason: string) => void)('托盘退出');
      } catch (e: unknown) {
        log.warn(`[dsh-pet] Tray quit failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    });
    return okResult({ ok: true });
  }

  return undefined;
}
