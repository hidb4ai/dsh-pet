/**
 * Third-party right-click menu: register item query, click consumption and event long polling.
 *
 * The menu is not rendered and the menu level is not determined (referred to as shared/menu). Dependency
 * (PetRouteDeps) is passed in explicitly, and the module does not read the global state or build the status.
 * @module dsh-pet/src/host/routes/menu
 */
import { MENU_WAIT_MAX_MS } from '../menu.ts';
import type { PetRouteDeps, RouteInput } from './types.ts';
import type { RouteResult } from '../http.ts';
import { failResult, invalidJson, methodNotAllowed, okResult } from './result.ts';

/** Third-party menu field: undefined is returned for misses, and response is returned for hits. */
export async function handleMenuRoutes(deps: PetRouteDeps, input: RouteInput): Promise<RouteResult | undefined> {
  const { menuRegistry, state } = deps;
  const { body, method, rest, url } = input;

  // Third-party right-click menu: POST /menu/item register (owner is fully covered), DELETE is cleared, GET /
  // menu/events is read and consumed (long polling is supported), POST /menu/click is reported by renderer. The
  // register table is in the process memory, and the snapshot is written into sections.menu of S: both ends spell
  // "more" accordingly, and there is no need to restart Helper after registering. Business failure is always 200 + {
  // ok:false , reason , message }; 400 is reserved only for JSON that is broken, and 405 is reserved for method
  // errors.
  if (rest === 'menu/item') {
    if (method === 'DELETE') {
      const result = menuRegistry.clear(url.searchParams.get('owner') ?? '');
      if (!result.ok) return failResult(result.reason, result.message);
      state.writeSection('menu', { items: menuRegistry.snapshot() });
      return okResult({ ok: true, removed: result.removed });
    }
    if (method !== 'POST') return methodNotAllowed();
    let parsed: unknown;
    try {
      parsed = JSON.parse(body ?? '');
    } catch {
      return invalidJson();
    }
    const result = menuRegistry.register(parsed);
    if (!result.ok) return failResult(result.reason, result.message);
    // Writing will wake up all pending long polling; when both ends get the new counter, the menu will be reset (it will take effect the next time you right-click)
    state.writeSection('menu', { items: menuRegistry.snapshot() });
    return okResult({ ok: true });
  }

  if (rest === 'menu/events') {
    if (method !== 'GET') return methodNotAllowed();
    const owner = url.searchParams.get('owner') ?? '';
    const rawWait = Number(url.searchParams.get('wait') ?? '0');
    const waitMs = Number.isFinite(rawWait) && rawWait > 0 ? Math.min(rawWait, MENU_WAIT_MAX_MS) : 0;
    // The caller is disconnected during the waiting period: no additional processing (up to MENU_WAIT_MAX_MS, no status remaining)
    const events = await menuRegistry.poll(owner, waitMs);
    // owner does not exist (has not been registered/cleared/host has been restarted): business failed, still 200
    if (events === null) return failResult('unknown-owner', '这个 owner 没有注册，重新注册即可');
    return okResult({ ok: true, events });
  }

  if (rest === 'menu/click') {
    if (method !== 'POST') return methodNotAllowed();
    let parsed: unknown;
    try {
      parsed = JSON.parse(body ?? '');
    } catch {
      return invalidJson();
    }
    // delivered=false means the item is already gone. This is an expected race with the renderer's previous snapshot, so return HTTP 200.
    return okResult(menuRegistry.click(parsed));
  }

  return undefined;
}
