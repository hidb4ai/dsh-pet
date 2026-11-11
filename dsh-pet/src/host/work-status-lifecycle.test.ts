/**
 * Lifecycle return of task details text (issue #59) - run the real event sequence at the handler layer and
 * assert the `/work-status` snapshot.
 *
 * Why there is this separate layer: The single test of `currentTaskFromTodo` / `WorkStatusStore` can only prove that
 * "pure logic is correct", and the on-site symptoms are all in the event sequence + lifecycle: ① In the staged task,
 * the text must follow the progress (when there are multiple in_progress, the last one is taken); ② After the
 * task is completed and a completely unrelated dialogue is opened, the bubble must not hang the old text (task)
 * Cannot be a global sticky field). Therefore, here we use the minimum ctx stub to really run the plugin (the same
 * stub idea as routes.test.ts), send a series of real events, and then use the GET endpoint to read the snapshot - if
 * it is repaired, it will ring on this test. Each use case is apply() a brand new instance to prevent use cases from
 * affecting each other.
 *
 * Running method: node --experimental-strip-types --test src/host/work-status-lifecycle.test.ts
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Writable } from 'node:stream';

import { apply } from './index.ts';

/** Working status snapshot (= data of sections.workStatus in S; ts has been replaced by leaf counter and no longer appears) */
type Snapshot = { state: string | null; task: string | null };
type Listener = (session: unknown, event: unknown) => void;
/** A plugin test example: sending events + reading snapshots + cleanup */
type Harness = {
  emit: (sessionId: string, event: Record<string, unknown>) => void;
  snapshot: () => Promise<Snapshot>;
  dispose: () => void;
};

let dir = '';
let savedHome: string | undefined;
let savedElectron: string | undefined;
/** All instances created in this file (unified release in after: apply() will now start the resident balance period timer) */
const harnesses: Harness[] = [];

/** Minimum response pile: writeHead records status code, Writable collects body */
class FakeRes extends Writable {
  declare status: number;
  declare chunks: Buffer[];
  constructor() {
    super();
    this.status = 0;
    this.chunks = [];
  }
  writeHead(status: number): this {
    this.status = status;
    return this;
  }
  _write(chunk: Buffer, _enc: BufferEncoding, cb: () => void): void {
    this.chunks.push(Buffer.from(chunk));
    cb();
  }
}

/** Create a new plugin instance (one copy for each use case, zero crosstalk between use cases) */
function setup(): Harness {
  let handler: ((req: unknown, res: unknown) => Promise<void>) | undefined;
  const listeners: Listener[] = [];
  const disposers: Array<() => void> = [];
  const noop = (): void => {};
  apply({
    // External Cordis service (ctx.provide): consistent with DSH, returns the release function
    provide: () => noop,
    effect: (fn: () => unknown) => {
      try {
        const ret = fn();
        if (typeof ret === 'function') disposers.push(ret as () => void);
        return ret;
      } catch {
        /* The built-in configuration is unreachable in source code form. refreshDesktop will be thrown to the caller - it will be swallowed here and will not affect the monitoring register. */
      }
    },
    on: (name: string, cb: Listener) => {
      if (name === 'session/event') listeners.push(cb);
      return noop;
    },
    webServer: { register: (spec: { handler: typeof handler }) => ((handler = spec.handler), noop) },
    commands: { register: () => noop },
    logger: { warn: () => {}, info: () => {}, debug: () => {}, error: () => {} },
    agentDefaultModel: { currentSelection: () => undefined },
    credentials: { resolve: async () => undefined },
  });
  assert.ok(handler, 'apply () should register / dsh-pet-7340 prefix handler');
  assert.ok(listeners.length > 0, 'apply () should listen for session/event');

  const harness: Harness = {
    emit: (sessionId, event) => {
      // Feed two listeners work-status and notify at the same time, which is consistent with the host behavior.
      for (const l of listeners) l({ header: { id: sessionId } }, event);
    },
    snapshot: () =>
      new Promise<Snapshot>((done) => {
        const res = new FakeRes();
        res.on('finish', () => {
          // The snapshot now lives in the sections.workStatus leaf of S (the /work-status endpoint was deleted):
          // reading it is also an end-to-end validation of the new link "Event → Write S → /state Readable".
          const body = JSON.parse(Buffer.concat(res.chunks).toString('utf8')) as {
            sections?: { workStatus?: { data?: Snapshot | null } };
          };
          done(body.sections?.workStatus?.data ?? { state: null, task: null });
        });
        void handler?.({ method: 'GET', url: '/dsh-pet-7340/state', on: noop }, res);
      }),
    dispose: () => {
      // Plugin cleanup: clear the timer to be executed (final state cleanup 60 s; balance cycle refresh is permanent)
      // - if it is not released, the test process will not exit after running. splice is taken and then executed:
      // repeating dispose is a safe no-op.
      for (const d of disposers.splice(0).reverse()) {
        try {
          d();
        } catch {
          /* Cleanup failure does not affect assertion */
        }
      }
    },
  };
  harnesses.push(harness);
  return harness;
}

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'dsh-pet-workstatus-'));
  savedHome = process.env.DSH_HOME;
  savedElectron = process.env.DSH_PET_ELECTRON_PATH;
  process.env.DSH_HOME = join(dir, 'home');
  // Hitting an existing file: Desktop Helper will not actually download/pull up no matter which branch you take.
  process.env.DSH_PET_ELECTRON_PATH = process.execPath;
});

