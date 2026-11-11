/**
 * Network branch of avatar submission (`postAvatar`): request shape and failed binning.
 *
 * The encoding requires canvas, which is not available in the test environment; therefore, the encoding and submission
 * are separated, and only the injected fetch stand-in is used to test the submission. Running method: node --
 * experimental-strip-types --test src/client/settings/avatar-upload.test.ts
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { postAvatar } from './avatar-upload.ts';
import { ROUTE_PATH } from '../../shared/constants.ts';

/** Minimal response avatar: only ok / status / json are used. */
const response = (body: unknown, status = 200): Response =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response;

/** Logging the fetch alias called. */
function fakeFetch(body: unknown, status = 200): { calls: { url: string; init?: RequestInit }[]; impl: typeof fetch } {
  const calls: { url: string; init?: RequestInit }[] = [];
  const impl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return response(body, status);
  }) as unknown as typeof fetch;
  return { calls, impl };
}

describe('postAvatar', () => {
  test('Success: POST to ? root =, body is base64 JSON', async () => {
    const { calls, impl } = fakeFetch({ ok: true });
    assert.deepEqual(await postAvatar('baimao', 'AAA=', impl), { ok: true });
    assert.equal(calls[0]?.url, ROUTE_PATH + '/pet-avatar?root=baimao');
    assert.equal(calls[0]?.init?.method, 'POST');
    assert.deepEqual(calls[0]?.init?.headers, { 'content-type': 'application/json' });
    assert.equal(calls[0]?.init?.body, JSON.stringify({ base64: 'AAA=' }));
  });

  test('Host business failed → Reply to the copy it gave, don’t edit it yourself', async () => {
    const { impl } = fakeFetch({ ok: false, message: '内置条目不能换头像' });
    assert.deepEqual(await postAvatar('main', 'AAA=', impl), { ok: false, message: '内置条目不能换头像' });
  });

  test('Business failed but no text → a general failure', async () => {
    const { impl } = fakeFetch({ ok: false });
    assert.deepEqual(await postAvatar('cat', 'AAA=', impl), { ok: false, message: '上传失败' });
  });

  test('HTTP is not 2 xx → Failure copy with status code', async () => {
    const { impl } = fakeFetch({}, 413);
    const result = await postAvatar('cat', 'AAA=', impl);
    assert.equal(result.ok, false);
    assert.match(result.ok ? '' : result.message, /413/);
  });

  test('The response is not JSON → Handle as failure, do not throw', async () => {
    const impl = (async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error('not json');
      },
    })) as unknown as typeof fetch;
    assert.equal((await postAvatar('cat', 'AAA=', impl)).ok, false);
  });

  test('The asset root will be encoded first and then entered into the query string.', async () => {
    const { calls, impl } = fakeFetch({ ok: true });
    await postAvatar('小猫 pack', 'AAA=', impl);
    assert.equal(calls[0]?.url, ROUTE_PATH + '/pet-avatar?root=' + encodeURIComponent('小猫 pack'));
  });
});
