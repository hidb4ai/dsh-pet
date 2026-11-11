/** 两种设置界面共用的服务预设；模型只是起点，账户可用性由发现与连接检查确认。 */
export interface ModelPreset {
  readonly id: string;
  readonly name: string;
  readonly baseUrl: string;
  readonly model: string;
  /** 未提供向量预设的服务只能用于生成；自定义兼容服务允许手动填写。 */
  readonly embedding?: { readonly model: string; readonly dimension: number; readonly sendDimensions: boolean };
}

/** 只列出当前适配的 OpenAI 兼容接口；LiteLLM 网关由用户自行部署。 */
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

/** 比较完整地址，路径不同的同域服务也不能共享已保存密钥。 */
export function sameModelEndpoint(left: string, right: string): boolean {
  return !!left && left.replace(/\/+$/, '') === right.replace(/\/+$/, '');
}

/** 本机无认证服务仍需满足 SDK 的非空 Key 契约；远程服务绝不自动填占位值。 */
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
