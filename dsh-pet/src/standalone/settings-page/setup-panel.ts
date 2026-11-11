/** 快速开始分别呈现聊天、记忆整理和向量连接，服务预设来自共享注册表。 */
import { MODEL_PRESETS } from '../../shared/memory-presets.ts';

const labels: Record<string, string> = {
  'qwen-cn': '通义千问 · 北京',
  'qwen-sg': '通义千问 · 新加坡',
  siliconflow: '硅基流动 SiliconFlow',
  volcengine: '火山方舟（模型或接入点 ID）',
  zhipu: '智谱 GLM',
  moonshot: '月之暗面 Kimi',
  custom: '自定义 OpenAI 兼容服务',
};
function providerOptions(embedding = false): string {
  return MODEL_PRESETS.filter((preset) => !embedding || preset.embedding)
    .map((preset) => `<option value="${preset.id}">${labels[preset.id] ?? preset.name}</option>`)
    .join('');
}
function modelField(prefix: string, label: string, value = ''): string {
  return `<div class="field"><label for="${prefix}-model">${label}</label><input id="${prefix}-model" type="text" maxlength="200" list="${prefix}-models" value="${value}"><datalist id="${prefix}-models"></datalist><button class="btn" id="${prefix}-fetch" type="button">获取模型列表</button><p class="fieldHint" id="${prefix}-notice" role="status"></p></div>`;
}

export const setupPanel = `
<section class="panel" id="panel-setup" role="tabpanel" aria-labelledby="tab-setup" hidden><div class="scroll">
<form id="quick-setup"><div class="card"><div class="cardHead"><h2 class="cardTitle">让她先陪你聊起来</h2></div>
<p class="cardHint">选好服务商，填入密钥，再决定是否开启长期记忆。已有聊天配置可以直接沿用。</p>
<fieldset id="setup-fields" class="setupFields">
<div class="field" id="setup-reuse-row" hidden><label><input id="setup-reuse" type="checkbox"> 沿用当前聊天配置</label><p id="setup-saved-chat" class="fieldHint"></p></div>
<div class="field"><label for="setup-provider">聊天服务商</label><select id="setup-provider">${providerOptions()}</select></div>
<div class="field"><label for="setup-url">聊天接口地址</label><input id="setup-url" type="url" required maxlength="2048" value="https://api.deepseek.com" spellcheck="false"></div>
<div class="field"><label for="setup-key">聊天 API 密钥</label><input id="setup-key" type="password" maxlength="4096" autocomplete="new-password"><p id="setup-key-hint" class="fieldHint">密钥只保存在本机。</p></div>
${modelField('setup', '聊天模型', 'deepseek-flash')}
<p class="fieldHint">获取列表后，在模型输入框中选择，也可直接填写模型 ID。列表不代表账户已开通或模型已验证。Ollama 请先在本机安装并下载模型；LiteLLM 需自行部署网关。</p>
<div class="field"><label><input id="setup-memory" type="checkbox"> 开启本机长期记忆</label><p class="fieldHint">自动准备 PowerContext 1.5.0，以后随桌宠启停。连接检查、聊天、记忆整理和检索可能产生模型费用。</p></div>
<details id="setup-model-details"><summary>记忆模型：独立选择整理和向量服务</summary>
<div id="setup-embedding-fields" hidden>
<div class="field"><label><input id="setup-generation-reuse" type="checkbox" checked> 记忆整理沿用聊天模型</label></div>
<div id="setup-generation-fields" hidden>
<div class="field"><label for="setup-generation-provider">记忆整理服务商</label><select id="setup-generation-provider">${providerOptions()}</select></div>
<div class="field"><label for="setup-generation-url">记忆整理接口地址</label><input id="setup-generation-url" type="url" maxlength="2048"></div>
<div class="field"><label for="setup-generation-key">记忆整理密钥</label><input id="setup-generation-key" type="password" maxlength="4096" autocomplete="new-password" placeholder="相同完整地址可沿用已保存密钥"></div>
${modelField('setup-generation', '记忆整理模型')}
</div>
<div class="field"><label for="setup-embedding-provider">向量模型服务商</label><select id="setup-embedding-provider">${providerOptions(true)}</select></div>
<div class="field"><label for="setup-embedding-url">Embedding 接口地址</label><input id="setup-embedding-url" type="url" maxlength="2048" placeholder="留空使用记忆整理服务地址"></div>
<div class="field"><label for="setup-embedding-key">Embedding 密钥</label><input id="setup-embedding-key" type="password" maxlength="4096" autocomplete="new-password" placeholder="同址可复用；跨服务商需填写独立密钥"></div>
${modelField('setup-embedding', 'Embedding 模型')}
<div class="field"><label for="setup-dimension">向量维度</label><input id="setup-dimension" type="number" min="1" max="65536"></div>
<div class="field"><label><input id="setup-send-dimensions" type="checkbox"> 向接口发送 dimensions 参数（固定维度模型请关闭）</label></div>
<p class="fieldHint" id="setup-embedding-hint">DeepSeek、Kimi 等生成服务需另配向量模型；可以混用服务商。本机无认证服务的密钥可留空。</p>
</div></details>
</fieldset>
<p class="fieldHint">首次安装需要联网和系统 curl、tar。Windows 自动记忆服务仍属实验性支持；Anthropic 或已有远程服务请到「配置」。</p>
<div class="footer"><button class="btn primary" id="setup-start" type="submit">开始养鱼</button><button class="btn" id="setup-chat" type="button" hidden>去聊天</button></div>
</div></form>
<div class="card"><div class="cardHead"><h2 class="cardTitle">准备进度</h2></div>
<p class="status" id="setup-status" role="status" aria-live="polite">正在读取状态…</p><p id="setup-checks" class="cardHint"></p>
<ol class="setupSteps" id="setup-steps" hidden><li>检查模型连接</li><li>准备本机环境</li><li>启动并连接记忆</li></ol>
<p id="setup-elapsed" class="fieldHint" hidden></p>
<p class="fieldHint">服务就绪后，新产生的成功文本问答会同步。旧聊天不会自动导入；已同步还需等待后台整理，才可能召回。</p>
<div class="footer"><button class="btn" id="setup-retry" type="button" hidden>重试</button><button class="btn" id="setup-cancel" type="button" hidden>取消准备</button><button class="btn" id="setup-stop" type="button" hidden>暂停记忆</button></div>
</div></div></section>`;
