// Real React controls against synthetic HTTP state; no robot or model requests.
import assert from 'node:assert/strict';
import { before, after, beforeEach, test } from 'node:test';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { rolldown } from 'rolldown';
const require = createRequire(import.meta.url);
let server, browser, origin, state, requests, delayExecute, releaseExecute;
before(async () => {
  const modulePath = (name) =>
    JSON.stringify(fileURLToPath(new URL(`../../src/client/robot/${name}.ts`, import.meta.url)));
  const code = `import React from ${JSON.stringify(require.resolve('react'))};
import { createRoot } from ${JSON.stringify(require.resolve('react-dom/client'))};
import { makeRobotPanel } from ${modulePath('panel')};
import { robotEn } from ${modulePath('locales')};
import { ROBOT_CSS } from ${modulePath('styles')};
document.head.appendChild(document.createElement('style')).textContent=ROBOT_CSS;
const Panel=makeRobotPanel({h:React.createElement,useState:React.useState,useEffect:React.useEffect,useRef:React.useRef,t:(key)=>robotEn[key]});
createRoot(document.getElementById('root')).render(React.createElement(Panel,{petId:'main'}));`;
  const bundle = await rolldown({
    input: 'virtual:robot',
    platform: 'browser',
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [
      {
        name: 'robot-entry',
        resolveId: (id) => (id === 'virtual:robot' ? id : null),
        load: (id) => (id === 'virtual:robot' ? code : null),
      },
    ],
  });
  const { output } = await bundle.generate({ format: 'iife' });
  await bundle.close();
  server = createServer(async (req, res) => {
    if (req.url === '/') {
      res.setHeader('content-type', 'text/html');
      res.end('<div id="root"></div><script src="/app.js"></script>');
      return;
    }
    if (req.url === '/app.js') {
      res.setHeader('content-type', 'text/javascript');
      res.end(output[0].code);
      return;
    }
    res.setHeader('content-type', 'application/json');
    if (req.method === 'POST') {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const request = JSON.parse(raw);
      requests.push(request);
      if (request.action === 'arm') state.armed = true;
      if (request.action === 'configure') {
        state.config = request.config;
        state.session = randomUUID();
        state.armed = false;
        state.connected = false;
      }
      if (request.action === 'execute') {
        state.armed = false;
        state.busy = true;
        if (delayExecute)
          await new Promise((resolve) => {
            releaseExecute = resolve;
          });
        else {
          state.busy = false;
          state.commands = [
            { id: request.id, key: 'Greeting', state: 'reported-success', message: 'Synthetic controller response' },
          ];
        }
      }
      if (request.action === 'stop') {
        state.armed = false;
        state.connected = false;
        state.busy = false;
        state.stopResult = {
          ok: false,
          code: 'stop_unconfirmed',
          message: 'Synthetic partial stop',
          stops: { agv: { ok: false, message: 'Unconfirmed' } },
        };
      }
    }
    res.end(JSON.stringify({ ok: true, ...state }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
});
beforeEach(() => {
  requests = [];
  delayExecute = false;
  releaseExecute = undefined;
  state = {
    session: randomUUID(),
    config: {
      enabled: true,
      address: '127.0.0.1:50051',
      python: 'python3',
      timeoutSeconds: 30,
      petId: 'main',
      actions: [{ key: 'greet', name: 'Greeting', actionIds: [100, 101], petAnimation: '' }],
    },
    armed: false,
    busy: false,
    checking: false,
    stopping: false,
    connected: true,
    checkedAt: Date.now(),
    telemetry: { actionCode: 520000, description: 'Synthetic idle', modes: [1, 1, 1] },
    error: '',
    commands: [],
  };
});
after(async () => {
  releaseExecute?.();
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
});
async function open(t) {
  const page = await browser.newPage();
  t.after(() => page.close());
  await page.goto(origin);
  await page.getByText('Astra Pro 2.0 robot', { exact: true }).click();
  await page.getByText('Connected', { exact: true }).waitFor();
  return page;
}

test('opening controls sends no motion; each selected action requires explicit one-shot authorization', async (t) => {
  const page = await open(t);
  const run = page.getByRole('button', { name: 'Run selected physical action', exact: true });
  assert.equal(await run.isDisabled(), true);
  assert.equal(requests.length, 0);
  await page.getByRole('button', { name: 'Verified stationary on site: allow one action' }).click();
  await page.getByText('One action authorized', { exact: true }).waitFor();
  await run.click();
  await page.getByText('Physical actions are disarmed', { exact: true }).waitFor();
  assert.equal(await run.isDisabled(), true);
  assert.deepEqual(
    requests.map((x) => x.action),
    ['arm', 'execute'],
  );
  assert.equal(requests[1].key, 'greet');
  assert.equal(requests[1].confirmed, true);
  assert.match(requests[1].id, /^[a-f0-9-]{36}$/);
  await page.getByText('Recent requests', { exact: true }).click();
  await page.getByText(/Greeting: Controller reported success/).waitFor();
});

test('stop stays available during an unresolved execute request and partial acknowledgement stays visible', async (t) => {
  const page = await open(t);
  delayExecute = true;
  t.after(() => releaseExecute?.());
  await page.getByRole('button', { name: 'Verified stationary on site: allow one action' }).click();
  await page.getByText('One action authorized', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Run selected physical action' }).click();
  await page.waitForFunction(() => document.querySelector('button.pet-robot-stop')?.disabled === false);
  await page.getByRole('button', { name: 'Stop robot', exact: true }).click();
  await page.getByText('Synthetic partial stop', { exact: true }).waitFor();
  assert.deepEqual(
    requests.map((x) => x.action),
    ['arm', 'execute', 'stop'],
  );
  await page.getByText('agv: ? Unconfirmed', { exact: true }).waitFor();
  releaseExecute();
  await page.getByText('Physical actions are disarmed', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Run selected physical action' }).isDisabled(), true);
});

test('an empty taught action ID is rejected locally instead of becoming action zero', async (t) => {
  const page = await open(t);
  await page.getByText('Connection and taught actions', { exact: true }).click();
  await page.getByLabel('Manufacturer-verified action IDs (comma-separated)', { exact: true }).fill('');
  await page.getByRole('button', { name: 'Save robot configuration' }).click();
  await page.getByText('Action IDs must be comma-separated non-negative integers.', { exact: true }).waitFor();
  assert.equal(requests.length, 0);
  await page.getByLabel('Manufacturer-verified action IDs (comma-separated)', { exact: true }).fill('105, 106');
  await page.getByLabel('Robot runtime', { exact: true }).selectOption('bundled');
  assert.equal(await page.getByLabel('Python path with SDK 2.0.0 installed').count(), 0);
  await page.getByRole('button', { name: 'Save robot configuration' }).click();
  await page.getByText('Disconnected or stale status', { exact: true }).waitFor();
  assert.deepEqual(requests[0].config.actions[0].actionIds, [105, 106]);
  assert.equal(requests[0].config.python, 'bundled');
  assert.equal(state.armed, false);
});
