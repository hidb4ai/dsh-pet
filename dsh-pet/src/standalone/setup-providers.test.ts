/** 三种模型连接通过真实 HTTP 分别校验，进程夹具仅代替安装阶段。 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { createStandaloneAi } from './ai-provider.ts';
import { createSetup } from './setup.ts';

test(
  'chat, extraction and embeddings keep separate models and keys across setup and reload',
  { skip: process.platform === 'win32' },
  async (t) => {
    const home = mkdtempSync(join(tmpdir(), 'pet-three-providers-'));
    const bin = join(home, 'dsh-pet/powercontext/venv/bin');
    mkdirSync(bin, { recursive: true });
    writeFileSync(
      join(bin, 'python'),
      `#!${process.execPath}
if (process.argv[3]?.includes('importlib.metadata')) process.exit(0);
const server = require('node:http').createServer((_req, res) => res.end('{"status":"ready"}'));
server.listen(Number(process.env.POWERCONTEXT_SERVER_HTTP_PORT), '127.0.0.1');
process.stdin.resume(); process.stdin.on('end', () => server.close());
`,
      { mode: 0o700 },
    );
    const calls: Array<{ url: string; auth?: string; model: string; dimensions?: number }> = [];
    const server = createServer(async (req, res) => {
      let raw = '';
      await new Promise<void>((resolve) => {
        req.on('data', (chunk: Buffer) => {
          raw += chunk.toString();
        });
        req.on('end', resolve);
      });
      const body = JSON.parse(raw);
      calls.push({ url: req.url!, auth: req.headers.authorization, model: body.model, dimensions: body.dimensions });
      if (body.stream) {
        res.setHeader('content-type', 'text/event-stream');
        res.end(
          'data: {"id":"test","choices":[{"index":0,"delta":{"content":"hello"},"finish_reason":null}]}\n\ndata: [DONE]\n\n',
        );
      } else
        res.end(
          JSON.stringify(
            req.url?.endsWith('/embeddings')
              ? { data: [{ embedding: [1, 0, 0] }] }
              : { choices: [{ message: { content: 'hello' } }] },
          ),
        );
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const ai = createStandaloneAi(home, { info() {}, warn() {}, error() {}, debug() {} });
    const binding = { matches: async () => false, save: async () => {}, checkpoint: async () => async () => {} };
    let setup = createSetup(home, ai, binding);
    t.after(async () => {
      await setup.dispose();
      ai.dispose();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      rmSync(home, { recursive: true, force: true });
    });
    setup.submit({
      action: 'start',
      memory: true,
      baseUrl: base + '/chat',
      model: 'pet-chat',
      apiKey: 'chat-only',
      generation: { baseUrl: base + '/generation', model: 'memory-extraction', apiKey: 'generation-only' },
      embeddingBaseUrl: base + '/vectors',
      embeddingModel: 'fixed-vector',
      embeddingApiKey: 'vectors-only',
      embeddingDimension: 3,
      embeddingSendDimensions: false,
    });
    const deadline = Date.now() + 10_000;
    while ((setup.status() as { busy: boolean }).busy && Date.now() < deadline) await delay(20);
    const status = setup.status() as { memoryReady: boolean; models: { model: string } };
    assert.equal(status.memoryReady, true);
    assert.equal(status.models.model, 'memory-extraction');
    assert.equal(ai.getSettings().model, 'pet-chat');
    assert.deepEqual(
      calls.map(({ auth, model }) => [auth, model]),
      [
        ['Bearer chat-only', 'pet-chat'],
        ['Bearer generation-only', 'memory-extraction'],
        ['Bearer vectors-only', 'fixed-vector'],
      ],
    );
    assert.equal(calls[calls.length - 1]?.dimensions, undefined);
    const saved = JSON.parse(readFileSync(join(home, 'dsh-pet/powercontext/settings.json'), 'utf8'));
    assert.equal(saved.apiKey, 'generation-only');
    assert.equal(saved.embeddingApiKey, 'vectors-only');
    assert.doesNotMatch(JSON.stringify(status), /generation-only|vectors-only|chat-only/);
    await setup.dispose();
    setup = createSetup(home, ai, binding);
    assert.equal((setup.status() as typeof status).models.model, 'memory-extraction');
    assert.equal(ai.getSettings().model, 'pet-chat');
  },
);
