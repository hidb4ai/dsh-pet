import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_AI_SETTINGS, type StandaloneAiSettings } from '../ai-config.ts';
import type { AiFetch } from '../ai-transport.ts';
import { discoverModels } from './list-models.ts';

const settings: StandaloneAiSettings = {
  ...DEFAULT_AI_SETTINGS,
  baseUrl: 'https://api.example.test/v1',
  model: 'saved-model',
  apiKey: 'saved-key',
};

/** False fetch for logging requests and scripting playback of responses. */
function recorder(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  const fetchImpl = (async (input: string, init?: RequestInit) => {
    calls.push({ url: String(input), headers: (init?.headers ?? {}) as Record<string, string> });
    return handler(String(input), init);
  }) as unknown as AiFetch;
  return { calls, fetchImpl };
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('OpenAI compatible endpoints: data array is normalized to id with name → preserving endpoint order', async () => {
  const { calls, fetchImpl } = recorder(() =>
    json({ data: [{ id: 'deepseek-chat', name: 'DeepSeek Chat' }, { id: 'bare' }] }),
  );
  const result = await discoverModels(fetchImpl, settings, {});
  assert.deepEqual(result, {
    ok: true,
    models: [
      { id: 'deepseek-chat', name: 'DeepSeek Chat', kind: 'generation' },
      { id: 'bare', name: 'bare' },
    ],
  });
  assert.equal(calls[0].url, 'https://api.example.test/v1/models');
  assert.equal(calls[0].headers.authorization, 'Bearer saved-key');
});

test("Compatible with the gateway's models mapping and Anthropic's display_name → both writing methods can read the name", async () => {
  const mapped = recorder(() => json({ models: { a: { id: 'a', name: 'A' }, b: { id: 'b', name: 'B' } } }));
  assert.deepEqual(await discoverModels(mapped.fetchImpl, settings, {}), {
    ok: true,
    models: [
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' },
    ],
  });
  const named = recorder(() => json({ data: [{ id: 'claude-x', display_name: 'Claude X' }] }));
  assert.deepEqual(
    await discoverModels(named.fetchImpl, settings, { protocol: 'anthropic', apiKey: 'anthropic-key' }),
    {
      ok: true,
      models: [{ id: 'claude-x', name: 'Claude X', kind: 'generation' }],
    },
  );
});

test('Anthropic protocol: Request the manifest address with version number and x-api-key, do not send Bearer', async () => {
  const { calls, fetchImpl } = recorder(() => json({ data: [{ id: 'claude-3' }] }));
  await discoverModels(fetchImpl, settings, {
    protocol: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    apiKey: 'draft-key',
  });
  assert.equal(calls[0].url, 'https://api.anthropic.com/v1/models?limit=1000');
  assert.equal(calls[0].headers['x-api-key'], 'draft-key');
  assert.equal(calls[0].headers['anthropic-version'], '2023-06-01');
  assert.equal(calls[0].headers.authorization, undefined);
});

test('Address omitted / v1: Request as is first, then change the address with version number after 404', async () => {
  const { calls, fetchImpl } = recorder((url) =>
    url.endsWith('/v1/models') ? json({ data: [{ id: 'found' }] }) : json({ error: 'nope' }, 404),
  );
  const result = await discoverModels(fetchImpl, settings, {
    baseUrl: 'https://api.example.test',
    apiKey: 'explicit-key',
  });
  assert.deepEqual(result, { ok: true, models: [{ id: 'found', name: 'found' }] });
  assert.deepEqual(
    calls.map((call) => call.url),
    ['https://api.example.test/models', 'https://api.example.test/v1/models'],
  );
});

test('Authentication failed: 401 → code is auth, the text does not echo the response text', async () => {
  const { fetchImpl } = recorder(() => json({ error: 'invalid key sk-should-not-leak' }, 401));
  const result = await discoverModels(fetchImpl, settings, {});
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, 'auth');
  assert.doesNotMatch(result.message, /sk-should-not-leak/);
});

test('The response is not a model list: code is contract, and no second request is made', async () => {
  const { calls, fetchImpl } = recorder(() => json({ hello: 'world' }));
  const result = await discoverModels(fetchImpl, settings, {});
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, 'contract');
  assert.equal(calls.length, 1);
});

test('Response is not JSON: code is contract', async () => {
  const { fetchImpl } = recorder(() => new Response('<html>gateway</html>', { status: 200 }));
  const result = await discoverModels(fetchImpl, settings, {});
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, 'contract');
});

test('Missing address or key: do not send a request, directly reply code input', async () => {
  const { calls, fetchImpl } = recorder(() => json({ data: [] }));
  const blank = { ...settings, baseUrl: '', apiKey: '' };
  const noBase = await discoverModels(fetchImpl, blank, {});
  assert.equal(noBase.ok, false);
  if (!noBase.ok) assert.equal(noBase.code, 'input');
  const noKey = await discoverModels(fetchImpl, blank, { baseUrl: 'https://api.example.test/v1' });
  assert.equal(noKey.ok, false);
  if (!noKey.ok) assert.equal(noKey.code, 'input');
  assert.equal(calls.length, 0);
});

test('Addresses with account numbers or query parameters are rejected', async () => {
  const { calls, fetchImpl } = recorder(() => json({ data: [] }));
  for (const baseUrl of ['https://user:pass@api.example.test/v1', 'https://api.example.test/v1?x=1']) {
    const result = await discoverModels(fetchImpl, settings, { baseUrl });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, 'input');
  }
  assert.equal(calls.length, 0);
});

test('Network failure: code is network', async () => {
  const { fetchImpl } = recorder(() => {
    throw new TypeError('fetch failed');
  });
  const result = await discoverModels(fetchImpl, settings, {});
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, 'network');
});

test('Draft default: use the saved address and key', async () => {
  const { calls, fetchImpl } = recorder(() => json({ data: [{ id: 'saved' }] }));
  await discoverModels(fetchImpl, settings, { protocol: 'openai-compatible' });
  assert.equal(calls[0].url, 'https://api.example.test/v1/models');
  assert.equal(calls[0].headers.authorization, 'Bearer saved-key');
});

test('The saved key cannot be reused when changing the domain name, same-domain path or protocol.', async () => {
  const { calls, fetchImpl } = recorder(() => json({ data: [] }));
  for (const input of [
    { baseUrl: 'https://other.example/v1' },
    { baseUrl: settings.baseUrl + '/other' },
    { protocol: 'anthropic' },
  ]) {
    const result = await discoverModels(fetchImpl, settings, input);
    assert.equal(result.ok, false);
  }
  assert.equal(calls.length, 0);
});

test('The streaming extremely large list stops reading early, 429 retains stable error classification', async () => {
  let cancelled = false;
  let reads = 0;
  const { fetchImpl } = recorder(
    () =>
      new Response(
        new ReadableStream({
          pull(controller) {
            reads++;
            controller.enqueue(new Uint8Array(600_000));
          },
          cancel() {
            cancelled = true;
          },
        }),
      ),
  );
  const result = await discoverModels(fetchImpl, settings, {});
  assert.equal(result.ok, false);
  assert.equal(cancelled, true);
  assert.ok(reads <= 4);
  const limited = recorder(() => json({ secret: 'private' }, 429));
  const failure = await discoverModels(limited.fetchImpl, settings, {});
  assert.ok(!failure.ok);
  assert.equal(failure.code, 'rate-limit');
});
