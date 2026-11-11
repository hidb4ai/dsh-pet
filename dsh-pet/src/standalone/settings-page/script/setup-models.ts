/** 快速开始的模型编辑与发现行为；与生命周期轮询分开，迟到结果不能改写新连接。 */
import { MODEL_PRESETS } from '../../../shared/memory-presets.ts';

/** 输出无需构建运行时依赖的本机表单脚本。 */
export function setupModelsScript(): string {
  return `
const setupPresets = ${JSON.stringify(MODEL_PRESETS)};
function sameSetupEndpoint(a, b) { return !!a && !!b && a.replace(/\\/+$/, '') === b.replace(/\\/+$/, ''); }
function localSetupEndpoint(value) {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname); }
  catch { return false; }
}
function setupKeyState() {
  const chat = setupData && setupData.chat;
  const url = byId('setup-url').value.trim();
  const saved = chat && chat.protocol === 'openai-compatible' && chat.hasKey && sameSetupEndpoint(chat.baseUrl, url);
  byId('setup-key').required = !saved && !localSetupEndpoint(url);
  byId('setup-key').placeholder = saved ? '已保存；留空沿用，填写新值可更新' : '填写此服务商的密钥';
  byId('setup-key-hint').textContent = localSetupEndpoint(url) ? '本机无认证服务可留空；已启用认证的服务请填写密钥。' : saved ? '密钥已保存，不回显。' : '更换地址后需填写对应密钥。';
}
function setupControls() {
  const reuse = byId('setup-reuse').checked;
  const memory = byId('setup-memory').checked;
  const generation = memory && !byId('setup-generation-reuse').checked;
  for (const suffix of ['provider', 'url', 'model', 'key', 'fetch']) byId('setup-' + suffix).disabled = reuse;
  byId('setup-model').required = true;
  byId('setup-embedding-fields').hidden = !memory;
  byId('setup-generation-fields').hidden = !generation;
  for (const suffix of ['provider', 'url', 'model', 'key', 'fetch']) byId('setup-generation-' + suffix).disabled = !generation;
  for (const suffix of ['url', 'model']) byId('setup-generation-' + suffix).required = generation;
  for (const id of ['setup-embedding-model', 'setup-dimension']) byId(id).required = memory;
  const locked = !!(setupData && setupData.models);
  for (const suffix of ['provider', 'url', 'model', 'key', 'fetch']) byId('setup-embedding-' + suffix).disabled = !memory || (locked && ['provider', 'fetch'].includes(suffix));
  byId('setup-dimension').disabled = !memory;
  byId('setup-send-dimensions').disabled = !memory || locked;
  setupKeyState();
}
function chooseSetupPreset(prefix) {
  const preset = setupPresets.find((entry) => entry.id === byId(prefix + '-provider').value);
  if (!preset) return;
  byId(prefix + '-key').value = '';
  if (preset.id !== 'custom') {
    byId(prefix + '-url').value = preset.baseUrl;
    byId(prefix + '-model').value = prefix === 'setup-embedding' ? preset.embedding.model : preset.model;
    if (prefix === 'setup-embedding') {
      byId('setup-dimension').value = preset.embedding.dimension || '';
      byId('setup-send-dimensions').checked = preset.embedding.sendDimensions;
    }
  }
  for (const entry of ['setup', 'setup-generation', 'setup-embedding']) invalidateSetupModels(entry);
  setupControls();
}
function fillSetup(data) {
  const chat = data.chat;
  const reuse = !!(chat && chat.hasKey && chat.baseUrl && chat.model && chat.protocol === 'openai-compatible');
  byId('setup-reuse-row').hidden = !reuse;
  byId('setup-reuse').checked = reuse;
  byId('setup-saved-chat').textContent = reuse ? '已保存：' + chat.model + ' · ' + chat.baseUrl : '';
  if (reuse) {
    byId('setup-url').value = chat.baseUrl;
    byId('setup-model').value = chat.model;
    byId('setup-provider').value = (setupPresets.find((entry) => sameSetupEndpoint(entry.baseUrl, chat.baseUrl)) || { id: 'custom' }).id;
  }
  const models = data.models;
  byId('setup-generation-reuse').checked = !models || !models.baseUrl ||
    (sameSetupEndpoint(models.baseUrl, byId('setup-url').value) && models.model === byId('setup-model').value);
  for (const prefix of ['setup-generation', 'setup-embedding']) {
    const url = models ? models[prefix === 'setup-generation' ? 'baseUrl' : 'embeddingBaseUrl'] : '';
    const model = models ? models[prefix === 'setup-generation' ? 'model' : 'embeddingModel'] : '';
    byId(prefix + '-url').value = url || '';
    byId(prefix + '-model').value = model || '';
    byId(prefix + '-provider').value = (setupPresets.find((entry) => sameSetupEndpoint(entry.baseUrl, url)) || { id: 'custom' }).id;
  }
  if (models) {
    byId('setup-dimension').value = models.embeddingDimension;
    byId('setup-send-dimensions').checked = models.embeddingSendDimensions !== false;
  }
  for (const id of ['setup-embedding-url', 'setup-embedding-model', 'setup-dimension']) byId(id).readOnly = !!models;
  for (const id of ['setup-embedding-provider', 'setup-embedding-fetch', 'setup-send-dimensions']) byId(id).disabled = !!models;
  byId('setup-embedding-hint').textContent = models ? '已有库固定向量模型、地址和维度，密钥可更新。更换时请另建 PowerContext 数据目录，重新导入来源对话，验证后切换记忆服务地址；相同维度也不代表向量兼容。' : '生成和向量服务可以混用；DeepSeek、Kimi 等需要另配向量模型。本机无认证服务可不填密钥。';
  byId('setup-memory').checked = !!data.memoryEnabled;
  for (const prefix of ['setup', 'setup-generation', 'setup-embedding']) { byId(prefix + '-key').value = ''; invalidateSetupModels(prefix); }
  setupControls();
}
const setupModelRequests = new Map();
function invalidateSetupModels(prefix) {
  const active = setupModelRequests.get(prefix);
  if (active) active.abort();
  setupModelRequests.delete(prefix);
  byId(prefix + '-models').replaceChildren();
  byId(prefix + '-notice').textContent = '';
  byId(prefix + '-fetch').textContent = '获取模型列表';
}
function setupDiscoveryDraft(prefix) {
  const read = (id) => byId(id).value.trim();
  const generationUrl = byId('setup-generation-reuse').checked ? read('setup-url') : read('setup-generation-url');
  const baseUrl = read(prefix + '-url') || (prefix === 'setup-embedding' ? generationUrl : '');
  const candidates = [prefix, ...(prefix === 'setup-embedding' ? ['setup-generation', 'setup'] : prefix === 'setup-generation' ? ['setup'] : [])];
  const apiKey = read(prefix + '-key') || candidates.filter((entry) => sameSetupEndpoint(read(entry + '-url'), baseUrl)).map((entry) => read(entry + '-key')).find(Boolean) || '';
  return { action: 'models', kind: prefix === 'setup' ? 'chat' : prefix.slice(6), baseUrl, apiKey };
}
function wireSetupModels() {
  for (const prefix of ['setup', 'setup-generation', 'setup-embedding']) {
    byId(prefix + '-provider').addEventListener('change', () => chooseSetupPreset(prefix));
    for (const suffix of ['url', 'key']) byId(prefix + '-' + suffix).addEventListener('input', () => {
      if (suffix === 'url') byId(prefix + '-key').value = '';
      for (const entry of ['setup', 'setup-generation', 'setup-embedding']) invalidateSetupModels(entry);
      setupKeyState();
    });
    byId(prefix + '-fetch').addEventListener('click', async () => {
      invalidateSetupModels(prefix);
      const controller = new AbortController();
      setupModelRequests.set(prefix, controller);
      const draft = setupDiscoveryDraft(prefix);
      byId(prefix + '-fetch').textContent = '正在获取…';
      try {
        const result = await setupRequest(draft, controller.signal);
        if (controller.signal.aborted || JSON.stringify(draft) !== JSON.stringify(setupDiscoveryDraft(prefix))) return;
        if (!result.ok || !Array.isArray(result.models)) throw new Error('模型列表不可用');
        for (const model of result.models) {
          const option = document.createElement('option'); option.value = model.id; option.textContent = model.name;
          byId(prefix + '-models').append(option);
        }
        byId(prefix + '-notice').textContent = result.models.length ? '在模型输入框中选择，也可手动填写。能力未知的模型仍需连接检查。' : '没有匹配模型，可手动填写模型 ID。';
      } catch {
        if (!controller.signal.aborted) byId(prefix + '-notice').textContent = '获取失败，请检查地址和密钥；也可手动填写模型 ID。';
      } finally {
        if (!controller.signal.aborted) byId(prefix + '-fetch').textContent = '获取模型列表';
      }
    });
  }
  byId('setup-generation-reuse').addEventListener('change', () => { invalidateSetupModels('setup-embedding'); setupControls(); });
  window.addEventListener('pagehide', () => { for (const active of setupModelRequests.values()) active.abort(); });
}
`;
}
