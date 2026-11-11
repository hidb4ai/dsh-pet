/** Manageable long-term memory; input parameter does not accept scope, URL or free request path. */
import { z } from 'zod';
import { readAllConfig } from '../config.ts';
import { memoryErrorCode } from '../powercontext.ts';
import type { RouteHandler } from './types.ts';
import { failResult, methodNotAllowed, okResult } from './result.ts';

const idSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[\x21-\x7e]+$/);
const version = { id: idSchema, revision: z.number().int().positive(), stateVersion: z.number().int().nonnegative() };
const changeSchema = z.discriminatedUnion('action', [
  z.object({ ...version, action: z.literal('forget') }).strict(),
  z
    .object({
      ...version,
      action: z.literal('correct'),
      text: z
        .string()
        .trim()
        .min(1)
        .refine((text) => Buffer.byteLength(text, 'utf8') <= 8192),
    })
    .strict(),
]);

export const handleMemoryLibraryRoutes: RouteHandler = async (deps, { rest, method, url, body }) => {
  if (rest !== 'chat/powercontext/memories') return undefined;
  if (method !== 'GET' && method !== 'POST') return methodNotAllowed();
  const who = deps.requirePet(url.searchParams, () => readAllConfig(deps.configPaths));
  if (!who.ok) return who.res;
  if (!deps.listMemories || !deps.inspectMemory || !deps.changeMemory)
    return failResult('generate-error', 'memory_unavailable');
  try {
    if (method === 'POST') {
      let input: unknown;
      try {
        input = JSON.parse(body ?? 'null');
      } catch {
        return failResult('bad-request', 'invalid_memory_change');
      }
      const change = changeSchema.safeParse(input);
      if (!change.success) return failResult('bad-request', 'invalid_memory_change');
      await deps.changeMemory(who.petId, change.data);
      return okResult({ ok: true });
    }
    const id = url.searchParams.get('id');
    if (id !== null) {
      if (!idSchema.safeParse(id).success) return failResult('bad-request', 'invalid_memory_id');
      return okResult({ ok: true, evidence: await deps.inspectMemory(who.petId, id) });
    }
    const cursor = url.searchParams.get('cursor') ?? undefined;
    if (cursor && cursor.length > 4096) return failResult('bad-request', 'invalid_memory_cursor');
    return okResult({ ok: true, ...(await deps.listMemories(who.petId, cursor)) });
  } catch (error) {
    // The error code is for client translation; no model text, service credentials or underlying exceptions are returned.
    return failResult('generate-error', memoryErrorCode(error));
  }
};
