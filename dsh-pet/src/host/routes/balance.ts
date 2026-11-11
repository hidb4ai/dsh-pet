/**
 * Balance query entry point: / balance actively refreshes and returns the resolved value snapshot.
 *
 * The number access protocol of each service provider is not implemented (returned to ./balance/providers). The
 * dependency (PetRouteDeps) is passed in explicitly, and the module does not read the global state or build the
 * status.
 * @module dsh-pet/src/host/routes/balance
 */
import type { PetRouteDeps, RouteInput } from './types.ts';
import type { RouteResult } from '../http.ts';
import { methodNotAllowed, okResult } from './result.ts';

/** Balance field: undefined is returned for misses and response is returned for hits. */
export async function handleBalanceRoutes(deps: PetRouteDeps, input: RouteInput): Promise<RouteResult | undefined> {
  const { refreshBalance } = deps;
  const { method, rest } = input;

  // Balance: POST /balance Immediately refresh once and write S, return { ok } - no balance data is returned, the
  // data only has one outlet / state. The front-end no longer checks the balance regularly, and there is no counting
  // polling transfer endpoint.
  if (rest === 'balance') {
    if (method !== 'POST') return methodNotAllowed();
    await refreshBalance(true); // manual: The user actively requests it. When the balance is unavailable, the front end will pop up a text
    // description. ok only means "this refresh action is completed"; whether the balance itself can be used in data of S
    // (ok:false will pop up a text description bubble)
    return okResult({ ok: true });
  }

  return undefined;
}
