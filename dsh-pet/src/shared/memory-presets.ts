/** Service defaults shared by both setup interfaces; the model is only the starting point, account availability is confirmed by discovery and connection checks. */
export interface ModelPreset {
  readonly id: string;
  readonly name: string;
  readonly baseUrl: string;
  readonly model: string;
  /** Services that do not provide vector presets can only be used for generation; custom compatible services allow manual filling. */
  readonly embedding?: { readonly model: string; readonly dimension: number; readonly sendDimensions: boolean };
}

/** Only the currently adapted OpenAI compatible interfaces are listed; LiteLLM gateways are deployed by users themselves. */
export const MODEL_PRESETS: readonly ModelPreset[] = [
  { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash' },
  {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4.1-mini',
    embedding: { model: 'text-embedding-3-small', dimension: 1536, sendDimensions: true },
  },
  {
    id: 'qwen-cn',
    name: 'Qwen · Beijing',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen3.7-plus',
    embedding: { model: 'qwen3.7-text-embedding', dimension: 1024, sendDimensions: true },
  },
  {
    id: 'qwen-sg',
    name: 'Qwen · Singapore',
    baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    model: 'qwen3.7-plus',
    embedding: { model: 'qwen3.7-text-embedding', dimension: 1024, sendDimensions: true },
  },
  {
    id: 'siliconflow',
    name: 'SiliconFlow',
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: '',
    embedding: { model: 'BAAI/bge-m3', dimension: 1024, sendDimensions: false },
  },
  { id: 'volcengine', name: 'Volcengine Ark', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', model: '' },
  {
    id: 'zhipu',
    name: 'Zhipu GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-5.3',
    embedding: { model: 'embedding-3', dimension: 2048, sendDimensions: false },
  },
  { id: 'moonshot', name: 'Moonshot Kimi', baseUrl: 'https://api.moonshot.cn/v1', model: '' },
  {
    id: 'ollama',
    name: 'Ollama',
    baseUrl: 'http://127.0.0.1:11434/v1',
    model: '',
    embedding: { model: '', dimension: 0, sendDimensions: false },
  },
  {
    id: 'litellm',
    name: 'LiteLLM Gateway',
    baseUrl: 'http://127.0.0.1:4000/v1',
    model: '',
    embedding: { model: '', dimension: 0, sendDimensions: false },
  },
  {
    id: 'custom',
    name: 'Custom OpenAI-compatible',
    baseUrl: '',
    model: '',
    embedding: { model: '', dimension: 0, sendDimensions: false },
  },
];

/** Comparing the complete address, services in the same domain with different paths cannot share the saved key. */
export function sameModelEndpoint(left: string, right: string): boolean {
  return !!left && left.replace(/\/+$/, '') === right.replace(/\/+$/, '');
}

/** The local non-authentication service still needs to satisfy the non-empty Key contract of SDK; the remote service will never automatically fill in the place value. */
export function localModelKey(baseUrl: string): string {
  try {
    const url = new URL(baseUrl);
    return ['http:', 'https:'].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      ? 'local'
      : '';
  } catch {
    return '';
  }
}
