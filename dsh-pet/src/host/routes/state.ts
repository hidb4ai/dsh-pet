/**
 * Polling side data: / models model directory, / state global snapshot (supports since/timeout long polling), /
 * work-status working status writing.
 *
 * No status is generated, only the current values in store are summarized. Dependency (PetRouteDeps) is passed in
 * explicitly, and the module does not read global information or create status.
 * @module dsh-pet/src/host/routes/state
 */
import { parseStateWaitQuery } from '../state.ts';
import { type RouteResult } from '../http.ts';
import { HOST_WORK_STATUS_STATES, TASK_TEXT_MAX, type HostWorkStatusState } from '../work-status.ts';
import type { PetRouteDeps, RouteInput } from './types.ts';
import { failResult, invalidJson, methodNotAllowed, okResult, payloadTooLarge } from './result.ts';

/** Polling status field: undefined is returned for misses and response is returned for hits. */
export async function handleStateRoutes(deps: PetRouteDeps, input: RouteInput): Promise<RouteResult | undefined> {
  const { EXTERNAL_WORK_SESSION, ctx, nextExternalWorkSeq, publishWorkStatus, state, workStatus } = deps;
  const { body, method, rest, signal, url } = input;

  // Optional model list (data source of the "AI Model" drop-down box on the settings page): It has the same origin as
  // the DSH model selector, and both come from the host llm service. read-only, no side effect; if a certain service
  // provider fails to list the model (the adapter does not support /network), it will just leave it empty without
  // dragging down the entire list. When a real-time route is not registered, fallback to listConfigurableProviders to
  // prevent the drop-down box from being empty.
  if (rest === 'models') {
    if (method !== 'GET') return methodNotAllowed();
    try {
      const llm = ctx.llm as
        | {
            listProviders?: () => Array<{ id?: unknown; name?: unknown }>;
            listConfigurableProviders?: () => Array<{ provider?: unknown; displayName?: unknown }>;
            listModels?: (provider: string) => Promise<Array<{ id?: unknown; name?: unknown }>>;
          }
        | undefined;
      const named = (id: unknown, name: unknown): { id: string; name: string } => {
        const pid = String(id ?? '');
        return { id: pid, name: String(name ?? '') || pid };
      };
      let providers = (typeof llm?.listProviders === 'function' ? llm.listProviders() : []).map((p) =>
        named(p?.id, p?.name),
      );
      if (providers.length === 0 && typeof llm?.listConfigurableProviders === 'function') {
        providers = llm.listConfigurableProviders().map((p) => named(p?.provider, p?.displayName));
      }
      providers = providers.filter((p) => p.id);
      const catalog = await Promise.all(
        providers.map(async (p) => {
          let models: Array<{ id: string; name: string }> = [];
          try {
            const list = await llm?.listModels?.(p.id);
            models = (Array.isArray(list) ? list : []).map((m) => named(m?.id, m?.name)).filter((m) => m.id);
          } catch {
            /* A single service provider cannot list the model: just leave it blank (the service provider only has "Follow the current conversation" option in the drop-down box) */
          }
          return { ...p, models };
        }),
      );
      return okResult({ providers: catalog });
    } catch (e) {
      // The model directory cannot be retrieved because the dependency is unavailable (the host does not provide the llm adapter/all column models failed), and it is not a transport layer failure.
      return failResult('generate-error', e instanceof Error ? e.message : String(e));
    }
  }

  // Polling status (/ state, GET, no-cache) is the only data source for front-end polling: read-only, pure memory,
  // zero side effect - triggering external calls or model generation here will drag everyone's polling to death; it
  // does not touch the disk (configuration change signal goes to sections.config).
  //
  // Long polling: With `?since=&timeout=` (required in pairs), if the version is the same as the current one, it will
  // be suspended until any leaf is written or times out; without =, the full amount will be returned immediately. The
  // wait semantics are the same as wait of GET /playback /{ id } (the upper limit is the same and the disconnection
  // is the same signal).
  if (rest === 'state') {
    if (method !== 'GET') return methodNotAllowed();
    const headers = { 'cache-control': 'no-cache, no-store' };
    const parsed = parseStateWaitQuery(url.searchParams.get('since'), url.searchParams.get('timeout'));
    // since/timeout is a business parameter: if it is wrong, it is a problem with the caller, but it is still "the request has entered the processor"
    if (parsed.kind === 'error') return failResult('bad-request', parsed.error);
    const current = state.read();
    // Neither is transmitted → return immediately; there is already something new → return immediately (don’t wait a
    // whole timeout in vain).
    // timeout =0 takes the hanging branch and wakes up at the next tick, which is equivalent to "return immediately".
    // There is no special judgment here.
    if (parsed.kind === 'none' || current.counter !== parsed.since) {
      return okResult(current, headers);
    }
    const since = parsed.since;
    return await new Promise<RouteResult>((resolveWait) => {
      let settled = false;
      /** cleanup: only recognizes the first time (wakeup/timeout/cancel/caller disconnection may all arrive one after another) */
      const settle = (result: RouteResult): void => {
        if (settled) return;
        settled = true;
        resolveWait(result);
      };
      // read() when waking up: store ensures that "the leaves have been written" before waking up, so what you get here must be the new state.
      const cancel = state.wait({
        since,
        timeoutMs: parsed.timeoutMs,
        onWake: () => settle(okResult(state.read(), headers)),
      });
      // caller disconnected: cancel the waiter (clear its timeout timer) to "no response" cleanup.
      const onAbort = (): void => {
        cancel();
        settle({ kind: 'none' });
      };
      if (signal?.aborted) {
        onAbort();
        return;
      }
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  // External write working status: POST sets the state of the fixed external slot `api` (task omitted = reserved, null
  // = clear), DELETE clear returns to idle (idempotent). It only solves "the external program tells the desktop pet
  // the status" and does not do multi-writer arbitration/lease/session management; the external slot participates in
  // the existing priority together with the session (waiting > error > working > thinking > result > success).
  if (rest === 'work-status') {
    if (method === 'DELETE') {
      if (workStatus.clear(EXTERNAL_WORK_SESSION)) publishWorkStatus();
      return { kind: 'text', status: 204, body: '' };
    }
    if (method !== 'POST') return methodNotAllowed();
    if (Buffer.byteLength(body ?? '', 'utf8') > 8 * 1024) return payloadTooLarge('body too large');
    let parsed: unknown;
    try {
      parsed = JSON.parse(body ?? '');
    } catch {
      return invalidJson();
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return invalidJson();
    const payload = parsed as { state?: unknown; task?: unknown };
    const state = payload.state;
    if (typeof state !== 'string' || !(HOST_WORK_STATUS_STATES as readonly string[]).includes(state))
      return failResult('bad-request', `state 必须是 ${HOST_WORK_STATUS_STATES.join(' / ')} 之一`);
    let task: string | null | undefined;
    if (Object.prototype.hasOwnProperty.call(payload, 'task')) {
      if (payload.task === null) {
        task = null;
      } else if (typeof payload.task === 'string') {
        const trimmed = payload.task.trim();
        if (trimmed === '') {
          task = null;
        } else if (Array.from(trimmed).length > TASK_TEXT_MAX) {
          return failResult('bad-request', `task too long (max ${TASK_TEXT_MAX} code points)`);
        } else {
          task = trimmed;
        }
      } else {
        return failResult('bad-request', 'invalid task');
      }
    }
    workStatus.setState(EXTERNAL_WORK_SESSION, state as HostWorkStatusState, nextExternalWorkSeq());
    if (task !== undefined) workStatus.setTask(EXTERNAL_WORK_SESSION, task);
    publishWorkStatus();
    return okResult({
      state: workStatus.stateOf(EXTERNAL_WORK_SESSION) ?? state,
      task: workStatus.taskOf(EXTERNAL_WORK_SESSION),
    });
  }

  return undefined;
}