after(() => {
  // Each use case apply() passes a new instance: it is released here uniformly (otherwise, resident handles such as
  // the balance cycle timer will drag the test process and not exit). You can also use dispose() by yourself in the
  // use case, and it is safe to call it repeatedly.
  for (const h of harnesses.splice(0)) h.dispose();
  if (savedHome === undefined) delete process.env.DSH_HOME;
  else process.env.DSH_HOME = savedHome;
  if (savedElectron === undefined) delete process.env.DSH_PET_ELECTRON_PATH;
  else process.env.DSH_PET_ELECTRON_PATH = savedElectron;
  rmSync(dir, { recursive: true, force: true });
});

const TURN_START = (seq: number): Record<string, unknown> => ({ type: 'turn/start', seq, data: { turn: seq } });
const TOOL_CALL = (seq: number): Record<string, unknown> => ({ type: 'tool/call', seq, data: { name: 'read' } });
const TURN_END = (seq: number, kind: string): Record<string, unknown> => ({
  type: 'turn/end',
  seq,
  data: { reason: { kind } },
});
const TODO = (seq: number, ...items: Array<[string, string]>): Record<string, unknown> => ({
  type: 'todo/write',
  seq,
  data: { todos: items.map(([status, content]) => ({ status, content })) },
});

const DETAILED_CALL = (seq: number, callId: string | undefined, file: string): Record<string, unknown> => ({
  type: 'tool/call',
  seq,
  data: { name: 'read', callId, arguments: JSON.stringify({ file_path: file }) },
});
/** The call identifier of the result event is in `message.source.callId` (required for `ToolMessageSource`), and `toolCallId` also saves a copy. */
const TOOL_RESULT = (seq: number, callId?: string): Record<string, unknown> => ({
  type: 'tool/result',
  seq,
  data: { message: { role: 'tool', source: { kind: 'tool', callId }, toolCallId: callId } },
});

