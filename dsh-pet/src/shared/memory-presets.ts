/** 快速设置的模型默认值；账户与地域是否支持仍需连接检查。 */
export const MEMORY_PRESETS = {
  qwen: { model: 'qwen3.7-plus', embedding: 'qwen3.7-text-embedding', dimension: 1024 },
  openai: { model: 'gpt-4.1-mini', embedding: 'text-embedding-3-small', dimension: 1536 },
};
