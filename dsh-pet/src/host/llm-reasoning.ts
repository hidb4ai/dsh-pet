/**
 * Detect whether the current model supports reasoning effort (including " off "), shared by host side.
 *
 * Not responsible for caching and retrying: Ask dsh-llm once every time you call it. If you cannot get the capability,
 * just treat it as not supported. It must always be true: reasoningEffort is only passed when the model actually
 * declares support: ' off ' - dsh-llm directly determines UNSUPPORTED_REASONING_EFFORT for "no reasoning metadata +
 * explicit effort". The request cannot be sent out and will only be folded into an empty stream by the adapter, which
 * is expressed as "the model does not return text".
 * @module dsh-pet/src/host/llm-reasoning
 */

/** Minimum shape of callable dsh-llm resolveModelInfo capability (defensive: does not rely on complete types) */
interface ResolveModelInfoCapable {
  resolveModelInfo?(
    provider: string,
    model: string,
    signal?: AbortSignal,
  ): Promise<{ reasoning?: { efforts?: ReadonlyArray<{ id: string }> } }>;
}

/**
 * Whether the current provider/model declares support for reasoning effort (including " off "). If the capability is
 * missing or the query fails, false will be returned conservatively (= not passed, which is equivalent to the default
 * behavior of the model to avoid request failure).
 */
export async function supportsReasoningOff(ctx: { llm?: unknown }, provider: string, model: string): Promise<boolean> {
  const llm = ctx.llm as ResolveModelInfoCapable | undefined;
  if (!llm || typeof llm.resolveModelInfo !== 'function') return false;
  try {
    const info = await llm.resolveModelInfo(provider, model);
    return info?.reasoning?.efforts?.some((e) => e.id === 'off') ?? false;
  } catch {
    return false; // Query failure will be conservatively not transmitted (equivalent to the default behavior of the model, which will not cause the request to fail)
  }
}