describe('Parallel tool details and calls correspond to', () => {
  test('When the tool returns without details, the file operations still being executed will be retained, and the latest todo will be restored after all are completed.', async (t) => {
    let now = Date.now();
    t.mock.method(Date, 'now', () => now);
    const h = setup();
    t.after(h.dispose);
    h.emit('s', TURN_START(1));
    h.emit('s', TODO(2, ['in_progress', '原清单']));
    h.emit('s', DETAILED_CALL(3, 'read-A', 'active.ts'));
    h.emit('s', { type: 'tool/call', seq: 4, data: { name: 'get_goal', callId: 'goal-B', arguments: '{}' } });
    now += 6000; // Override the original state buffer and directly verify the final visible state
    h.emit('s', TOOL_RESULT(5, 'goal-B'));
    assert.equal((await h.snapshot()).state, 'working', 'Tool end without details should not end the work file');
    assert.match(
      (await h.snapshot()).task ?? '',
      /active\.ts/,
      'File operations that are still running should remain on the bubble',
    );
    h.emit('s', TODO(6, ['in_progress', '最新清单']));
    assert.match(
      (await h.snapshot()).task ?? '',
      /active\.ts/,
      'todo should not cover up the details that are still running.',
    );
    now += 6000;
    h.emit('s', TOOL_RESULT(7, 'read-A'));
    assert.deepEqual(
      await h.snapshot(),
      { state: 'result', task: '最新清单', sessionId: 's' },
      'After everything is finished, fallback to the latest todo',
    );
  });

  test('When the tool started last finishes first, another operation that is still being executed is immediately displayed.', async (t) => {
    const h = setup();
    t.after(h.dispose);
    h.emit('s', TURN_START(1));
    h.emit('s', DETAILED_CALL(2, 'read-A', 'active.ts'));
    h.emit('s', DETAILED_CALL(3, 'read-B', 'finished.ts'));
    h.emit('s', TOOL_RESULT(4, 'read-B'));
    assert.equal(
      (await h.snapshot()).state,
      'working',
      'There is still work to be done and the work file should be kept',
    );
    assert.match(
      (await h.snapshot()).task ?? '',
      /active\.ts/,
      'bubble should not continue to display the completed operation',
    );
  });

  test('When the tool started first is completed first, the remaining operations continue to display the working status.', async (t) => {
    let now = Date.now();
    t.mock.method(Date, 'now', () => now);
    const h = setup();
    t.after(h.dispose);
    h.emit('s', TURN_START(1));
    h.emit('s', DETAILED_CALL(2, 'read-A', 'finished.ts'));
    h.emit('s', DETAILED_CALL(3, 'read-B', 'active.ts'));
    now += 6000;
    h.emit('s', TOOL_RESULT(4, 'read-A'));
    assert.equal((await h.snapshot()).state, 'working', 'Finishing one first does not mean finishing them all');
    assert.match((await h.snapshot()).task ?? '', /active\.ts/, 'Should switch to the item that is still executing');
  });

  test('Unknown and duplicate results cannot remove details from other calls', async (t) => {
    let now = Date.now();
    t.mock.method(Date, 'now', () => now);
    const h = setup();
    t.after(h.dispose);
    h.emit('s', TURN_START(1));
    h.emit('s', DETAILED_CALL(2, 'read-A', 'finished.ts'));
    h.emit('s', DETAILED_CALL(3, 'read-B', 'active.ts'));
    h.emit('s', TOOL_RESULT(4, 'read-A'));
    now += 6000;
    for (const [seq, id] of [
      [5, 'read-A'],
      [6, 'unknown'],
    ] as const) {
      h.emit('s', TOOL_RESULT(seq, id));
      assert.equal(
        (await h.snapshot()).state,
        'working',
        `${id} is a duplicate or unknown result and must not end the working state`,
      );
      assert.match((await h.snapshot()).task ?? '', /active\.ts/, `${id} should not remove details of other calls`);
    }
  });

  test('Different sessions can use the same call ID', async (t) => {
    const h = setup();
    t.after(h.dispose);
    h.emit('a', TURN_START(1));
    h.emit('a', DETAILED_CALL(2, 'same-id', 'first.ts'));
    h.emit('b', TURN_START(3));
    h.emit('b', DETAILED_CALL(4, 'same-id', 'second.ts'));
    h.emit('b', TOOL_RESULT(5, 'same-id'));
    assert.equal(
      (await h.snapshot()).state,
      'working',
      'The b session is still alive and should not fallback to the completion file.',
    );
    assert.match(
      (await h.snapshot()).task ?? '',
      /first\.ts/,
      'The details of the a session should not be deleted by the b identifier.',
    );
  });

  for (const interrupted of [false, true]) {
    test(`${interrupted ? 'After a turn is interrupted' : 'When a new turn starts'}, clear unfinished tools from the previous turn`, async (t) => {
      let now = Date.now();
      t.mock.method(Date, 'now', () => now);
      const h = setup();
      t.after(h.dispose);
      h.emit('s', TURN_START(1));
      h.emit('s', DETAILED_CALL(2, 'old', 'old.ts'));
      if (interrupted) h.emit('s', TURN_END(3, 'aborted'));
      h.emit('s', TURN_START(4));
      h.emit('s', DETAILED_CALL(5, 'new', 'new.ts'));
      now += 6000;
      h.emit('s', TOOL_RESULT(6, 'new'));
      assert.deepEqual(
        await h.snapshot(),
        { state: 'result', task: null, sessionId: 's' },
        'Unfinished entries from the previous round should not be carried over to this round',
      );
    });
  }

  test('The result of missing call identification only releases unidentified calls and does not affect the identified tools.', async (t) => {
    const h = setup();
    t.after(h.dispose);
    h.emit('s', TURN_START(1));
    h.emit('s', DETAILED_CALL(2, 'identified', 'active.ts'));
    h.emit('s', DETAILED_CALL(3, undefined, 'anonymous.ts'));
    h.emit('s', TOOL_RESULT(4));
    assert.equal(
      (await h.snapshot()).state,
      'working',
      'The identified call is still running and the work file should be kept',
    );
    assert.match(
      (await h.snapshot()).task ?? '',
      /active\.ts/,
      'Missing identification results should not delete named call details',
    );
  });
});

