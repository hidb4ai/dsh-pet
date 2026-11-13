/** Test authorization, uncertainty, duplicate delivery and stop isolation without a robot. */
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { createRobotService, type RobotFeedback } from './service.ts';
import { defaultRobotConfig, robotConfigSchema } from './config.ts';
import type { RobotCall, RobotRunner } from './worker.ts';
import type { RobotResult } from '../../shared/robot.ts';

const healthy: RobotResult = {
  ok: true,
  code: 'status',
  message: 'ready',
  telemetry: { actionCode: 520000, description: 'idle', modes: [1, 1, 1] },
};
const success: RobotResult = { ok: true, code: 'reported_success', message: 'Controller reported success.' };

function deferred() {
  let resolve!: (value: RobotResult) => void;
  const promise = new Promise<RobotResult>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function harness(t: TestContext, transport?: RobotRunner) {
  const root = mkdtempSync(join(tmpdir(), 'astra-service-'));
  const calls: RobotCall[] = [];
  const feedback: RobotFeedback[] = [];
  let now = 100_000;
  const run: RobotRunner = async (config, call, signal) => {
    calls.push(call);
    return transport ? transport(config, call, signal) : call.operation === 'status' ? healthy : success;
  };
  const options = {
    userRoot: root,
    run,
    monitor: false,
    now: () => now,
    feedback: async (event: RobotFeedback) => {
      feedback.push(event);
    },
  };
  const service = createRobotService(options);
  t.after(() => {
    service.dispose();
    rmSync(root, { recursive: true, force: true });
  });
  await service.submit({
    action: 'configure',
    config: {
      ...defaultRobotConfig(),
      enabled: true,
      address: '127.0.0.1:50051',
      actions: [
        { key: 'greet', name: 'Greet', actionIds: [100, 101], petAnimation: 'Wave' },
        { key: 'bow', name: 'Bow', actionIds: [102], petAnimation: '' },
      ],
    },
  });
  const arm = async () => {
    await service.submit({ action: 'check' });
    await service.submit({ action: 'arm', session: service.snapshot().session, confirmed: true });
  };
  const execute = (id = randomUUID(), key = 'greet') =>
    service.submit({ action: 'execute', session: service.snapshot().session, id, key, petId: 'main', confirmed: true });
  return {
    service,
    calls,
    feedback,
    root,
    options,
    arm,
    execute,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

test('configuration cannot select arbitrary commands or unverified IDs', () => {
  for (const patch of [
    { python: 'bash' },
    { address: 'host:99999' },
    { timeoutSeconds: 0 },
    { actions: [{ key: 'raw', name: 'Raw', actionIds: [-1], petAnimation: '' }] },
  ])
    assert.equal(robotConfigSchema.safeParse({ ...defaultRobotConfig(), ...patch }).success, false);
  assert.equal(
    robotConfigSchema.safeParse({ ...defaultRobotConfig(), python: 'C:\\robot\\Scripts\\python.exe' }).success,
    true,
  );
});

test('connection checks do not authorize motion and confirmation is mandatory', async (t) => {
  const h = await harness(t);
  assert.equal(h.service.snapshot().armed, false);
  await h.service.submit({ action: 'check' });
  await assert.rejects(h.execute(), /robot_not_armed/);
  await assert.rejects(h.service.submit({ action: 'arm', session: h.service.snapshot().session }), /true/);
  await h.arm();
  await assert.rejects(h.execute(randomUUID(), 'arbitrary'), /robot_unknown_action/);
  assert.equal(
    h.calls.some((call) => call.operation === 'execute'),
    false,
  );
});

test('one authorization permits one allowlisted group and duplicate delivery cannot replay it', async (t) => {
  const pending = deferred();
  const h = await harness(t, async (_config, call) => (call.operation === 'execute' ? pending.promise : healthy));
  await h.arm();
  const id = randomUUID();
  await h.execute(id);
  await h.execute(id);
  assert.equal(h.calls.filter((call) => call.operation === 'execute').length, 1);
  assert.deepEqual(h.calls[h.calls.length - 1]?.actionIds, [100, 101]);
  assert.equal(h.service.snapshot().armed, false);
  await assert.rejects(h.execute(id, 'bow'), /robot_request_conflict/);
  await assert.rejects(h.execute(), /robot_busy/);
  pending.resolve(success);
  await setImmediate();
  assert.equal(h.service.snapshot().commands[0].state, 'reported-success');
  await assert.rejects(h.execute(), /robot_not_connected/);
  await h.service.submit({ action: 'check' });
  await assert.rejects(h.execute(), /robot_not_armed/);
});

test('a timeout remains unknown, sends no retry and consumes authorization', async (t) => {
  const h = await harness(t, async (_config, call) =>
    call.operation === 'status' ? healthy : { ok: false, code: 'timeout', message: 'Unknown physical state.' },
  );
  await h.arm();
  await h.execute();
  await setImmediate();
  assert.equal(h.service.snapshot().commands[0].state, 'unknown');
  assert.equal(h.service.snapshot().armed, false);
  assert.equal(h.calls.filter((call) => call.operation === 'execute').length, 1);
});

test('stop bypasses an unresolved action and a late success cannot erase uncertainty', async (t) => {
  const pending = deferred();
  const h = await harness(t, async (_config, call) =>
    call.operation === 'execute'
      ? pending.promise
      : call.operation === 'status'
        ? healthy
        : {
            ok: false,
            code: 'stop_unconfirmed',
            message: 'AGV unreachable.',
            stops: { upperBody: { ok: true, message: '' }, agv: { ok: false, message: 'unreachable' } },
          },
  );
  await h.arm();
  await h.execute();
  await h.service.submit({ action: 'stop' });
  assert.equal(h.calls[h.calls.length - 1]?.operation, 'stop');
  assert.equal(h.service.snapshot().commands[0].state, 'unknown');
  assert.equal(h.service.snapshot().stopResult?.stops?.agv.ok, false);
  pending.resolve(success);
  await setImmediate();
  assert.equal(h.service.snapshot().commands[0].state, 'unknown');
  assert.equal(h.service.snapshot().connected, false);
});

test('stale telemetry and configuration changes invalidate authorization', async (t) => {
  const h = await harness(t);
  await h.arm();
  h.advance(16_000);
  await assert.rejects(h.execute(), /robot_not_connected/);
  const session = h.service.snapshot().session;
  await h.service.submit({ action: 'configure', config: h.service.snapshot().config });
  await assert.rejects(h.service.submit({ action: 'arm', session, confirmed: true }), /robot_session_changed/);
});

test('restart preserves uncertain receipts, disarms control and rejects the old session', async (t) => {
  const pending = deferred();
  const h = await harness(t, async (_config, call) => (call.operation === 'execute' ? pending.promise : healthy));
  await h.arm();
  const oldSession = h.service.snapshot().session;
  const id = randomUUID();
  await h.execute(id);
  const restarted = createRobotService(h.options);
  assert.equal(restarted.snapshot().commands[0].state, 'unknown');
  assert.equal(restarted.snapshot().armed, false);
  await assert.rejects(
    restarted.submit({ action: 'execute', session: oldSession, id, key: 'greet', petId: 'main', confirmed: true }),
    /robot_session_changed/,
  );
  restarted.dispose();
  pending.resolve(success);
  await setImmediate();
});

test('status changes drive pet feedback without sending movement', async (t) => {
  let description = 'idle';
  const h = await harness(t, async () => ({ ...healthy, telemetry: { ...healthy.telemetry!, description } }));
  await h.service.submit({ action: 'check' });
  description = 'working';
  await h.service.submit({ action: 'check' });
  await setImmediate();
  assert.equal(h.feedback.length, 1);
  assert.equal(h.feedback[0].text, 'Robot: working');
  assert.equal(
    h.calls.every((call) => call.operation === 'status'),
    true,
  );
});

test('a corrupt journal blocks motion but not independent stop requests', async (t) => {
  const h = await harness(t);
  writeFileSync(join(h.root, 'astra-commands.json'), 'invalid json', { mode: 0o600 });
  const broken = createRobotService(h.options);
  await assert.rejects(broken.submit({ action: 'check' }), /robot_storage_unavailable/);
  await broken.submit({ action: 'stop' });
  assert.equal(h.calls[h.calls.length - 1]?.operation, 'stop');
  broken.dispose();
});

test('a status response from before a stop cannot restore connected state', async (t) => {
  const pending = deferred();
  const h = await harness(t, async (_config, call) => (call.operation === 'status' ? pending.promise : success));
  const checking = h.service.submit({ action: 'check' });
  await h.service.submit({ action: 'stop' });
  pending.resolve(healthy);
  await checking;
  assert.equal(h.service.snapshot().connected, false);
});

test('an externally started movement revokes an outstanding authorization', async (t) => {
  let code = 520000;
  const h = await harness(t, async () => ({ ...healthy, telemetry: { ...healthy.telemetry!, actionCode: code } }));
  await h.arm();
  code = 520001;
  await h.service.submit({ action: 'check' });
  assert.equal(h.service.snapshot().armed, false);
  await assert.rejects(h.execute(), /robot_not_armed/);
  assert.equal(
    h.calls.some((call) => call.operation === 'execute'),
    false,
  );
});

test('host shutdown awaits the independent stop response for an outstanding command', async (t) => {
  const movement = deferred();
  const stop = deferred();
  const h = await harness(t, async (_config, call) =>
    call.operation === 'status' ? healthy : call.operation === 'execute' ? movement.promise : stop.promise,
  );
  await h.arm();
  await h.execute();
  let disposed = false;
  const shutdown = h.service.dispose().then(() => {
    disposed = true;
  });
  await setImmediate();
  assert.equal(disposed, false);
  assert.equal(h.calls[h.calls.length - 1].operation, 'stop');
  stop.resolve(success);
  await shutdown;
  assert.equal(disposed, true);
  movement.resolve(success);
  await setImmediate();
  assert.equal(h.service.snapshot().commands[0].state, 'unknown');
});
