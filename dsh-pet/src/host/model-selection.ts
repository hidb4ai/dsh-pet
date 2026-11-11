/**
 * Pure model selection for whispers and chat. Build a candidate chain from the per-entry override
 * and the current conversation model. The generation layer tries candidates in order and owns
 * credential checks, provider calls and fallback retries.
 *
 * Empty provider/model fields follow the current conversation. Keep this module independent of
 * the DSH LLM package so node:test can exercise selection without a host.
 * @module dsh-pet/src/host/model-selection
 */

/** Provider and model IDs, matching ModelSelection in shared/types.ts. */
export interface ModelRef {
  provider: string;
  model: string;
}

/**
 * Read whisperModel / chatModel in the entry configuration: Both fields are non-empty → this selection; both are empty
 * (built-in default) → undefined (= follow the current conversation); The structure is incorrect / only half-filled
 * (the merger has been blocked, defend again here) → undefined.
 */
export function configuredModel(
  conf: Record<string, unknown> | undefined,
  key: 'whisperModel' | 'chatModel',
): ModelRef | undefined {
  const raw = conf?.[key];
  if (!raw || typeof raw !== 'object') return undefined;
  const m = raw as Record<string, unknown>;
  if (typeof m.provider !== 'string' || typeof m.model !== 'string') return undefined;
  const provider = m.provider.trim();
  const model = m.model.trim();
  return provider && model ? { provider, model } : undefined;
}

/** The model of the current conversation (agentDefaultModel.currentSelection); not configured/throw error → undefined */
export function currentModel(ctx: { agentDefaultModel?: { currentSelection(): ModelRef } }): ModelRef | undefined {
  try {
    const sel = ctx.agentDefaultModel?.currentSelection();
    return sel?.provider && sel?.model ? { provider: sel.provider, model: sel.model } : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Candidate chain: The configured model takes precedence, followed by the model of the current conversation; the same
 * selection is only left once. Returns an empty array = cannot be obtained from both sources (the generation side will
 * return "The current dialogue does not configure the model" accordingly).
 */
export function modelCandidates(
  ctx: { agentDefaultModel?: { currentSelection(): ModelRef } },
  preferred?: ModelRef,
): ModelRef[] {
  const out: ModelRef[] = [];
  const push = (m: ModelRef | undefined): void => {
    if (!m) return;
    if (out.some((x) => x.provider === m.provider && x.model === m.model)) return;
    out.push(m);
  };
  push(preferred);
  push(currentModel(ctx));
  return out;
}

/** Selection tag for error reporting/logging: provider/model */
export function modelLabel(m: ModelRef): string {
  return m.provider + '/' + m.model;
}
