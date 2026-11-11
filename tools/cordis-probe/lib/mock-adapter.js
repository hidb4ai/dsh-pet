/**
 * Minimalist LLM adapter: only to allow five mock service providers to appear in the model selector of DSH, without
 * participating in the real conversation.
 *
 * Use duck typing instead of inheriting `LlmAdapter` : the probe does not declare dependence on `@deepseek-ai/dsh-llm`
 * , and `ctx.llm.registerAdapter()` does not perform instanceof verification when running. The default values of each
 * method copy the base class.
 * @module dsh-cordis-probe/mock-adapter
 */

/** Each mock service provider only advertises this one model (GUI only lists the adapters of the model). */
const MODEL = { id: 'mock', name: 'Mock（不参与对话）' };

/** The dialogue is not available: After being selected, the model will get this error, indicating that it is only a balance test pile. */
async function* unavailable() {
  throw new Error("cordis-probe: the mock provider only tests balance bubbles and does not support chat");
}

/**
 * Build a mock adapter.
 *
 * @param names - provider id → The name displayed in the selector.
 * @returns is an ordinary object that implements all the methods required by `ctx.llm.registerAdapter()` .
 */
export function createMockAdapter(names) {
  const resolve = (provider, model) => ({ provider, id: model, name: MODEL.name });
  return {
    providerInfo: (provider) => ({ id: provider, name: names[provider] ?? provider }),
    providerRetryPolicy: () => undefined,
    imageRequestPricing: () => undefined,
    imageRequestTarget: (_provider, _model, image) => ({
      width: image.width,
      height: image.height,
      maxBytes: image.bytes,
    }),
    // The model metadata must carry provider and be consistent with the registered id, otherwise DSH will be judged as INVALID_CATALOG
    listModels: async (provider) => [{ provider, id: MODEL.id, name: MODEL.name }],
    resolveModel: async (provider, model) => resolve(provider, model),
    prepareCall: async (provider, model) => ({ model: resolve(provider, model), stream: unavailable }),
    stream: unavailable,
  };
}
