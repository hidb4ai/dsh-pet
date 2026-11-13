/** Keep multi-byte controller messages within the private file reader's byte limit. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readRobotJournal, writeRobotJournal, type RobotReceipt } from './journal.ts';

test('large Unicode receipts remain readable after restart and keep the latest request', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'astra-journal-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = join(root, 'receipts.json');
  const receipts: RobotReceipt[] = Array.from({ length: 20 }, () => ({
    id: randomUUID(),
    fingerprint: 'a'.repeat(64),
    kind: 'execute',
    key: 'Synthetic action',
    petId: 'main',
    state: 'running',
    startedAt: 1,
    message: '\u72b6'.repeat(1000),
  }));
  writeRobotJournal(file, receipts);
  assert.ok(statSync(file).size < 32768);
  const restored = readRobotJournal(file);
  assert.equal(restored[restored.length - 1]?.id, receipts[receipts.length - 1]?.id);
  assert.equal(restored[restored.length - 1]?.state, 'unknown');
  assert.ok(restored.length > 1);
});
