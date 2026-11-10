// The real React indicator against controlled HTTP responses; no extraction-quality claim.
import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { rolldown } from 'rolldown';
const require = createRequire(import.meta.url);
let server, browser, origin;
before(async () => {
  const code = `import React from ${JSON.stringify(require.resolve('react'))};
import { createRoot } from ${JSON.stringify(require.resolve('react-dom/client'))};
import { PANEL_CSS } from ${JSON.stringify(fileURLToPath(new URL('../../src/client/chat/panel-css.ts', import.meta.url)))};
document.head.appendChild(document.createElement('style')).textContent = PANEL_CSS;
import { zh } from ${JSON.stringify(fileURLToPath(new URL('../../src/client/chat/locales/zh.ts', import.meta.url)))};
import { makeMemoryStatus } from ${JSON.stringify(fileURLToPath(new URL('../../src/client/chat/memory-status.ts', import.meta.url)))};
const Indicator = makeMemoryStatus({ h: React.createElement, useState: React.useState, useEffect: React.useEffect, t: (key, values = {}) => Object.entries(values).reduce((s,[k,v])=>s.replaceAll('{'+k+'}',String(v)),zh[key]) });
const root = createRoot(document.getElementById('root'));
window.showPet = (petId, revision = 0) => root.render(React.createElement(Indicator, { petId, revision }));
window.showPet('main');`;
  const bundle = await rolldown({
    input: 'virtual:indicator',
    platform: 'browser',
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [
      {
        name: 'indicator-entry',
        resolveId: (id) => (id === 'virtual:indicator' ? id : null),
        load: (id) => (id === 'virtual:indicator' ? code : null),
      },
    ],
  });
  const { output } = await bundle.generate({ format: 'iife' });
  await bundle.close();
  let fact = { id: 'synthetic-fact', revision: 1, stateVersion: 0, kind: 'preference', text: '合成测试：喜欢茉莉花茶' };
  server = createServer(async (req, res) => {
    if (req.url === '/') {
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.end(
        '<button id="tab-setup">设置</button><div id="panel-chat"><div id="root"></div></div><script src="/app.js"></script>',
      );
    } else if (req.url === '/app.js') {
      res.setHeader('content-type', 'text/javascript');
      res.end(output[0].code);
    } else {
      res.setHeader('content-type', 'application/json');
      const pet = new URL(req.url, 'http://localhost').searchParams.get('pet');
      if (req.url.includes('/chat/powercontext/memories')) {
        if (req.method === 'POST') {
          let raw = '';
          for await (const chunk of req) raw += chunk;
          const change = JSON.parse(raw);
          if (change.revision !== fact?.revision) {
            res.end(JSON.stringify({ ok: false }));
            return;
          }
          fact = change.action === 'forget' ? null : { ...fact, text: change.text, revision: fact.revision + 1 };
          res.end(JSON.stringify({ ok: true }));
          return;
        }
        const params = new URL(req.url, 'http://localhost').searchParams;
        res.end(
          JSON.stringify(
            params.has('id')
              ? {
                  ok: true,
                  evidence: {
                    revision: 1,
                    createdAt: '2026-11-10T00:00:00Z',
                    sources: [{ id: 'source-1', type: 'content', excerpt: '合成来源：请记住我喝茉莉花茶' }],
                  },
                }
              : { ok: true, items: pet === 'main' && fact ? [fact] : [], nextCursor: null },
          ),
        );
        return;
      }
      res.end(
        JSON.stringify(
          req.url === '/standalone-ai/setup'
            ? { configured: true, memoryEnabled: false, memoryRunning: false, memoryReady: false }
            : pet === 'main'
              ? { ok: true, backend: 'powercontext', captured: 12, pending: 2, recall: 'ready' }
              : { ok: true, backend: 'native', captured: 0, pending: 0, recall: 'not_run' },
        ),
      );
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
});

test('chat distinguishes delivery, recall and local service state and opens memory settings', async (t) => {
  const page = await browser.newPage();
  t.after(() => page.close());
  await page.goto(origin);
  await page.getByText(/已同步 12 轮/).waitFor();
  assert.match(await page.locator('.pet-chat-memory-status').textContent(), /最近召回到相关记忆/);
  assert.match(await page.locator('.pet-chat-memory-status').textContent(), /本机记忆服务：已暂停/);
  assert.match(await page.locator('.pet-chat-memory-status').textContent(), /不代表已整理/);
  await page.evaluate(
    () =>
      (document.getElementById('tab-setup').onclick = () => {
        window.openedSettings = true;
      }),
  );
  await page.getByRole('button', { name: '记忆设置' }).click();
  assert.equal(await page.evaluate(() => window.openedSettings), true);
});

test('switching pets clears the old memory status while the new request is pending', async (t) => {
  const page = await browser.newPage();
  t.after(() => page.close());
  await page.goto(origin);
  await page.getByText(/已同步 12 轮/).waitFor();
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  await page.route('**/chat/powercontext?pet=second', async (route) => {
    await pending;
    await route.continue();
  });
  await page.evaluate(() => window.showPet('second'));
  await page.getByText('正在读取这只宠物的记忆状态…').waitFor();
  assert.doesNotMatch(await page.locator('.pet-chat-memory-status').textContent(), /已同步 12|最近召回/);
  release();
  await page.getByText('当前宠物使用近期对话，长期记忆未开启。').waitFor();
});

test('real memory UI displays provenance, confirms correction and requires a separate forgetting confirmation', async (t) => {
  const page = await browser.newPage();
  t.after(() => page.close());
  await page.goto(origin);
  await page.getByRole('button', { name: '记得的事' }).click();
  await page.getByText('合成测试：喜欢茉莉花茶', { exact: true }).waitFor();
  await page.getByRole('button', { name: '查看来源' }).click();
  await page.getByText('来源 1').click();
  await page.getByText('合成来源：请记住我喝茉莉花茶').waitFor();
  await page.getByRole('button', { name: '更正', exact: true }).click();
  await page.getByRole('textbox', { name: '更正' }).fill('合成测试：现在喜欢无糖乌龙茶');
  await page.getByRole('button', { name: '保存更正' }).click();
  await page.getByText('合成测试：现在喜欢无糖乌龙茶', { exact: true }).waitFor();
  await page.getByText('版本 2', { exact: true }).waitFor();
  await page.getByRole('button', { name: '遗忘', exact: true }).click();
  await page.getByText(/原始来源、历史版本和本机聊天记录仍保留/).waitFor();
  assert.equal(await page.getByText('合成测试：现在喜欢无糖乌龙茶', { exact: true }).count(), 1);
  let rejectOnce = true;
  await page.route('**/chat/powercontext/memories?pet=main', async (route) => {
    if (route.request().method() === 'POST' && rejectOnce) {
      rejectOnce = false;
      await route.fulfill({ json: { ok: false, message: 'http_412' } });
    } else await route.continue();
  });
  await page.getByRole('button', { name: '确认遗忘', exact: true }).click();
  await page.getByText(/操作未确认成功/).waitFor();
  assert.equal(await page.getByText(/服务已确认更新/).count(), 0);
  await page.getByRole('button', { name: '确认遗忘', exact: true }).click();
  await page.getByText(/还没有可用的长期记忆/).waitFor();
  assert.equal(await page.getByText('合成测试：现在喜欢无糖乌龙茶', { exact: true }).count(), 0);
});

test('memory library distinguishes failures from empty results and resets on pet switch', async (t) => {
  const page = await browser.newPage();
  t.after(() => page.close());
  await page.route('**/chat/powercontext/memories?pet=main', (route) => route.fulfill({ json: { ok: false } }));
  await page.goto(origin);
  await page.getByRole('button', { name: '记得的事' }).click();
  await page.getByText('记忆暂不可读，请检查连接后刷新。').waitFor();
  assert.equal(await page.getByText(/还没有可用的长期记忆/).count(), 0);
  await page.evaluate(() => window.showPet('second'));
  assert.equal(await page.getByRole('button', { name: '记得的事' }).getAttribute('aria-expanded'), 'false');
  await page.getByRole('button', { name: '记得的事' }).click();
  await page.getByText(/还没有可用的长期记忆/).waitFor();
});

test('memory cards fit a narrow panel and present captured dialogue as readable evidence', async (t) => {
  const page = await browser.newPage({ viewport: { width: 360, height: 760 } });
  t.after(() => page.close());
  await page.route('**/chat/powercontext/memories?pet=main*', (route) => {
    const evidence = new URL(route.request().url()).searchParams.has('id');
    return route.fulfill({
      json: evidence
        ? {
            ok: true,
            evidence: {
              revision: 1,
              createdAt: null,
              sources: [
                {
                  id: 'dsh-pet-turn:synthetic-source',
                  type: 'content',
                  excerpt: JSON.stringify({
                    kind: 'dsh-pet-dialogue',
                    messages: [
                      { role: 'user', content: '我喜欢无糖茉莉花茶。' },
                      { role: 'assistant', content: '了解你的偏好啦。' },
                    ],
                  }),
                },
              ],
            },
          }
        : {
            ok: true,
            items: [
              {
                id: 'memory-1',
                revision: 1,
                stateVersion: 0,
                kind: 'preference',
                text: '合成测试：林舟喜欢喝无糖茉莉花茶。',
              },
            ],
            nextCursor: null,
          },
    });
  });
  await page.goto(origin);
  await page.addStyleTag({
    content:
      ':root { --dsw-alias-label-secondary:#475569; --dsw-alias-label-primary:#172033; --dsw-alias-bg-module-platform:#f1f5f9; --dsw-alias-state-business-primary:#2563eb; --dsw-alias-border-l2:#cbd5e1; } body {font-family:system-ui; margin:16px;} button{font:inherit;} ',
  });
  await page.getByRole('button', { name: '记得的事' }).click();
  await page.getByText('合成测试：林舟喜欢喝无糖茉莉花茶。', { exact: true }).waitFor();
  await page.getByRole('button', { name: '查看来源' }).click();
  await page.getByText('来源 1').click();
  await page.getByText(/你: 我喜欢无糖茉莉花茶/).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  if (process.env.DSH_PET_EVIDENCE_IMAGE)
    await page.screenshot({ path: process.env.DSH_PET_EVIDENCE_IMAGE, fullPage: true });
});
