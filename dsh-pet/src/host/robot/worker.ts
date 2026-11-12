/**
 * Execute one bounded SDK call in an isolated Python process.
 * Commands travel on stdin; shell interpolation and inherited Python paths are disabled.
 * Stop requests get their own process and never wait behind a movement RPC.
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { PACKAGE_ROOT } from '../paths.ts';
import type { RobotConfig, RobotResult } from '../../shared/robot.ts';
import { resolveRobotPython } from './python.ts';

/** The adapter only exposes reviewed high-level SDK operations. */
export interface RobotCall {
  operation: 'status' | 'execute' | 'speak' | 'stop';
  actionIds?: number[];
  requestId?: string;
  text?: string;
}

/** Injectable transport used by the host controller and its concurrency tests. */
export type RobotRunner = (config: RobotConfig, call: RobotCall, signal?: AbortSignal) => Promise<RobotResult>;

const resultSchema = z.object({
  ok: z.boolean(),
  code: z.string().max(80),
  message: z.string().max(1000),
  telemetry: z
    .object({
      actionCode: z.number().int(),
      description: z.string().max(500),
      modes: z.array(z.number().int()).length(3),
    })
    .optional(),
  stops: z.record(z.string(), z.object({ ok: z.boolean(), message: z.string().max(500) })).optional(),
});

/** Run the shipped adapter, also when its source resides inside an Electron ASAR. */
export const runRobotWorker: RobotRunner = (config, call, signal) =>
  new Promise((resolve) => {
    if (signal?.aborted) {
      resolve({ ok: false, code: 'cancelled', message: 'Request cancelled; robot state must be checked.' });
      return;
    }
    let script: string;
    try {
      script = readFileSync(join(PACKAGE_ROOT, 'runtime', 'astra', 'bridge.py'), 'utf8');
    } catch {
      resolve({ ok: false, code: 'adapter_missing', message: 'The Astra adapter is missing from this installation.' });
      return;
    }
    let python: string;
    try {
      python = resolveRobotPython(config.python);
    } catch (error) {
      resolve({ ok: false, code: 'bundled_runtime_unavailable', message: (error as Error).message });
      return;
    }
    const timeoutSeconds = call.operation === 'status' || call.operation === 'stop' ? 3 : config.timeoutSeconds;
    const child = spawn(python, ['-I', '-B', '-u', '-c', script], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let output = '';
    let settled = false;
    const finish = (result: RobotResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      resolve(result);
    };
    const abort = (): void => {
      child.kill('SIGKILL');
      finish({ ok: false, code: 'cancelled', message: 'Request cancelled; robot state must be checked.' });
    };
    const timer = setTimeout(
      () => {
        child.kill('SIGKILL');
        finish({ ok: false, code: 'timeout', message: 'Robot response timed out; movement may still be active.' });
      },
      (timeoutSeconds + 8) * 1000,
    );
    signal?.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      if (output.length > 32_768) {
        child.kill('SIGKILL');
        finish({ ok: false, code: 'invalid_response', message: 'Robot adapter response exceeded limits.' });
      }
    });
    // SDK diagnostics can contain local paths or request contents; only structured errors reach the UI.
    child.stderr.resume();
    child.stdin.on('error', () => {});
    child.on('error', () =>
      finish({ ok: false, code: 'python_unavailable', message: 'Cannot start the configured Python interpreter.' }),
    );
    child.on('close', () => {
      try {
        finish(resultSchema.parse(JSON.parse(output)));
      } catch {
        finish({ ok: false, code: 'invalid_response', message: 'Robot adapter did not return a valid response.' });
      }
    });
    child.stdin.end(JSON.stringify({ ...call, address: config.address, timeoutSeconds }));
  });
