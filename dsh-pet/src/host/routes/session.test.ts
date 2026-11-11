/**
 * Session jump endpoint (`POST /focus-session`): Incoming and outgoing parameter binning and leaf writing.
 *
 * Only the endpoint's own judgment and writing results are tested; how the page consumes this signal is beyond the
 * scope of this document. Running method: node --experimental-strip-types --test src/host/routes/session.test.ts
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { handleSessionRoutes } from './session.ts';
import { PollStateStore } from '../state.ts';
import type { RouteResult } from '../http.ts';
import type { PetRouteDeps } from './types.ts';

/** route only uses state, and other dependencies are not read in this field and are not constructed in the test. */
function makeDeps(): { deps: PetRouteDeps; state: PollStateStore } {
  const state = new PollStateStore();
  return { deps: { state } as unknown as PetRouteDeps, state };
}

/** Adjust the endpoint once; `rest` defaults to clean `focus-session`. */
function call(
  deps: PetRouteDeps,
  method: string,
  body?: string,
  rest = 'focus-session',
): Promise<RouteResult | undefined> {
  return handleSessionRoutes(deps, { url: new URL('http://localhost/focus-session'), rest, method, body });
}

/** The assertion is JSON response and the status code and response body are taken out. */
function asJson(result: RouteResult | undefined): { status: number; obj: Record<string, unknown> } {
  assert.ok(result !== undefined, 'The processor should respond');
  assert.equal(result.kind, 'json');
  return { status: result.status, obj: result.obj as Record<string, unknown> };
}

describe('handleSessionRoutes —— Path and method', () => {
  test('Non-focus-session path → undefined (passed to next processor)', async () => {
    const { deps } = makeDeps();
    assert.equal(await call(deps, 'POST', '{}', 'other'), undefined);
  });

  test('Not POST → 405', async () => {
    const { deps } = makeDeps();
    const { status, obj } = asJson(await call(deps, 'GET'));
    assert.equal(status, 405);
    assert.equal(obj.reason, 'method-not-allowed');
  });
});

describe('handleSessionRoutes ——Input verification', () => {
  test('The request body is not JSON → 400 invalid-json', async () => {
    const { deps } = makeDeps();
    const { status, obj } = asJson(await call(deps, 'POST', 'not json'));
    assert.equal(status, 400);
    assert.equal(obj.reason, 'invalid-json');
  });

  test('Missing sessionId → bad-request, and no leaves are written', async () => {
    const { deps, state } = makeDeps();
    const { status, obj } = asJson(await call(deps, 'POST', '{}'));
    assert.equal(status, 200);
    assert.equal(obj.reason, 'bad-request');
    assert.equal(state.read().sections.focusSession.data, null, 'Verification failure should not leave half a signal');
  });

  test('sessionId is an empty string / pure blank / unknown → bad-request', async () => {
    const { deps } = makeDeps();
    for (const body of ['{"sessionId":""}', '{"sessionId":"   "}', '{"sessionId":"unknown"}']) {
      assert.equal(asJson(await call(deps, 'POST', body)).obj.reason, 'bad-request');
    }
  });

  test('sessionId is not a character string → bad-request', async () => {
    const { deps } = makeDeps();
    assert.equal(asJson(await call(deps, 'POST', '{"sessionId":42}')).obj.reason, 'bad-request');
  });

  test('sessionId exceeds 128 characters → bad-request', async () => {
    const { deps } = makeDeps();
    const body = JSON.stringify({ sessionId: 'x'.repeat(129) });
    assert.equal(asJson(await call(deps, 'POST', body)).obj.reason, 'bad-request');
  });
});

describe('handleSessionRoutes - write sections.focusSession', () => {
  test('Success → 200 ok, and write sessionId and ts into the snapshot', async () => {
    const { deps, state } = makeDeps();
    const { status, obj } = asJson(await call(deps, 'POST', '{"sessionId":"session-abc"}'));
    assert.equal(status, 200);
    assert.equal(obj.ok, true);
    const leaf = state.read().sections.focusSession;
    assert.deepEqual(leaf.data, { sessionId: 'session-abc', ts: obj.ts });
    assert.ok(leaf.counter > 0, 'The write must advance counter, otherwise the page will not get the changes');
  });

  test('The leading and trailing blanks are cut off and then dropped into the library.', async () => {
    const { deps, state } = makeDeps();
    await call(deps, 'POST', '{"sessionId":"  session-abc  "}');
    const data = state.read().sections.focusSession.data as { sessionId: string };
    assert.equal(data.sessionId, 'session-abc');
  });

  test('Two consecutive times → the last time overwrites the previous one, ts does not roll back', async () => {
    const { deps, state } = makeDeps();
    await call(deps, 'POST', '{"sessionId":"session-one"}');
    const first = state.read().sections.focusSession.data as { ts: number };
    await call(deps, 'POST', '{"sessionId":"session-two"}');
    const second = state.read().sections.focusSession.data as { sessionId: string; ts: number };
    assert.equal(second.sessionId, 'session-two');
    assert.ok(second.ts >= first.ts, 'ts is used for consumer judgment and no rollback is allowed.');
  });
});
