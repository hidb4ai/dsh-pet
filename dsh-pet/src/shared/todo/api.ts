/**
 * Browser-side encapsulation of to-do interface: fetch list, create, modify, delete.
 *
 * Only do HTTP and response narrowing, without touching DOM; fail to unify into `{ ok: false, message }` and let the
 * panel display as it is. The data has only one outlet: `/todos` : after the modification is successful, the caller
 * will pull the list again, without relying on local assemble to guess the result.
 * @module dsh-pet/src/shared/todo/api
 */
import { ROUTE_PATH } from '../constants.ts';
import { parseTodoItem, parseTodoList, type TodoItem } from './types.ts';

/** Base address of the pending interface (same prefix as host route). */
export const TODOS_PATH = ROUTE_PATH + '/todos';

/** The conclusion of a call: if successful, the parsed value will be provided; if failed, a Chinese reason that can be directly displayed will be provided. */
export type TodoResult<T> = { ok: true; value: T } | { ok: false; message: string };

/** Internal: The response body when HTTP is successful and the service is ok. */
type OkBody = Record<string, unknown>;

/** Internal transmission conclusion: use independent discrimination field to avoid collision with `ok` of the business body. */
type SendResult = { failed: false; body: OkBody } | { failed: true; message: string };

/** Send a request and narrow the outermost layer: protocol failure, business failure, and non-JSON are all classified as failures. */
async function send(url: string, method: string, body?: unknown): Promise<SendResult> {
  try {
    const response = await fetch(url, {
      method,
      cache: 'no-store',
      ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    });
    const payload = (await response.json().catch(() => null)) as OkBody | null;
    if (!response.ok) return { failed: true, message: `请求失败（HTTP ${response.status}）` };
    if (payload === null) return { failed: true, message: '响应不是 JSON' };
    if (payload.ok === false) {
      const reason = typeof payload.message === 'string' ? payload.message : payload.reason;
      return { failed: true, message: typeof reason === 'string' && reason !== '' ? reason : '请求被拒绝' };
    }
    return { failed: false, body: payload };
  } catch (error) {
    return { failed: true, message: '连不上桌宠服务：' + (error instanceof Error ? error.message : String(error)) };
  }
}

/** Single response → To-do; displayable failure is given when the shape is wrong. */
function readTodo(body: OkBody): TodoResult<TodoItem> {
  const todo = parseTodoItem(body.todo);
  return todo === null ? { ok: false, message: '响应里没有有效的待办' } : { ok: true, value: todo };
}

/** Read the entire list. */
export async function loadTodos(baseUrl = TODOS_PATH): Promise<TodoResult<TodoItem[]>> {
  const result = await send(baseUrl, 'GET');
  if (result.failed) return { ok: false, message: result.message };
  return { ok: true, value: parseTodoList(result.body.todos) };
}

/** Create a new one; `dueAt` is null, which means there is no deadline. */
export async function addTodo(text: string, dueAt: number | null, baseUrl = TODOS_PATH): Promise<TodoResult<TodoItem>> {
  const result = await send(baseUrl, 'POST', { text, dueAt });
  if (result.failed) return { ok: false, message: result.message };
  return readTodo(result.body);
}

/** Modify one item: only transmit the fields to be changed. */
export async function patchTodo(
  id: string,
  patch: { text?: string; dueAt?: number | null; done?: boolean },
  baseUrl = TODOS_PATH,
): Promise<TodoResult<TodoItem>> {
  const result = await send(baseUrl + '/' + encodeURIComponent(id), 'PATCH', patch);
  if (result.failed) return { ok: false, message: result.message };
  return readTodo(result.body);
}

/** Delete an item; return the number of deleted items (0 = none). */
export async function removeTodo(id: string, baseUrl = TODOS_PATH): Promise<TodoResult<number>> {
  const result = await send(baseUrl + '/' + encodeURIComponent(id), 'DELETE');
  if (result.failed) return { ok: false, message: result.message };
  return { ok: true, value: typeof result.body.removed === 'number' ? result.body.removed : 0 };
}
