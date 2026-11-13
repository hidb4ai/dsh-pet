/**
 * Own the optional robot connection, one-shot motion authorization and command receipts.
 * Calls never retry automatically; losing a result consumes authorization and leaves an unknown receipt.
 * Each stop runs independently of the command worker. Host restart always disarms control.
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { readPrivateJson, writePrivateJson } from '../../standalone/ai-storage.ts';
import type { RobotResult, RobotSnapshot } from '../../shared/robot.ts';
import { defaultRobotConfig, robotConfigSchema, robotRequestSchema, type RobotRequest } from './config.ts';
import { readRobotJournal, writeRobotJournal, type RobotReceipt } from './journal.ts';
import { runRobotWorker, type RobotRunner, type RobotCall } from './worker.ts';

/** Pet feedback is best-effort and never changes the recorded physical command result. */
export interface RobotFeedback {
  petId: string;
  text: string;
  animation?: string;
}

/** Controller lifecycle and user operations shared by both host modes. */
export interface RobotService {
  snapshot(): RobotSnapshot;
  submit(input: unknown): Promise<RobotSnapshot>;
  dispose(): Promise<void>;
}

/** Create a controller with an injectable SDK transport; no movement is sent during construction. */
export function createRobotService(options: {
  userRoot: string;
  run?: RobotRunner;
  feedback?: (event: RobotFeedback) => Promise<void>;
  now?: () => number;
  monitor?: boolean;
}): RobotService {
  const run = options.run ?? runRobotWorker;
  const now = options.now ?? Date.now;
  const configFile = join(options.userRoot, 'astra-robot.json');
  const journalFile = join(options.userRoot, 'astra-commands.json');
  let config = defaultRobotConfig();
  let receipts: RobotReceipt[] = [];
  let storageError = false;
  let error = '';
  try {
    const saved = readPrivateJson(configFile);
    if (saved !== undefined) config = robotConfigSchema.parse(saved);
    receipts = readRobotJournal(journalFile);
  } catch {
    storageError = true;
    error = 'robot_storage_unavailable';
  }
  let session = randomUUID();
  let armed = false;
  let disposed = false;
  let active: { receipt: RobotReceipt; abort: AbortController } | undefined;
  let checking = false;
  let stopping = false;
  let checkedAt = 0;
  let connected = false;
  let telemetry: RobotSnapshot['telemetry'];
  let stopResult: RobotResult | undefined;
  let stopOperation: Promise<RobotResult> | undefined;
  let statusAbort: AbortController | undefined;
  let previousDescription: string | undefined;
  const notify = (event: RobotFeedback): void => {
    void Promise.resolve()
      .then(() => options.feedback?.(event))
      .catch(() => {});
  };
  const snapshot = (): RobotSnapshot => ({
    session,
    config: structuredClone(config),
    armed,
    busy: !!active,
    checking,
    stopping,
    checkedAt,
    connected: connected && now() - checkedAt < 15_000,
    telemetry,
    error,
    stopResult,
    commands: receipts.slice(-20).map((item) => ({
      id: item.id,
      kind: item.kind,
      key: item.key,
      petId: item.petId,
      state: item.state,
      startedAt: item.startedAt,
      finishedAt: item.finishedAt,
      message: item.message,
    })),
  });
  const persist = (): void => {
    try {
      writeRobotJournal(journalFile, receipts);
    } catch {
      storageError = true;
      armed = false;
      error = 'robot_storage_unavailable';
      throw new Error(error);
    }
  };
  const check = async (): Promise<void> => {
    if (!config.enabled || checking || stopping || disposed || storageError) return;
    checking = true;
    statusAbort = new AbortController();
    try {
      const result = await run(config, { operation: 'status' }, statusAbort.signal);
      if (disposed || statusAbort.signal.aborted) return;
      checkedAt = now();
      connected = result.ok && !!result.telemetry;
      telemetry = result.telemetry;
      error = connected ? '' : result.code;
      if (!connected || telemetry?.actionCode !== 520000 || telemetry.modes.some((mode) => mode !== 1)) armed = false;
      const description = connected ? telemetry?.description : undefined;
      if (description && previousDescription !== undefined && description !== previousDescription)
        notify({ petId: config.petId, text: `Robot: ${description}` });
      previousDescription = description;
    } catch {
      connected = false;
      armed = false;
      error = 'robot_connection_failed';
    } finally {
      checking = false;
      statusAbort = undefined;
    }
  };
  const finish = async (item: RobotReceipt, call: RobotCall, abort: AbortController): Promise<void> => {
    let result: RobotResult;
    try {
      result = await run(config, call, abort.signal);
    } catch {
      result = { ok: false, code: 'transport_error', message: 'Execution state is unknown.' };
    }
    // A late successful response must not erase an operator stop or host shutdown.
    if (item.state === 'running') {
      item.state = result.ok
        ? 'reported-success'
        : result.code === 'rejected' || result.code === 'sdk_unavailable' || result.code === 'python_unavailable'
          ? 'failed'
          : 'unknown';
      item.message = result.message;
      item.finishedAt = now();
    }
    active = undefined;
    // The old idle sample must not authorize another motion after a command returns.
    statusAbort?.abort();
    connected = false;
    try {
      persist();
    } catch {
      /* The storage fault blocks future commands. */
    }
    if (!disposed) notify({ petId: item.petId, text: `Robot ${item.key}: ${item.state}. ${item.message}` });
  };
  const command = (request: Extract<RobotRequest, { action: 'execute' | 'speak' }>): void => {
    const action = request.action === 'execute' ? config.actions.find((item) => item.key === request.key) : undefined;
    if (request.action === 'execute' && !action) throw new Error('robot_unknown_action');
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          kind: request.action,
          address: config.address,
          pet: request.petId,
          payload: request.action === 'speak' ? request.text : action?.actionIds,
        }),
      )
      .digest('hex');
    const existing = receipts.find((item) => item.id === request.id);
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw new Error('robot_request_conflict');
      return;
    }
    if (active || stopping) throw new Error('robot_busy');
    if (!config.enabled || !snapshot().connected) throw new Error('robot_not_connected');
    if (request.action === 'execute' && !armed) throw new Error('robot_not_armed');
    if (
      request.action === 'execute' &&
      (telemetry?.actionCode !== 520000 || telemetry.modes.some((mode) => mode !== 1))
    )
      throw new Error('robot_not_ready');
    if (receipts.length >= 1000) throw new Error('robot_receipt_limit');
    armed = false;
    const item: RobotReceipt = {
      id: request.id,
      fingerprint,
      kind: request.action,
      key: action?.name ?? 'speech',
      petId: request.petId,
      state: 'running',
      startedAt: now(),
      message: '',
    };
    receipts.push(item);
    try {
      persist();
    } catch (cause) {
      item.state = 'failed';
      item.message = 'Receipt could not be saved; no command was sent.';
      item.finishedAt = now();
      throw cause;
    }
    const abort = new AbortController();
    statusAbort?.abort();
    connected = false;
    active = { receipt: item, abort };
    stopResult = undefined;
    const call: RobotCall =
      request.action === 'execute'
        ? { operation: 'execute', requestId: request.id, actionIds: action!.actionIds }
        : { operation: 'speak', text: request.text };
    notify({
      petId: request.petId,
      text: `Robot: ${item.key} requested.`,
      animation: action?.petAnimation || undefined,
    });
    void finish(item, call, abort);
  };
  const stop = async (): Promise<void> => {
    armed = false;
    if (stopping) return;
    if (!config.address) throw new Error('robot_address_required');
    stopping = true;
    statusAbort?.abort();
    if (active) {
      active.receipt.state = 'unknown';
      active.receipt.message = 'Stop requested; physical state must be verified.';
      active.receipt.finishedAt = now();
      active.abort.abort();
      try {
        persist();
      } catch {
        /* Storage failure must never prevent a stop request. */
      }
    }
    try {
      stopOperation = run(config, { operation: 'stop' });
      stopResult = await stopOperation;
    } catch {
      stopResult = {
        ok: false,
        code: 'stop_unconfirmed',
        message: 'Stop could not be confirmed. Check the robot locally.',
      };
    } finally {
      stopping = false;
      connected = false;
      stopOperation = undefined;
    }
    notify({ petId: config.petId, text: stopResult.message });
  };
  const timer = options.monitor === false ? undefined : setInterval(() => void check(), 5000);
  timer?.unref();
  return {
    snapshot,
    async submit(input) {
      const request = robotRequestSchema.parse(input);
      if (disposed) throw new Error('robot_disposed');
      if (request.action === 'stop') {
        await stop();
        return snapshot();
      }
      if (request.action === 'disarm') {
        armed = false;
        return snapshot();
      }
      if (storageError) throw new Error('robot_storage_unavailable');
      if ('session' in request && request.session !== session) throw new Error('robot_session_changed');
      if (request.action === 'configure') {
        if (active || checking || stopping) throw new Error('robot_busy');
        mkdirSync(options.userRoot, { recursive: true, mode: 0o700 });
        writePrivateJson(configFile, request.config);
        config = request.config;
        session = randomUUID();
        armed = connected = false;
        telemetry = undefined;
        stopResult = undefined;
        previousDescription = undefined;
        error = '';
      } else if (request.action === 'check') await check();
      else if (request.action === 'arm') {
        if (
          active ||
          stopping ||
          !config.enabled ||
          !snapshot().connected ||
          telemetry?.actionCode !== 520000 ||
          telemetry.modes.some((mode) => mode !== 1)
        )
          throw new Error('robot_not_ready');
        armed = true;
      } else command(request);
      return snapshot();
    },
    async dispose() {
      disposed = true;
      armed = false;
      clearInterval(timer);
      statusAbort?.abort();
      if (stopping) await stopOperation?.catch(() => {});
      else if (active) await stop();
    },
  };
}
