/**
 * 聊天面板中的记忆列表与编辑状态；只在用户展开后读取远端。
 * 依赖注入的 React 能力与翻译，不接触模型凭据或 scope。
 * 切换宠物时取消旧请求；服务确认成功前不得显示写入成功。
 */
import { ROUTE_PATH } from '../../shared/constants.ts';
import type { MemoryChange, MemoryEvidence, MemoryPage, RememberedFact } from '../../shared/memory-library.ts';
import type { ChatPanelRuntime } from './runtime.ts';

/** 自己采集的对话显示为人能读的问答；其他来源保留服务端摘录。 */
function evidenceText(excerpt: string | undefined, rt: ChatPanelRuntime): string {
  if (!excerpt) return rt.t('factsNoExcerpt');
  try {
    const parsed = JSON.parse(excerpt) as { kind?: unknown; occurred_at?: unknown; messages?: unknown };
    if (parsed.kind !== 'dsh-pet-dialogue' || !Array.isArray(parsed.messages)) return excerpt;
    const lines = parsed.messages.flatMap((item: unknown) => {
      const message = item as { role?: unknown; content?: unknown } | null;
      if (!message || typeof message.content !== 'string' || !['user', 'assistant'].includes(String(message.role)))
        return [];
      return [(message.role === 'user' ? rt.t('factsUser') : rt.t('factsPet')) + ': ' + message.content];
    });
    return lines.length
      ? [typeof parsed.occurred_at === 'string' ? parsed.occurred_at : '', ...lines].filter(Boolean).join('\n\n')
      : excerpt;
  } catch {
    return excerpt;
  }
}

async function request(
  petId: string,
  signal: AbortSignal,
  query = '',
  change?: MemoryChange,
): Promise<Record<string, unknown>> {
  const response = await fetch(ROUTE_PATH + '/chat/powercontext/memories?pet=' + encodeURIComponent(petId) + query, {
    method: change ? 'POST' : 'GET',
    cache: 'no-store',
    headers: change ? { 'Content-Type': 'application/json' } : undefined,
    body: change ? JSON.stringify(change) : undefined,
    signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
  });
  const data = (await response.json()) as Record<string, unknown>;
  if (!response.ok || data.ok !== true) throw new Error('memory_unavailable');
  return data;
}

/** 一条记忆的编辑与来源状态独立保存；列表重新加载时按版本重新挂载。 */
function makeFactCard(rt: ChatPanelRuntime) {
  const { h, t, useState, useEffect } = rt;
  return function FactCard({
    petId,
    fact,
    changed,
    changing,
  }: {
    petId: string;
    fact: RememberedFact;
    changed: () => void;
    changing: () => void;
  }) {
    const [mode, setMode] = useState<'view' | 'correct' | 'forget'>('view');
    const [draft, setDraft] = useState(fact.text);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [evidence, setEvidence] = useState<MemoryEvidence | null>(null);
    const [controller] = useState(new AbortController());
    useEffect(() => () => controller.abort(), [controller]);
    const inspect = async (): Promise<void> => {
      setBusy(true);
      setError('');
      try {
        const data = await request(petId, controller.signal, '&id=' + encodeURIComponent(fact.id));
        if (!controller.signal.aborted) setEvidence(data.evidence as MemoryEvidence);
      } catch {
        if (!controller.signal.aborted) setError(t('factsReadError'));
      } finally {
        if (!controller.signal.aborted) setBusy(false);
      }
    };
    const save = async (): Promise<void> => {
      if (mode === 'view') return;
      changing();
      setBusy(true);
      setError('');
      try {
        await request(petId, controller.signal, '', {
          action: mode,
          id: fact.id,
          revision: fact.revision,
          stateVersion: fact.stateVersion,
          ...(mode === 'correct' ? { text: draft.trim() } : {}),
        });
        if (!controller.signal.aborted) changed();
      } catch {
        if (!controller.signal.aborted) setError(t('factsWriteError'));
      } finally {
        if (!controller.signal.aborted) setBusy(false);
      }
    };
    const button = (label: string, action: () => void, disabled = false): unknown =>
      h('button', {
        type: 'button',
        disabled: busy || disabled,
        onClick: action,
        children: label,
      });
    return h('li', {
      className: 'pet-chat-fact',
      children: [
        h('p', { children: fact.text }),
        h('small', { children: t('factsRevision', { n: fact.revision }) }),
        h('div', {
          className: 'pet-chat-fact-actions',
          children: [
            button(t('factsSources'), () => void inspect()),
            button(t('factsCorrect'), () => {
              setMode('correct');
              setError('');
            }),
            button(t('factsForget'), () => {
              setMode('forget');
              setError('');
            }),
          ],
        }),
        evidence
          ? h('div', {
              className: 'pet-chat-fact-evidence',
              children: [
                h('p', { children: t('factsEvidenceNote') }),
                h('small', {
                  children:
                    t('factsRevision', { n: evidence.revision }) +
                    (evidence.createdAt ? ' · ' + evidence.createdAt : ''),
                }),
                ...evidence.sources.map((source, index) =>
                  h('details', {
                    key: source.type + source.id,
                    children: [
                      h('summary', { title: source.id, children: t('factsSourceNumber', { n: index + 1 }) }),
                      h('pre', { children: evidenceText(source.excerpt, rt) }),
                    ],
                  }),
                ),
                evidence.sources.length ? null : h('p', { children: t('factsNoSource') }),
              ],
            })
          : null,
        mode === 'correct'
          ? h('textarea', {
              value: draft,
              'aria-label': t('factsCorrect'),
              disabled: busy,
              onChange: (event: { target: { value: string } }) => setDraft(event.target.value),
            })
          : null,
        mode === 'forget' ? h('p', { role: 'alert', children: t('factsForgetWarning') }) : null,
        mode !== 'view'
          ? h('div', {
              children: [
                button(
                  mode === 'forget' ? t('factsConfirmForget') : t('factsSave'),
                  () => void save(),
                  mode === 'correct' && !draft.trim(),
                ),
                button(t('confirmCancel'), () => setMode('view')),
              ],
            })
          : null,
        error ? h('p', { role: 'alert', children: error }) : null,
      ],
    });
  };
}

