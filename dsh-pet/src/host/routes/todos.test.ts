/**
 * Unit test of / todos route processor - verify protocol boundary: ① The response shape of the addition, deletion,
 * modification and HTTP semantics (business failure 200, protocol failure reserved 4 xx); ② Input verification (empty
 * text, over-long text, invalid expiration time, PATCH has no fields, body exceeds the limit); ③ Takeover only todos
 * prefix, other paths return undefined to let the next processor take over.
 *
 * Does not cover the real HTTP pipeline (read body, write response): that is / state The host layer common to this
 * test, see src/host/routes.test.ts. Running method: node --experimental-strip-types --test
 * src/host/routes/todos.test.ts
 */
import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { handleTodoRoutes } from './todos.ts';
import { TodoStore } from '../todo/store.ts';
import { TODO_BODY_MAX_BYTES } from '../todo/types.ts';
import type { RouteResult } from '../http.ts';
import type { PetRouteDeps } from './types.ts';

let dir = '';
let file = '';
let caseSeq = 0;
let clock = 1_000_000;
let store: TodoStore;

/** route read-only deps.todos and deps.log: The other fields are not involved in this field and are not constructed in the test. */
const deps = (): PetRouteDeps => ({ todos: store, log: { warn: () => undefined } }) as unknown as PetRouteDeps;

/** Adjust the processor once; rest prefix has been removed. */
function call(method: string, rest: string, body?: string): Promise<RouteResult | undefined> {
  return handleTodoRoutes(deps(), { url: new URL('http://localhost/'), rest, method, body });
}

/** The assertion is JSON response and the status code and response body are taken out. */
function asJson(result: RouteResult | undefined): { status: number; obj: Record<string, unknown> } {
  assert.ok(result !== undefined, 'The processor should respond');
  assert.equal(result.kind, 'json');
  return { status: result.status, obj: result.obj as Record<string, unknown> };
}

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'dsh-pet-todo-route-'));
});

beforeEach(() => {
  clock = 1_000_000;
  caseSeq += 1;
  file = join(dir, `todos-${caseSeq}.json`);
  store = new TodoStore({ file, log: { warn: () => undefined }, now: () => clock });
});

after(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('handleTodoRoutes——Path ownership', () => {
  test('Non-todos prefix → undefined (hand to next processor)', async () => {
    assert.equal(await call('GET', 'state'), undefined);
    assert.equal(await call('GET', 'todosomething'), undefined);
  });
});

describe('handleTodoRoutes - Read and Build', () => {
  test('GET empty list → 200 + empty array', async () => {
    const { status, obj } = asJson(await call('GET', 'todos'));
    assert.equal(status, 200);
    assert.deepEqual(obj, { ok: true, todos: [] });
  });

  test('POST Create an article: The text has been trim, and it will be brought back as it is when it expires.', async () => {
    const { status, obj } = asJson(await call('POST', 'todos', JSON.stringify({ text: '  交周报  ', dueAt: 5_000 })));
    assert.equal(status, 200);
    const todo = obj.todo as Record<string, unknown>;
    assert.equal(todo.text, '交周报');
    assert.equal(todo.dueAt, 5_000);
    assert.equal(todo.done, false);
    const listed = asJson(await call('GET', 'todos')).obj.todos as unknown[];
    assert.equal(listed.length, 1);
  });

  test('POST without dueAt → No expiration date', async () => {
    const todo = asJson(await call('POST', 'todos', JSON.stringify({ text: '记一下' }))).obj.todo as Record<
      string,
      unknown
    >;
    assert.equal(todo.dueAt, null);
  });

  test('POST empty text / extra long text / invalid dueAt → 200 + bad-request', async () => {
    for (const body of [
      JSON.stringify({ text: '   ' }),
      JSON.stringify({ text: 'x'.repeat(201) }),
      JSON.stringify({ text: '正常', dueAt: 'soon' }),
      JSON.stringify({ text: '正常', dueAt: {} }),
    ]) {
      const { status, obj } = asJson(await call('POST', 'todos', body));
      assert.equal(status, 200);
      assert.equal(obj.ok, false);
      assert.equal(obj.reason, 'bad-request');
    }
  });

  test('POST invalid JSON / array body → 400 invalid-json', async () => {
    for (const body of ['not json', '[1,2]']) {
      const { status, obj } = asJson(await call('POST', 'todos', body));
      assert.equal(status, 400);
      assert.equal(obj.reason, 'invalid-json');
    }
  });

  test('Request body exceeds limit → 413 payload-too-large', async () => {
    const body = JSON.stringify({ text: 'x'.repeat(TODO_BODY_MAX_BYTES) });
    const result = await call('POST', 'todos', body);
    const { status, obj } = asJson(result);
    assert.equal(status, 413);
    assert.equal(obj.reason, 'payload-too-large');
  });
});

describe('handleTodoRoutes——Change and delete', () => {
  test('PATCH check completed → done and completedAt are returned together', async () => {
    const created = asJson(await call('POST', 'todos', JSON.stringify({ text: '回邮件' }))).obj.todo as Record<
      string,
      unknown
    >;
    clock += 1000;
    const { status, obj } = asJson(await call('PATCH', `todos/${String(created.id)}`, JSON.stringify({ done: true })));
    assert.equal(status, 200);
    const todo = obj.todo as Record<string, unknown>;
    assert.equal(todo.done, true);
    assert.equal(todo.completedAt, clock);
  });

  test('PATCH Unknown → 200 + todo-not-found', async () => {
    const { obj } = asJson(await call('PATCH', 'todos/todo-missing', JSON.stringify({ done: true })));
    assert.equal(obj.ok, false);
    assert.equal(obj.reason, 'todo-not-found');
  });

  test('PATCH does not have any field/field is invalid → bad-request', async () => {
    const created = asJson(await call('POST', 'todos', JSON.stringify({ text: '散步' }))).obj.todo as Record<
      string,
      unknown
    >;
    const id = String(created.id);
    for (const body of ['{}', JSON.stringify({ done: 'yes' }), JSON.stringify({ text: '' })]) {
      const { obj } = asJson(await call('PATCH', `todos/${id}`, body));
      assert.equal(obj.ok, false);
      assert.equal(obj.reason, 'bad-request');
    }
  });

  test('DELETE is idempotent: removed =1 for the first time, removed =0 for the second time', async () => {
    const created = asJson(await call('POST', 'todos', JSON.stringify({ text: '倒垃圾' }))).obj.todo as Record<
      string,
      unknown
    >;
    const id = String(created.id);
    assert.equal(asJson(await call('DELETE', `todos/${id}`)).obj.removed, 1);
    assert.equal(asJson(await call('DELETE', `todos/${id}`)).obj.removed, 0);
  });

  test('Invalid id and method → Business/protocol failures have their own shapes', async () => {
    assert.equal(asJson(await call('DELETE', 'todos/a/b')).obj.reason, 'bad-request');
    const { status, obj } = asJson(await call('GET', 'todos/todo-1'));
    assert.equal(status, 405);
    assert.equal(obj.reason, 'method-not-allowed');
  });
});
