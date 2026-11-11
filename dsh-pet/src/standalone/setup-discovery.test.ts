/** Found the true HTTP contract for the interface: filtering by role, credential isolation, no writes and no authentication native service. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { ManagedMemory } from './managed-memory.ts';
import { discoverSetupModels } from './setup-discovery.ts';
import { createStandaloneAi } from './ai-provider.ts';

test('discovery separates capabilities, never returns keys and preserves endpoint credential scope', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'pet-model-discovery-'));
  const calls: Array<{ url: string; auth?: string }> = [];
  const server = createServer((req, res) => {
    calls.push({ url: req.url!, auth: req.headers.authorization });
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify({
        data: [
          { id: 'deepseek-flash' },
          { id: 'BAAI/bge-m3' },
          { id: 'alias', domain: 'Embedding' },
          { id: 'reranker' },
          { id: 'unknown-alias' },
        ],
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const memory = new ManagedMemory(home);
  t.after(async () => {
    await memory.dispose();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(home, { recursive: true, force: true });
  });
  await memory.configure({
    baseUrl: base + '/generation',
    model: 'deepseek-flash',
    apiKey: 'private-generation',
    embeddingBaseUrl: base + '/vectors',
    embeddingModel: 'BAAI/bge-m3',
    embeddingApiKey: 'private-vector',
    embeddingDimension: 1024,
  });
  const before = memory.settings();
  const embedding = await discoverSetupModels(
    { action: 'models', kind: 'embedding', baseUrl: base + '/vectors', apiKey: '' },
    memory,
  );
  assert.ok(embedding.ok);
  assert.deepEqual(
    embedding.models.map((model) => model.id),
    ['BAAI/bge-m3', 'alias', 'unknown-alias'],
  );
  assert.equal(calls[calls.length - 1]?.auth, 'Bearer private-vector');
  const generation = await discoverSetupModels(
    { action: 'models', kind: 'generation', baseUrl: base + '/generation' },
    memory,
  );
  assert.ok(generation.ok);
  assert.deepEqual(
    generation.models.map((model) => model.id),
    ['deepseek-flash', 'unknown-alias'],
  );
  assert.equal(calls[calls.length - 1]?.auth, 'Bearer private-generation');
  await discoverSetupModels({ action: 'models', kind: 'embedding', baseUrl: base + '/generation' }, memory);
  assert.equal(calls[calls.length - 1]?.auth, 'Bearer private-generation');
  const ai = createStandaloneAi(home, { info() {}, warn() {}, error() {}, debug() {} });
  t.after(() => ai.dispose());
  await ai.saveSettings({ baseUrl: base + '/generation', model: 'pet-chat', apiKey: 'private-chat' });
  await discoverSetupModels({ action: 'models', kind: 'chat', baseUrl: base + '/generation' }, memory, ai);
  assert.equal(calls[calls.length - 1]?.auth, 'Bearer private-chat');
  await discoverSetupModels({ action: 'models', kind: 'generation', baseUrl: base + '/generation' }, memory, ai);
  assert.equal(calls[calls.length - 1]?.auth, 'Bearer private-generation');
  await discoverSetupModels({ action: 'models', kind: 'generation', baseUrl: base + '/different' }, memory);
  assert.equal(calls[calls.length - 1]?.auth, 'Bearer local');
  const count = calls.length;
  const remote = await discoverSetupModels(
    { action: 'models', kind: 'generation', baseUrl: 'https://other.example/v1' },
    memory,
  );
  assert.equal(remote.ok, false);
  assert.equal(calls.length, count);
  assert.deepEqual(memory.settings(), before);
  assert.equal(memory.enabled, false);
  assert.doesNotMatch(JSON.stringify({ generation, embedding, remote }), /private-/);
});
