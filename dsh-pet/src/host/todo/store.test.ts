/**
 * Unit test of to-do persistence - verify four things: ① The semantics of creating/modifying/deleting/recording
 * reminders, especially "changing the deadline and reopening will reset the reminder schedule"; ② The disk is the only
 * truth: changing to a new instance can still read back the same to-do, and the file has a version number; ③ All
 * operations are serial: concurrency creation does not lose records, id does not repeat; ④ Bad files will not explode:
 * If the parsing fails, continue with the empty list and leave an warning, and the next write will naturally overwrite
 * it.
 *
 * Running method: node --experimental-strip-types --test src/host/todo/store.test.ts
 */
import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { TodoStore, type TodoStoreOptions } from './store.ts';
import { TODO_FILE_VERSION } from './types.ts';

/** Warning exit: Collect assertion "bad files leave traces" and do not really write logs. */
const warnings: string[] = [];
const log = { warn: (message: string) => warnings.push(message) };

let dir = '';
/** Fixed clock: Test your own progress and avoid relying on real time. */
let clock = 1_000_000;
/** Each use case has an independent file and does not mix data with each other. */
let file = '';
let caseSeq = 0;

/** Create a temporary file store with a fixed clock and the current use case. */
function makeStore(overrides: Partial<TodoStoreOptions> = {}): TodoStore {
  return new TodoStore({ file, log, now: () => clock, ...overrides });
}

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'dsh-pet-todo-'));
});

beforeEach(() => {
  clock = 1_000_000;
  caseSeq += 1;
  file = join(dir, `todos-${caseSeq}.json`);
  warnings.length = 0;
});

after(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('TodoStore —— Add, delete, modify and check', () => {
  test('After creation, it can be read back: unfinished, not reminded, with creation time', async () => {
    const store = makeStore();
    const created = await store.create({ text: '交周报', dueAt: 2_000_000 });
    assert.equal(created.text, '交周报');
    assert.equal(created.dueAt, 2_000_000);
    assert.equal(created.done, false);
    assert.equal(created.createdAt, clock);
    assert.equal(created.lastRemindedAt, null);
    const list = await store.list();
    assert.deepEqual(
      list.map((item) => item.id),
      [created.id],
    );
  });

  test('The persist to disk file has a version number, and the new instance can read back the same one.', async () => {
    const store = makeStore();
    const created = await store.create({ text: '买菜', dueAt: null });
    const raw = JSON.parse(readFileSync(file, 'utf8')) as { version: number; todos: Array<{ id: string }> };
    assert.equal(raw.version, TODO_FILE_VERSION);
    assert.equal(raw.todos[0]?.id, created.id);
    const reloaded = await makeStore().list();
    assert.deepEqual(
      reloaded.map((item) => item.id),
      [created.id],
    );
  });

  test('Completed → Remember completedAt; Reopen → Clear completion time and reset reminder', async () => {
    const store = makeStore();
    const created = await store.create({ text: '回邮件', dueAt: null });
    await store.markReminded(created.id, clock);
    clock += 1000;
    const done = await store.update(created.id, { done: true });
    assert.equal(done?.done, true);
    assert.equal(done?.completedAt, clock);
    clock += 1000;
    const reopened = await store.update(created.id, { done: false });
    assert.equal(reopened?.done, false);
    assert.equal(reopened?.completedAt, null);
    assert.equal(reopened?.lastRemindedAt, null);
  });

  test('Changing the deadline will clear the last reminder time and reschedule according to the new deadline.', async () => {
    const store = makeStore();
    const created = await store.create({ text: '体检', dueAt: 9_000_000 });
    await store.markReminded(created.id, clock);
    const moved = await store.update(created.id, { dueAt: 8_000_000, text: '体检（改约）' });
    assert.equal(moved?.dueAt, 8_000_000);
    assert.equal(moved?.text, '体检（改约）');
    assert.equal(moved?.lastRemindedAt, null);
  });

  test('Update non-existent id → null; delete idempotent', async () => {
    const store = makeStore();
    assert.equal(await store.update('todo-missing', { done: true }), null);
    assert.equal(await store.remove('todo-missing'), 0);
    const created = await store.create({ text: '倒垃圾', dueAt: null });
    assert.equal(await store.remove(created.id), 1);
    assert.equal(await store.remove(created.id), 0);
    assert.equal((await store.list()).length, 0);
  });

  test('markReminded only activates the reminder time, but does not advance updatedAt', async () => {
    const store = makeStore();
    const created = await store.create({ text: '浇水', dueAt: 5_000_000 });
    const at = created.updatedAt + 500;
    await store.markReminded(created.id, at);
    const list = await store.list();
    assert.equal(list[0]?.lastRemindedAt, at);
    assert.equal(list[0]?.updatedAt, created.updatedAt);
  });
});

describe('TodoStore - Sorting and concurrency', () => {
  test('Unfinished first, in order of expiration, indefinite, last', async () => {
    const store = makeStore();
    const undated = await store.create({ text: '无期限', dueAt: null });
    const late = await store.create({ text: '晚点', dueAt: 3_000_000 });
    const early = await store.create({ text: '早点', dueAt: 2_000_000 });
    await store.update(late.id, { done: true });
    const list = await store.list();
    assert.deepEqual(
      list.map((item) => item.text),
      ['早点', '无期限', '晚点'],
    );
    assert.equal(list[0]?.id, early.id);
    assert.equal(list[1]?.id, undated.id);
    assert.equal(list[2]?.done, true);
  });

  test('Concurrency creation does not lose records and id is unique', async () => {
    const store = makeStore();
    const created = await Promise.all(
      Array.from({ length: 20 }, (_, index) => store.create({ text: `事项${index}`, dueAt: null })),
    );
    assert.equal(new Set(created.map((item) => item.id)).size, 20);
    assert.equal((await makeStore().list()).length, 20);
  });
});

describe('TodoStore - Bad file', () => {
  test('When JSON is broken, press the empty list to continue and leave an warning.', async () => {
    writeFileSync(file, '{ not json', 'utf8');
    const store = makeStore();
    assert.deepEqual(await store.list(), []);
    assert.ok(warnings.some((line) => line.includes('Could not parse the to-do file')));
    // Natural overwrite on next write: no more bad files
    await store.create({ text: '恢复', dueAt: null });
    assert.equal((await store.list()).length, 1);
    assert.doesNotThrow(() => JSON.parse(readFileSync(file, 'utf8')));
  });

  test('Entries with invalid fields are discarded entirely, and valid entries are retained.', async () => {
    writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        todos: [
          { id: 'ok-1', text: '保留', dueAt: null, done: false, createdAt: 1, updatedAt: 1 },
          { id: 'bad id', text: '非法 id', dueAt: null },
          { id: 'ok-2', text: '   ', dueAt: null },
        ],
      }),
      'utf8',
    );
    const list = await makeStore().list();
    assert.deepEqual(
      list.map((item) => item.id),
      ['ok-1'],
    );
  });
});
