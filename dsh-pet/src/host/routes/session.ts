/**
 * Session jump: Write the intention of "cutting to a certain session" into `sections.focusSession` and consume it by
 * the page itself.
 *
 * The desktop pet runs in an independent rendering process and cannot get the session service in the page. It can only
 * be relayed by the host this time; the write band `ts` is used, and the consumer determines whether the signal has
 * been processed based on this - the page can still be replayed once when it is loaded later than the write. It only
 * verifies input and writes state. It doesn't check whether the session exists (that's a matter of the page), and it
 * doesn't touch any existing leaves.
 * @module dsh-pet/src/host/routes/session
 */
import type { RouteResult } from '../http.ts';
import { failResult, invalidJson, methodNotAllowed, okResult } from './result.ts';
import type { PetRouteDeps, RouteInput } from './types.ts';

/** Upper limit of session id: DSH's id is in the form of `session-<uuid>` (44 characters), 128 is enough, and longer ones are considered forged inputs. */
const MAX_SESSION_ID_CHARS = 128;

/** The sentinel value written into the snapshot when the host has "no session yet" cannot be used as a jump target. */
const UNKNOWN_SESSION_ID = 'unknown';

/**
 * Session field: undefined is returned on a miss, and a response is returned on a hit.
 *
 * @param deps - route dependency; this field read-only `state` .
 * @param input - this request.
 * Respond if @returns hits, otherwise undefined will be handed over to the next processor.
 */
export async function handleSessionRoutes(deps: PetRouteDeps, input: RouteInput): Promise<RouteResult | undefined> {
  // It must be written as a forward comparison: check:openapi only scans the forward branch, and the reverse branch is invisible (do not write that form of literal in the comment).
  const isFocusSession = input.rest === 'focus-session';
  if (!isFocusSession) return undefined;
  if (input.method !== 'POST') return methodNotAllowed();

  let payload: { sessionId?: unknown } | null;
  try {
    payload = JSON.parse(input.body ?? '') as { sessionId?: unknown } | null;
  } catch {
    return invalidJson();
  }

  const sessionId = typeof payload?.sessionId === 'string' ? payload.sessionId.trim() : '';
  if (sessionId === '' || sessionId === UNKNOWN_SESSION_ID) return failResult('bad-request', 'sessionId 必填');
  if (sessionId.length > MAX_SESSION_ID_CHARS) {
    return failResult('bad-request', `sessionId 超过 ${MAX_SESSION_ID_CHARS} 字符`);
  }

  const ts = Date.now();
  deps.state.writeSection('focusSession', { sessionId, ts });
  return okResult({ ok: true, sessionId, ts });
}
