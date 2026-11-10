// Real React + Chromium; API fixtures never touch the user's DSH configuration.
// First run: pnpm exec playwright install chromium
import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { rolldown } from 'rolldown';

const pet = {
  id: 'pet-1',
  name: 'Blue',
  size: 240,
  display: 'web',
  assetRoot: 'main',
  position: { corner: 'top-right', marginX: 20, marginY: 20 },
};
const defaults = {
  main: {
    pets: [pet],
    notificationsEnabled: true,
    whisperImageEnabled: false,
    chatImageEnabled: false,
    confineToScreen: false,
    physics: {
      gravity: 2400,
      restitution: 0.6,
      groundFriction: 4,
      throwPower: 1,
      ceilingBounce: false,
      petCollision: false,
      hapticEnabled: true,
      tiltGravity: true,
      shakeThrow: true,
    },
    whisperModel: { provider: '', model: '' },
    chatModel: { provider: '', model: '' },
    chatMemoryRounds: 5,
    chatImageLimit: 10,
  },
};
const customized = {
  main: {
    ...defaults.main,
    notificationsEnabled: false,
    whisperImageEnabled: true,
    chatImageEnabled: true,
    confineToScreen: true,
    chatMemoryRounds: 19,
    chatImageLimit: 2,
    whisperModel: { provider: 'test', model: 'model' },
    chatModel: { provider: 'test', model: 'model' },
    physics: { ...defaults.main.physics, gravity: 1200, throwPower: 2, ceilingBounce: true, petCollision: true },
  },
};
let browser, server, url;
before(async () => {
  const bundle = await rolldown({
    input: fileURLToPath(new URL('./settings.fixture.js', import.meta.url)),
    platform: 'browser',
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  });
  const { output } = await bundle.generate({ format: 'iife' });
  await bundle.close();
  server = createServer((req, res) => {
    if (req.url === '/fixture.js') {
      res.setHeader('content-type', 'text/javascript');
      res.end(output[0].code);
      return;
    }
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(
      `<html><head><style>:root{--dsw-alias-bg-layer-1:#fff;--dsw-alias-label-primary:#202020;--dsw-alias-label-secondary:#444;--dsw-alias-label-tertiary:#666;--dsw-alias-border-l2:#bbb;--dsw-alias-state-business-primary:#245eea;--dsw-alias-button-info-fill:#245eea;--dsw-alias-state-error-primary:#c22}body{margin:16px;font-family:sans-serif}</style></head><body><div id="root"></div><script>window.initialConfig=${JSON.stringify(defaults)};</script><script src="/fixture.js"></script></body></html>`,
    );
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
});

async function open(
  t,
  { get = customized, put, post, memorySetup, viewport = { width: 900, height: 900 }, lang = 'en' } = {},
) {
  const context = await browser.newContext({ viewport });
  t.after(() => context.close());
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  const writes = [],
    errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, []));
  await page.route('**/dsh-pet-7340/**', async (route) => {
    const request = route.request();
    if (new URL(request.url()).pathname === '/dsh-pet-7340/powercontext/setup') {
      return memorySetup ? memorySetup(route) : route.fulfill({ json: { ok: true, available: false } });
    }
    if (new URL(request.url()).pathname === '/dsh-pet-7340/config') {
      if (request.method() === 'PUT') {
        writes.push(request.postDataJSON());
        if (put) return put(route);
        return route.fulfill({ json: customized });
      }
      if (request.method() === 'POST') return post ? post(route) : route.fulfill({ json: defaults });
      if (typeof get === 'function') return get(route);
      return route.fulfill({ json: get });
    }
    if (request.url().endsWith('/config/meta')) {
      return route.fulfill({
        json: {
          user: '/test/main-config.jsonc',
          default: '/test/assets/config.jsonc',
          animations: '/test/main-animation',
        },
      });
    }
    return route.fulfill({
      json: { providers: [{ id: 'test', name: 'Test', models: [{ id: 'model', name: 'Model' }] }] },
    });
  });
  await page.goto(`${url}/?lang=${lang}`);
  await page.locator('.dsh-pet-cfg').waitFor();
  return { page, writes };
}

