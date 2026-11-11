/**
 * Backlog route: `GET/POST /todos` and `PATCH/DELETE /todos/{id}` .
 *
 * It only parses and verifies the input, and all accesses are `deps.todos` ; disk writing failures are normalized to
 * `internal-error` , and the path is not brought into the response. The business conclusion is always 200 (consistent
 * with other action endpoints), and only protocol errors (method, JSON, body exceeded) retain the real status code.
 * @module dsh-pet/src/host/routes/todos
 */
import { failResult, invalidJson, methodNotAllowed, okResult, payloadTooLarge } from './result.ts';
import { normalizeTodoDueAt, normalizeTodoText, TODO_BODY_MAX_BYTES, TODO_TEXT_MAX } from '../todo/types.ts';
import type { RouteResult } from '../http.ts';
import type { TodoPatch } from '../todo/store.ts';
import type { PetRouteDeps, RouteInput } from './types.ts';

/** Path prefix: `todos` or `todos/<id>`. */
const PREFIX = 'todos';

/** Short alias of Object.prototype.hasOwnProperty: PATCH. It is necessary to separate "not passed" from "passed null". */
const has = (source: Record<string, unknown>, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(source, key);

/** Parsing request body: not JSON object → null. */
function parseObjectBody(body: string | undefined): Record<string, unknown> | null {
  if (body === undefined) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  return parsed as Record<string, unknown>;
}

/**
 * Field verification of PATCH: The keys that appear are verified one by one, and any invalid packet is rejected.
 *
 * @param raw - The parsed request body.
 * @returns A collection of fields to be written; if there are no writable fields, an empty object is returned.
 */
function readPatch(raw: Record<string, unknown>): TodoPatch | null {
  const patch: TodoPatch = {};
  if (has(raw, 'text')) {
    const text = normalizeTodoText(raw.text);
    if (text === null) return null;
    patch.text = text;
  }
  if (has(raw, 'dueAt')) {
    const due = normalizeTodoDueAt(raw.dueAt);
    if (!due.ok) return null;
    patch.dueAt = due.value;
  }
  if (has(raw, 'done')) {
    if (typeof raw.done !== 'boolean') return null;
    patch.done = raw.done;
  }
  return patch;
}

/** To-do field: undefined is returned for misses and response is returned for hits. */
export async function handleTodoRoutes(deps: PetRouteDeps, input: RouteInput): Promise<RouteResult | undefined> {
  const { body, method, rest } = input;
  if (rest !== PREFIX && !rest.startsWith(PREFIX + '/')) return undefined;
  const { log, todos } = deps;

  try {
    if (rest === 'todos') {
      if (method === 'GET') return okResult({ ok: true, todos: await todos.list() });
      if (method !== 'POST') return methodNotAllowed();
      if (Buffer.byteLength(body ?? '', 'utf8') > TODO_BODY_MAX_BYTES) return payloadTooLarge();
      const raw = parseObjectBody(body);
      if (raw === null) return invalidJson();
      const text = normalizeTodoText(raw.text);
      if (text === null) return failResult('bad-request', `text 必须是非空字符串，最多 ${TODO_TEXT_MAX} 个字符`);
      const due = normalizeTodoDueAt(raw.dueAt);
      if (!due.ok) return failResult('bad-request', 'dueAt 必须是毫秒时间戳或 null');
      return okResult({ ok: true, todo: await todos.create({ text, dueAt: due.value }) });
    }

    // / todos /{ id }: id is an identifier within the instance, not a file path; only shape verification is performed.
    const id = rest.slice(PREFIX.length + 1);
    if (id === '' || id.includes('/')) return failResult('bad-request', 'todo id 不合法');

    if (method === 'PATCH') {
      if (Buffer.byteLength(body ?? '', 'utf8') > TODO_BODY_MAX_BYTES) return payloadTooLarge();
      const raw = parseObjectBody(body);
      if (raw === null) return invalidJson();
      const patch = readPatch(raw);
      if (patch === null) return failResult('bad-request', 'text / dueAt / done 至少一个字段不合法');
      if (Object.keys(patch).length === 0) return failResult('bad-request', '没有可更新的字段');
      const todo = await todos.update(id, patch);
      if (todo === null) return failResult('todo-not-found', '没有这条待办');
      return okResult({ ok: true, todo });
    }

    if (method === 'DELETE') return okResult({ ok: true, removed: await todos.remove(id) });

    return methodNotAllowed();
  } catch (error) {
    // Failed to write to disk (disk full/permissions): Only the real reason will be entered in the log, and only the classified copy will be returned in the response.
    log.warn(`[dsh-pet] To-do storage operation failed: ${error instanceof Error ? error.message : String(error)}`);
    return failResult('internal-error', 'dsh-pet: 待办读写失败');
  }
}
