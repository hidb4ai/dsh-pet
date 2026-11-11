import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { checkEmbedding, setupErrorMessage } from './setup-models.ts';
import { managedMemoryEnvironment } from './managed-memory.ts';

for (const scenario of ['ok', 'dimension', 'authentication', 'quota', 'not_found'] as const)
  test('embedding preflight reports ' + scenario + ' without leaking provider details', async (t) => {
    const code = { ok: 200, dimension: 200, authentication: 401, quota: 429, not_found: 404 }[scenario];
    let auth = '';
    const server = createServer((req, res) => {
      auth = req.headers.authorization ?? '';
      res.statusCode = code;
      res.end(
        code === 200
          ? JSON.stringify({ data: [{ embedding: scenario === 'dimension' ? [1] : [1, 2] }] })
          : 'private-provider-secret',
      );
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const models = {
      baseUrl: 'https://chat.example/v1',
      model: 'chat',
      apiKey: 'chat-key',
      embeddingBaseUrl: `http://127.0.0.1:${address.port}/v1`,
      embeddingModel: 'vector',
      embeddingApiKey: 'embedding-key',
      embeddingDimension: 2,
    };
    if (scenario === 'ok') await checkEmbedding(models, new AbortController().signal);
    else
      await assert.rejects(checkEmbedding(models, new AbortController().signal), (error: Error) => {
        assert.equal(error.message, 'embedding_' + scenario);
        assert.ok(!setupErrorMessage(error).includes('private-provider-secret'));
        return true;
      });
    assert.equal(auth, 'Bearer embedding-key');
  });

test('fixed-dimension providers omit dimensions in preflight and in the PowerContext runtime', async (t) => {
  let request: Record<string, unknown> = {};
  const server = createServer(async (req, res) => {
    let body = '';
    await new Promise<void>((resolve) => {
      req.on('data', (chunk: Buffer) => {
        body += chunk.toString();
      });
      req.on('end', resolve);
    });
    request = JSON.parse(body);
    res.end(JSON.stringify({ data: [{ embedding: [1, 0, 0] }] }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const models = {
    baseUrl: 'https://chat.example/v1',
    model: 'chat',
    apiKey: 'chat-key',
    embeddingBaseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`,
    embeddingModel: 'fixed-vector',
    embeddingApiKey: 'vector-key',
    embeddingDimension: 3,
    embeddingSendDimensions: false,
  };
  await checkEmbedding(models, new AbortController().signal);
  assert.equal('dimensions' in request, false);
  await assert.rejects(
    checkEmbedding({ ...models, embeddingDimension: 4 }, new AbortController().signal),
    /embedding_dimension/,
  );
  const env = managedMemoryEnvironment('/unused-test-directory', {
    ...models,
    version: 1,
    port: 12345,
    token: 'local-secret',
    enabled: false,
  });
  assert.equal(env.POWERCONTEXT_SERVER_INFERENCE_EMBEDDING_SEND_DIMENSIONS, 'false');
  assert.equal(env.POWERCONTEXT_SERVER_INFERENCE_EMBEDDING_DIMENSION, '3');
});