async function save(page) {
  await Promise.all([
    page.waitForResponse((response) => response.request().method() === 'PUT'),
    page.getByRole('button', { name: 'Save', exact: true }).first().click(),
  ]);
}

async function assertSaveDisabled(page) {
  const buttons = page.getByRole('button', { name: 'Save', exact: true });
  assert.ok((await buttons.count()) > 0);
  assert.equal(await buttons.evaluateAll((items) => items.every((button) => button.disabled)), true);
}

test('optional memory stays off by default and saves its backend and separate byte budgets', async (t) => {
  const { page, writes } = await open(t);
  const field = (text) => page.locator('.dsh-pet-cfg__field').filter({ hasText: text });
  const backend = field('Long-term memory').locator('select');
  assert.equal(await backend.inputValue(), 'native');
  await backend.selectOption('powercontext');
  await field('PowerContext URL').locator('input').fill('https://memory.example.test');
  const history = field('Recent text byte limit').locator('input');
  await history.fill('6000');
  await history.blur();
  const recall = field('Recall byte limit').locator('input');
  await recall.fill('2048');
  await recall.blur();
  await save(page);
  assert.deepEqual(writes[0].chatMemory, {
    backend: 'powercontext',
    maxHistoryBytes: 6000,
    serverUrl: 'https://memory.example.test',
    maxRecallBytes: 2048,
    recallLimit: 3,
    timeoutMs: 1500,
  });
  await backend.selectOption('native');
  await save(page);
  assert.equal(writes[1].chatMemory.backend, 'native');
});

test('config save errors: write failures keep edits visible and allow a retry', async (t) => {
  let attempts = 0;
  const { page, writes } = await open(t, {
    put: (route) =>
      ++attempts === 1
        ? route.fulfill({ status: 500, json: { error: 'failed to save config' } })
        : route.fulfill({ json: customized }),
  });
  const size = page.locator('input[type="number"]').first();
  await page.getByRole('button', { name: 'Save', exact: true }).first().waitFor({ state: 'visible' });
  await size.fill('320');
  await save(page);
  await page
    .getByText(
      'Failed to save config. Check the server connection, configuration directory write permissions and server log.',
      { exact: true },
    )
    .first()
    .waitFor();
  assert.equal(await page.getByText('Failed to load config', { exact: true }).count(), 0);
  assert.equal(await size.inputValue(), '320');
  await save(page);
  await page.getByText('Saved — the pets updated instantly.', { exact: true }).first().waitFor();
  assert.equal(writes[1].pets[0].size, 320);
});

test('config save errors: validation failures explain the rejected configuration', async (t) => {
  const { page } = await open(t, {
    put: (route) => route.fulfill({ json: { ok: false, reason: 'bad-request' } }),
  });
  await save(page);
  await page
    .getByText('Failed to save config: invalid configuration. Check the values and try again.', { exact: true })
    .first()
    .waitFor();
});

test('config save errors: network failures display a save error and release the button', async (t) => {
  const { page } = await open(t, { put: (route) => route.abort('failed') });
  await page.getByRole('button', { name: 'Save', exact: true }).first().click();
  await page
    .getByText(
      'Failed to save config. Check the server connection, configuration directory write permissions and server log.',
      { exact: true },
    )
    .first()
    .waitFor();
  assert.equal(await page.getByRole('button', { name: 'Save', exact: true }).first().isEnabled(), true);
});

test('config save errors: sync failures use the sync message', async (t) => {
  const { page } = await open(t, { post: (route) => route.fulfill({ status: 500, json: { error: 'write failed' } }) });
  await page.getByRole('button', { name: 'Sync', exact: true }).click();
  await page.getByRole('button', { name: 'Sync', exact: true }).last().click();
  await page
    .getByText('Failed to sync config. Check the server connection and configuration directory write permissions.', {
      exact: true,
    })
    .first()
    .waitFor();
});

test('pending config prevents editing and saving placeholder defaults', async (t) => {
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  const { page, writes } = await open(t, {
    get: async (route) => {
      await pending;
      await route.fulfill({ json: customized });
    },
  });
  try {
    await assertSaveDisabled(page);
    assert.equal(await page.locator('input[type=text]').first().isDisabled(), true);
    assert.deepEqual(writes, []);
  } finally {
    release();
  }
});

