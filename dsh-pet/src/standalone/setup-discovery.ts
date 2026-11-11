/** Model discovery reuses existing adapter; reuses credentials by full address only, discovery process does not install or modify configuration. */
import { z } from 'zod';
import { localModelKey, sameModelEndpoint } from '../shared/memory-presets.ts';
import { DEFAULT_AI_SETTINGS } from './ai-config.ts';
import { discoverModels } from './ai-provider/list-models.ts';
import type { StandaloneAiService, ModelDiscoveryResult } from './ai-provider/types.ts';
import { memoryModelsSchema, type ManagedMemory } from './managed-memory.ts';

const discoverySchema = z
  .object({
    action: z.literal('models'),
    kind: z.enum(['chat', 'generation', 'embedding']),
    baseUrl: memoryModelsSchema.shape.baseUrl,
    apiKey: memoryModelsSchema.shape.apiKey.or(z.literal('')).default(''),
  })
  .strict();

/** Taking Key from the current role's saved connection and then normalizing and filtering the unmatched capabilities by the adapter. */
export async function discoverSetupModels(
  input: unknown,
  memory?: ManagedMemory,
  ai?: StandaloneAiService,
): Promise<ModelDiscoveryResult> {
  const parsed = discoverySchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'input', message: '请填写有效的模型服务地址。' };
  const { baseUrl, kind } = parsed.data;
  const chat = ai?.connectionForSetup();
  const chatKey = chat?.protocol === 'openai-compatible' && sameModelEndpoint(chat.baseUrl, baseUrl) ? chat.apiKey : '';
  const generationKey = memory?.generationKeyForEndpoint(baseUrl);
  const savedKeys = {
    chat: chatKey,
    generation: generationKey || chatKey,
    embedding: memory?.embeddingKeyForEndpoint(baseUrl) || generationKey || chatKey,
  };
  const apiKey = parsed.data.apiKey || savedKeys[kind] || localModelKey(baseUrl);
  const result = await discoverModels(fetch, DEFAULT_AI_SETTINGS, { baseUrl, apiKey, protocol: 'openai-compatible' });
  if (!result.ok) return result;
  const expected = kind === 'embedding' ? 'embedding' : 'generation';
  return { ok: true, models: result.models.filter((model) => !model.kind || model.kind === expected) };
}