describe('Task text lifecycle - On-site scene 1: Phased tasks', () => {
  test('The text follows the current step: when there are multiple in_progress, the last one is taken', async (t) => {
    const h = setup();
    t.after(h.dispose);

    h.emit('s1', TURN_START(1));
    const idle = await h.snapshot();
    assert.equal(idle.state, 'thinking');
    assert.equal(idle.task, null);

    h.emit('s1', TODO(2, ['in_progress', '正在执行 phase1']));
    assert.equal((await h.snapshot()).task, '正在执行 phase1');

    // agent also marked phase2 as in_progress but did not withdraw phase1: the last step in progress must be taken
    h.emit('s1', TODO(3, ['in_progress', '正在执行 phase1'], ['in_progress', '正在执行 phase2']));
    assert.equal((await h.snapshot()).task, '正在执行 phase2');

    // phase1/2 withdrawn, phase3 started
    h.emit(
      's1',
      TODO(4, ['completed', '正在执行 phase1'], ['completed', '正在执行 phase2'], ['in_progress', '正在执行 phase3']),
    );
    assert.equal((await h.snapshot()).task, '正在执行 phase3');
  });

  test('All items in the list are completed → text clear (fallback file text, workStatusTexts will no longer be permanently blocked)', async (t) => {
    const h = setup();
    t.after(h.dispose);
    h.emit('s2', TURN_START(1));
    h.emit('s2', TODO(2, ['in_progress', '做点什么']));
    assert.equal((await h.snapshot()).task, '做点什么');
    h.emit('s2', TODO(3, ['completed', '做点什么']));
    assert.equal((await h.snapshot()).task, null);
  });

  test('A new round of turn/start clears the details of the previous round; if you write todo in this round, it will be filled in immediately.', async (t) => {
    const h = setup();
    t.after(h.dispose);
    h.emit('s3', TURN_START(1));
    h.emit('s3', TODO(2, ['in_progress', '上一轮的任务']));
    assert.equal((await h.snapshot()).task, '上一轮的任务');
    h.emit('s3', TURN_END(3, 'completed'));
    h.emit('s3', TURN_START(4));
    assert.equal(
      (await h.snapshot()).task,
      null,
      'The new round must not continue to hang the details of the previous round.',
    );
    assert.equal((await h.snapshot()).state, 'thinking');
    h.emit('s3', TODO(5, ['in_progress', '本轮的任务']));
    assert.equal((await h.snapshot()).task, '本轮的任务');
  });
});