for (const failure of ['http', 'network', 'malformed', 'null']) {
  test(`failed config (${failure}) is visible, blocks Save and can be retried`, async (t) => {
    let fail = true;
    const { page, writes } = await open(t, {
      get: (route) =>
        !fail
          ? route.fulfill({ json: customized })
          : failure === 'network'
            ? route.abort()
            : route.fulfill(
                failure === 'http' ? { status: 503, body: 'unavailable' } : { json: failure === 'null' ? null : {} },
              ),
    });
    await page.getByRole('alert').waitFor();
    await assertSaveDisabled(page);
    assert.deepEqual(writes, []);
    fail = false;
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await save(page);
    assert.equal(writes.length, 1);
    for (const [key, value] of Object.entries(customized.main)) assert.deepEqual(writes[0][key], value, key);
  });
}

test('Sync updates all controls so a subsequent Save preserves the restored defaults', async (t) => {
  const { page, writes } = await open(t);
  await save(page);
  assert.equal(writes[0].chatMemoryRounds, 19);
  await page.getByRole('button', { name: 'Sync', exact: true }).click();
  await page.getByRole('button', { name: 'Sync', exact: true }).last().click();
  await save(page);
  assert.equal(writes.length, 2);
  for (const [key, value] of Object.entries(defaults.main)) assert.deepEqual(writes[1][key], value, key);
});

test('fresh config refreshes the pet list instead of saving an old bridge snapshot', async (t) => {
  const fresh = { main: { ...customized.main, pets: [{ ...pet, name: 'Updated elsewhere', size: 360 }] } };
  const { page, writes } = await open(t, { get: fresh });
  await save(page);
  assert.deepEqual(writes[0].pets, fresh.main.pets);
});

