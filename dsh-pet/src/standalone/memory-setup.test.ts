/** DSH 模式的准备流程：真实 HTTP 模型检查、独立进程生命周期与配置隔离。 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createSetup, type SetupService } from './setup.ts';
import { memoryConfigBinding } from '../host/plugin/memory-binding.ts';
import { DEFAULT_CHAT_MEMORY } from '../shared/chat-memory-config.ts';

async function settled(setup: SetupService) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const status = setup.status() as Record<string, unknown>;
    if (!status.busy) return status;
    await delay(20);
  }
  throw new Error('setup did not settle');
}

test(
  'DSH setup retains chat settings, reuses endpoint-bound keys and resumes the same store',
  { skip: process.platform === 'win32' },
  async (t) => {
    const home = mkdtempSync(join(tmpdir(), 'pet-dsh-memory-'));
    const bin = join(home, 'dsh-pet/powercontext/venv/bin');
    mkdirSync(bin, { recursive: true });
    writeFileSync(
      join(bin, 'python'),
      `#!${process.execPath}
if (process.argv[3]?.includes('importlib.metadata')) process.exit(0);
const server = require('node:http').createServer((_req, res) => {res.setHeader('content-type','application/json');res.end('{"status":"ready"}');});
server.listen(Number(process.env.POWERCONTEXT_SERVER_HTTP_PORT), '127.0.0.1');
process.stdin.resume(); process.stdin.on('end', () => server.close());
`,
      { mode: 0o700 },
    );
    let deny = false;
    const auth: string[] = [];
    const server = createServer((req, res) => {
      auth.push(req.headers.authorization ?? '');
      res.setHeader('content-type', 'application/json');
      res.statusCode = deny ? 401 : 200;
      res.end(
        JSON.stringify(
          deny
            ? { secret: 'provider-private-error' }
            : req.url?.endsWith('/embeddings')
              ? { data: [{ embedding: [1, 0, 0] }] }
              : { choices: [{ message: { content: 'hello' } }] },
        ),
      );
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`;
    let main: Record<string, unknown> = {
      pets: [{ id: 'unchanged' }],
      chatModel: { provider: 'DSH', model: 'original' },
      chatMemoryRounds: 12,
      chatMemory: { ...DEFAULT_CHAT_MEMORY },
    };
    const binding = memoryConfigBinding({
      read: async () => main,
      update: async (change) => {
        main = { ...main, ...change(main) };
      },
    });
    let setup = createSetup(home, undefined, binding);
    t.after(async () => {
      await setup.dispose();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      rmSync(home, { recursive: true, force: true });
    });
    const draft = {
      action: 'start',
      memory: true,
      baseUrl,
      model: 'fixture',
      apiKey: 'synthetic-dsh-key',
      embeddingBaseUrl: baseUrl,
      embeddingModel: 'embed',
      embeddingDimension: 3,
      embeddingApiKey: '',
    };
    assert.throws(
      () => setup.submit({ action: 'start', memory: false, baseUrl, model: 'fixture', apiKey: 'key' }),
      /invalid_setup/,
    );
    setup.submit(draft);
    const ready = await settled(setup);
    assert.equal(ready.memoryReady, true);
    assert.equal(ready.chat, undefined);
    assert.ok(!JSON.stringify(ready).includes(draft.apiKey));
    assert.deepEqual(main.chatModel, { provider: 'DSH', model: 'original' });
    assert.deepEqual(main.pets, [{ id: 'unchanged' }]);
    assert.deepEqual(readdirSync(join(home, 'dsh-pet')), ['powercontext']);
    const saved = readFileSync(join(home, 'dsh-pet/powercontext/settings.json'), 'utf8');
    setup.submit({ action: 'stop' });
    assert.equal((await settled(setup)).memoryRunning, false);
    assert.equal((main.chatMemory as { backend: string }).backend, 'native');
    setup.submit({ action: 'retry' });
    assert.equal((await settled(setup)).serverUrl, ready.serverUrl);
    deny = true;
    setup.submit({ ...draft, apiKey: '', embeddingApiKey: '' });
    const failed = await settled(setup);
    assert.equal(failed.errorCode, 'chat_authentication');
    assert.equal(failed.memoryReady, true);
    assert.ok(!JSON.stringify(failed).includes('provider-private-error'));
    assert.equal(readFileSync(join(home, 'dsh-pet/powercontext/settings.json'), 'utf8'), saved);
    assert.throws(
      () => setup.submit({ ...draft, baseUrl: 'https://another.example/v1', apiKey: '' }),
      /chat_key_required/,
    );
    assert.ok(auth.every((value) => value === 'Bearer synthetic-dsh-key'));
    await setup.dispose();
    setup = createSetup(home, undefined, binding);
    setup.resume();
    const resumed = await settled(setup);
    assert.equal(resumed.serverUrl, ready.serverUrl);
    assert.equal(resumed.memoryReady, true);
  },
);

test('pausing a local service preserves an unrelated external memory binding', async () => {
  const main = {
    pets: ['same'],
    chatMemoryRounds: 9,
    chatMemory: { ...DEFAULT_CHAT_MEMORY, backend: 'powercontext', serverUrl: 'https://external.example' },
  };
  let writes = 0;
  const binding = memoryConfigBinding({
    read: async () => main,
    update: async (change) => {
      if (change(main)) writes++;
    },
  });
  await binding.save('http://127.0.0.1:12345', false);
  assert.equal(writes, 0);
  assert.equal(await binding.matches('http://127.0.0.1:12345'), false);
});
