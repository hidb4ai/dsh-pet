/** Persist bounded robot receipts; unfinished commands become uncertain after a host restart. */
import { z } from 'zod';
import { readPrivateJson, writePrivateJson } from '../../standalone/ai-storage.ts';
import type { RobotCommand } from '../../shared/robot.ts';

const receipt = z.object({
  id: z.string().uuid(),
  fingerprint: z.string().length(64),
  kind: z.enum(['execute', 'speak']),
  key: z.string().max(80),
  petId: z.string().max(128),
  state: z.enum(['running', 'reported-success', 'failed', 'unknown']),
  startedAt: z.number(),
  finishedAt: z.number().optional(),
  message: z.string().max(1000),
});

/** Fingerprints detect reuse of a request ID with different operation contents. */
export type RobotReceipt = RobotCommand & { fingerprint: string };

/** Read the latest receipts; no interrupted operation is replayed. */
export function readRobotJournal(file: string): RobotReceipt[] {
  const value = readPrivateJson(file);
  if (value === undefined) return [];
  return z
    .array(receipt)
    .max(20)
    .parse(value)
    .map((item) =>
      item.state === 'running'
        ? { ...item, state: 'unknown', message: 'Host restarted before the result was confirmed.' }
        : item,
    );
}

/** Retain up to twenty receipts within the private store's 32 KiB read limit. */
export function writeRobotJournal(file: string, receipts: RobotReceipt[]): void {
  const recent = receipts.slice(-20);
  while (recent.length > 1 && Buffer.byteLength(JSON.stringify(recent, null, 2) + '\n') > 30_000) recent.shift();
  writePrivateJson(file, recent);
}