/** 展开后才读取远端记忆，每页十条；该组件应以 petId 为 key 挂载。 */
export function makeMemoryLibrary(rt: ChatPanelRuntime): (props: { petId: string }) => unknown {
  const { h, t, useState, useEffect } = rt;
  const FactCard = makeFactCard(rt);
  return function MemoryLibrary({ petId }) {
    const [open, setOpen] = useState(false);
    const [page, setPage] = useState<MemoryPage | null>(null);
    const [cursor, setCursor] = useState('');
    const [revision, setRevision] = useState(0);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [saved, setSaved] = useState(false);
    useEffect(() => {
      if (!open) return;
      const controller = new AbortController();
      setBusy(true);
      setError('');
      setPage(null);
      void request(petId, controller.signal, cursor ? '&cursor=' + encodeURIComponent(cursor) : '')
        .then((data) => {
          if (!Array.isArray(data.items) || !(data.nextCursor === null || typeof data.nextCursor === 'string'))
            throw new Error('invalid_page');
          if (!controller.signal.aborted) setPage(data as unknown as MemoryPage);
        })
        .catch(() => {
          if (!controller.signal.aborted) setError(t('factsReadError'));
        })
        .finally(() => {
          if (!controller.signal.aborted) setBusy(false);
        });
      return () => controller.abort();
    }, [petId, open, cursor, revision]);
    return h('section', {
      className: 'pet-chat-memory-library',
      children: [
        h('button', {
          type: 'button',
          'aria-expanded': open,
          onClick: () => setOpen(!open),
          children: t('factsTitle'),
        }),
        open
          ? h('div', {
              children: [
                h('p', { children: t('factsIntro') }),
                h('button', {
                  type: 'button',
                  disabled: busy,
                  onClick: () => {
                    setCursor('');
                    setRevision(revision + 1);
                  },
                  children: t('factsRefresh'),
                }),
                busy ? h('p', { role: 'status', children: t('factsLoading') }) : null,
                saved ? h('p', { role: 'status', children: t('factsSaved') }) : null,
                error ? h('p', { role: 'alert', children: error }) : null,
                page?.items.length === 0 ? h('p', { children: t('factsEmpty') }) : null,
                h('ul', {
                  children: page?.items.map((fact) =>
                    h(FactCard, {
                      key: fact.id + ':' + fact.revision + ':' + revision,
                      petId,
                      fact,
                      changing: () => setSaved(false),
                      changed: () => {
                        setSaved(true);
                        setCursor('');
                        setRevision((value) => value + 1);
                      },
                    }),
                  ),
                }),
                page?.nextCursor
                  ? h('button', {
                      type: 'button',
                      disabled: busy,
                      onClick: () => setCursor(page.nextCursor!),
                      children: t('factsNext'),
                    })
                  : null,
              ],
            })
          : null,
      ],
    });
  };
}