for (const lang of ['en', 'zh']) {
  for (const width of [360, 520, 900]) {
    test(`settings keep controls and toggle labels readable (${lang}, ${width}px)`, async (t) => {
      const { page } = await open(t, { viewport: { width, height: 800 }, lang });
      const clipped = await page
        .locator('.dsh-pet-cfg__toggle>label>span')
        .evaluateAll((labels) =>
          labels.filter((label) => label.scrollWidth > label.clientWidth).map((label) => label.textContent),
        );
      assert.deepEqual(clipped, []);
      if (process.env.DSH_PET_UI_ARTIFACTS) {
        mkdirSync(process.env.DSH_PET_UI_ARTIFACTS, { recursive: true });
        await page.screenshot({
          path: join(process.env.DSH_PET_UI_ARTIFACTS, 'settings-' + lang + '-' + width + '.png'),
          fullPage: true,
        });
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    });
  }
}

test('model picker remains anchored while the responsive settings panel is scrolled', async (t) => {
  const { page, writes } = await open(t, { viewport: { width: 900, height: 700 } });
  const trigger = page.locator('.dsh-pet-mp__trigger').first();
  await trigger.click();
  const panel = page.getByRole('menu');
  await panel.waitFor();
  const initialScroll = await page.evaluate(() => window.scrollY);
  for (const scrollY of [initialScroll, initialScroll + 120]) {
    await page.evaluate((y) => window.scrollTo(0, y), scrollY);
    await page.waitForFunction(() => {
      const trigger = document.querySelector('.dsh-pet-mp__trigger').getBoundingClientRect();
      const panel = document.querySelector('.dsh-pet-mp__panel').getBoundingClientRect();
      return Math.abs(panel.left - trigger.left) < 2 && panel.top >= 0 && panel.bottom <= innerHeight;
    });
  }
  await page.getByRole('menuitemradio', { name: 'Follow current conversation' }).click();
  await save(page);
  assert.deepEqual(writes[0].whisperModel, { provider: '', model: '' });
});

test('local memory setup preserves unsaved settings and reflects readiness, pause and recovery', async (t) => {
  const calls = [];
  const memory = {
    backend: 'native',
    serverUrl: 'http://127.0.0.1:8000',
    maxHistoryBytes: 0,
    maxRecallBytes: 4096,
    recallLimit: 3,
    timeoutMs: 1500,
  };
  let snapshot = {
    ok: true,
    available: true,
    stage: 'idle',
    busy: false,
    canCancel: false,
    configured: false,
    memoryReady: false,
    memoryEnabled: false,
    memoryRunning: false,
    canRetry: false,
    binding: { chatMemory: memory, chatMemoryRounds: 19 },
  };
  const { page, writes } = await open(t, {
    viewport: { width: 360, height: 900 },
    memorySetup: (route) => {
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON();
        calls.push(body);
        const enabled = body.action !== 'stop';
        snapshot = {
          ...snapshot,
          stage: enabled ? 'ready' : 'stopped',
          configured: true,
          memoryReady: enabled,
          memoryEnabled: enabled,
          memoryRunning: enabled,
          canRetry: true,
          models: {
            baseUrl: 'https://api.openai.com/v1',
            model: 'gpt-4.1-mini',
            embeddingBaseUrl: 'https://api.openai.com/v1',
            embeddingModel: 'text-embedding-3-small',
            embeddingDimension: 1536,
          },
          binding: {
            chatMemory: {
              ...memory,
              backend: enabled ? 'powercontext' : 'native',
              serverUrl: 'http://127.0.0.1:12345',
              maxHistoryBytes: 6000,
            },
            chatMemoryRounds: 4,
          },
        };
      }
      return route.fulfill({ json: snapshot });
    },
  });
  const card = page.locator('[data-memory-setup]');
  await card.getByText('Local long-term memory', { exact: true }).waitFor();
  await card.getByRole('combobox').selectOption('openai');
  await card.getByLabel('Generation API key', { exact: true }).fill('synthetic-key');
  const size = page.locator('input[type="number"]').first();
  await size.fill('320');
  await size.blur();
  await card.getByRole('button', { name: 'Check and enable memory' }).click();
  await card.getByText('Setup completed.', { exact: true }).waitFor();
  assert.equal(await card.getByLabel('Generation API key', { exact: true }).inputValue(), '');
  assert.equal(calls[0].memory, true);
  assert.equal(calls[0].embeddingDimension, 1536);
  assert.equal(await card.getByLabel('Embedding model', { exact: true }).getAttribute('readonly'), '');
  await save(page);
  assert.equal(writes[0].pets[0].size, 320);
  assert.equal(writes[0].chatMemory.backend, 'powercontext');
  assert.equal(writes[0].chatMemoryRounds, 4);
  await card.getByRole('button', { name: 'Pause memory', exact: true }).click();
  await card.getByText('Memory paused.', { exact: true }).waitFor();
  await card.getByRole('button', { name: 'Start or resume memory', exact: true }).click();
  await card.getByText('Setup completed.', { exact: true }).waitFor();
  assert.deepEqual(calls.slice(1), [{ action: 'stop' }, { action: 'retry' }]);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
});

test('local memory setup cancels background preparation and distinguishes failed writes', async (t) => {
  let snapshot = {
    ok: true,
    available: true,
    stage: 'installing_memory',
    busy: true,
    canCancel: true,
    memoryReady: false,
    memoryEnabled: false,
    memoryRunning: false,
    canRetry: true,
    startedAt: Date.now(),
  };
  let failed = false;
  const { page } = await open(t, {
    lang: 'zh',
    memorySetup: (route) => {
      if (route.request().method() === 'POST') {
        if (failed) return route.fulfill({ json: { ok: false, message: 'memory_already_owned' } });
        assert.equal(route.request().postDataJSON().action, 'cancel');
        snapshot = { ...snapshot, stage: 'cancelled', busy: false, canCancel: false };
      }
      return route.fulfill({ json: snapshot });
    },
  });
  const card = page.locator('[data-memory-setup]');
  await card.getByText('正在安装 PowerContext 1.5.0…', { exact: true }).waitFor();
  assert.equal(await card.getByRole('button', { name: '检查并启用记忆' }).isEnabled(), false);
  await card.getByRole('button', { name: '取消准备', exact: true }).click();
  await card.getByText('已取消准备，已有数据保留。', { exact: true }).waitFor();
  failed = true;
  await card.getByRole('button', { name: '启动或恢复记忆', exact: true }).click();
  await card.getByText('另一个桌宠进程正在管理此记忆库，请先停止那个进程中的记忆服务。', { exact: true }).waitFor();
  assert.equal(await card.getByRole('button', { name: '暂停记忆', exact: true }).count(), 0);
});