describe('Task text lifecycle - On-site scene 2: Permanent residue after the task ends', () => {
  test('Open an unrelated conversation after the task is completed: old copywriters are not allowed to follow.', async (t) => {
    const h = setup();
    t.after(h.dispose);
    h.emit('r1', TURN_START(1));
    h.emit('r1', TODO(2, ['in_progress', '早就做完的旧任务']));
    h.emit('r1', TURN_END(3, 'completed'));
    assert.equal(
      (await h.snapshot()).task,
      '早就做完的旧任务',
      'The last thing done is still displayed in the final state display window.',
    );

    // Completely unrelated new round: don’t write todo
    h.emit('r1', TURN_START(4));
    h.emit('r1', TOOL_CALL(5));
    h.emit('r1', TURN_END(6, 'completed'));
    const snap = await h.snapshot();
    assert.equal(snap.task, null, 'Old mission copy must not remain during irrelevant conversations');
    assert.equal(snap.state, 'success');
  });

  test('The round is interrupted (aborted) → the conversation entries and copy are cleared together, and the display returns to idle', async (t) => {
    const h = setup();
    t.after(h.dispose);
    h.emit('r2', TURN_START(1));
    h.emit('r2', TODO(2, ['in_progress', '被打断的任务']));
    h.emit('r2', TURN_END(3, 'aborted'));
    const snap = await h.snapshot();
    assert.equal(snap.state, null);
    assert.equal(snap.task, null);
  });

  test('After the final display window (60 s), the entries are cleared together with the copy.', async (t) => {
    const h = setup();
    t.after(h.dispose);
    h.emit('r3', TURN_START(1));
    h.emit('r3', TODO(2, ['in_progress', '完成即清的任务']));
    t.mock.timers.enable({ apis: ['setTimeout'] });
    t.after(() => t.mock.timers.reset());
    h.emit('r3', TURN_END(3, 'completed'));
    assert.equal((await h.snapshot()).task, '完成即清的任务');
    t.mock.timers.tick(60 * 1000);
    const snap = await h.snapshot();
    assert.equal(snap.state, null);
    assert.equal(snap.task, null);
  });

  test('Writing todo when there are no active entries in the session does not take effect (does not create ghost copy that will not be displayed)', async (t) => {
    const h = setup();
    t.after(h.dispose);
    h.emit('ghost', TODO(1, ['in_progress', '幽灵任务']));
    assert.equal((await h.snapshot()).task, null);
  });
});

describe('Task text lifecycle - multiple sessions without text', () => {
  test('Display the conversation with the highest priority, and the text will follow it (do not pretend to be the text of other conversations)', async (t) => {
    const h = setup();
    t.after(h.dispose);
    h.emit('m1', TURN_START(1));
    h.emit('m1', TOOL_CALL(2)); // working
    h.emit('m1', TODO(3, ['in_progress', 'M1 的任务']));
    assert.equal((await h.snapshot()).state, 'working');
    assert.equal((await h.snapshot()).task, 'M1 的任务');

    // m2 also enters working (seq is larger → the nearest one in the same file) → the display switches to m2; m2 has no details → task must be null
    h.emit('m2', TURN_START(4));
    h.emit('m2', TOOL_CALL(5));
    assert.equal((await h.snapshot()).state, 'working');
    assert.equal((await h.snapshot()).task, null, 'Do not use copywriting of m1 to impersonate m2');

    h.emit('m2', TODO(6, ['in_progress', 'M2 的任务']));
    assert.equal((await h.snapshot()).task, 'M2 的任务');

    // m2 round is interrupted → the entry is cleared, the display returns to m1, and the copy also returns to m1
    h.emit('m2', TURN_END(7, 'aborted'));
    const snap = await h.snapshot();
    assert.equal(snap.state, 'working');
    assert.equal(snap.task, 'M1 的任务');
  });
});
