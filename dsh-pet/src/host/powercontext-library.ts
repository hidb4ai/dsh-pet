/** View, correct and forget PowerContext 1.5 atomic memory; all calls are limited to scope selected by host. */
import { z } from 'zod';
import type { MemoryChange, MemoryEvidence, MemoryPage } from '../shared/memory-library.ts';

export type MemoryRequest = (
  path: string,
  body: unknown,
  signal: AbortSignal,
  options?: { method?: 'GET' | 'POST' | 'PUT'; headers?: Record<string, string> },
) => Promise<Record<string, unknown>>;

const ref = z.object({
  family: z.literal('atomic-memory'),
  artifact_id: z.string().min(1).max(128),
  revision: z.number().int().positive(),
});
const state = z.object({ artifact: ref, state: z.string(), state_version: z.number().int().nonnegative() });
const record = state.extend({ kind: z.string(), text: z.string().max(8192) });
const pathFor = (scope: string, id: string): string =>
  '/v1/scopes/' + encodeURIComponent(scope) + '/artifacts/atomic-memory/' + encodeURIComponent(id);

/** Only active memory is listed for paging. Empty pages and service failures are displayed separately by the caller. */
export async function listRememberedFacts(
  request: MemoryRequest,
  scope: string,
  signal: AbortSignal,
  cursor?: string,
): Promise<MemoryPage> {
  const page = z
    .object({ items: z.array(record).max(10), next_cursor: z.string().nullable() })
    .parse(
      await request(
        '/v1/atomic-memory/list',
        { scope_id: scope, states: ['active'], limit: 10, ...(cursor ? { cursor } : {}) },
        signal,
      ),
    );
  return {
    items: page.items.map((item) => ({
      id: item.artifact.artifact_id,
      revision: item.artifact.revision,
      stateVersion: item.state_version,
      kind: item.kind,
      text: item.text,
    })),
    nextCursor: page.next_cursor,
  };
}

/** View the exact version of the source; retain identification when the source is temporarily unreadable, and do not forge excerpts. */
export async function inspectRememberedFact(
  request: MemoryRequest,
  scope: string,
  id: string,
  signal: AbortSignal,
): Promise<MemoryEvidence> {
  const artifact = z
    .object({
      revision: z.number().int().positive(),
      created_at: z.string().nullable().optional(),
      sources: z.array(z.object({ source_type: z.string(), source_id: z.string() })),
    })
    .parse(await request(pathFor(scope, id), undefined, signal, { method: 'GET' }));
  const sources = await Promise.all(
    artifact.sources.slice(0, 3).map(async (source) => {
      const view: MemoryEvidence['sources'][number] = { id: source.source_id, type: source.source_type };
      try {
        const value = await request(
          '/v1/scopes/' +
            encodeURIComponent(scope) +
            '/sources/' +
            encodeURIComponent(source.source_type) +
            '/' +
            encodeURIComponent(source.source_id),
          undefined,
          signal,
          { method: 'GET' },
        );
        view.excerpt = (
          typeof value.content === 'string' ? value.content : (JSON.stringify(value.content) ?? '')
        ).slice(0, 2000);
      } catch {
        /* Source read failure does not obscure the memory itself and source identification. */
      }
      return view;
    }),
  );
  return { revision: artifact.revision, createdAt: artifact.created_at ?? null, sources };
}

/** The content version CAS is used for correction, and the content and lifecycle dual version CAS is used for forgetting; forgetting will not physically delete the source. */
export async function changeRememberedFact(
  request: MemoryRequest,
  scope: string,
  change: MemoryChange,
  signal: AbortSignal,
): Promise<void> {
  const artifact = { family: 'atomic-memory', artifact_id: change.id, revision: change.revision };
  if (change.action === 'forget') {
    const result = z.object({ records: z.array(state) }).parse(
      await request(
        '/v1/atomic-memory/lifecycle',
        {
          scope_id: scope,
          target: { artifact, state_version: change.stateVersion },
          state: 'forgotten',
        },
        signal,
      ),
    );
    if (!result.records.some((item) => item.artifact.artifact_id === change.id && item.state === 'forgotten'))
      throw new Error('forget_not_confirmed');
    return;
  }
  const current = state.parse(
    await request(pathFor(scope, change.id) + '/state', undefined, signal, { method: 'GET' }),
  );
  if (
    current.state !== 'active' ||
    current.state_version !== change.stateVersion ||
    current.artifact.revision !== change.revision
  )
    throw new Error('memory_changed');
  const content = z
    .object({ content: z.object({ kind: z.string() }) })
    .parse(await request(pathFor(scope, change.id), undefined, signal, { method: 'GET' }));
  const saved = await request(
    pathFor(scope, change.id),
    { content: { kind: content.content.kind, text: change.text } },
    signal,
    { method: 'PUT', headers: { 'If-Match': '"revision:' + change.revision + '"' } },
  );
  if (saved.artifact_id !== change.id || saved.revision !== change.revision + 1)
    throw new Error('correction_not_confirmed');
}
