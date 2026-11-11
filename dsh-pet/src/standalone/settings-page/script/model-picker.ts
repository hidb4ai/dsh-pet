/**
 * Hand-fillable drop-down of model fields: the input box holds the value, and the arrow on the right pulls the
 * candidate and pops up the menu.
 *
 * The pulled list only remains in the memory, and will be invalidated once the address or protocol is changed. Avoid
 * using the model of the A family to match the B family.
 * @module dsh-pet/src/standalone/settings-page/script/model-picker
 */

/** Generating model selection fragments. */
export function modelPickerScript(): string {
  return `
const AI_MODELS_URL = '/standalone-ai/models';

/**
 * Candidate pulled last time; null means it has not been pulled yet and needs to be requested first.
 */
let modelOptions = null;

function modelLabel(model) {
  return model.name && model.name !== model.id ? model.name + '（' + model.id + '）' : model.id;
}

function openModelMenu(trigger) {
  if (!modelOptions) return;
  openSelectMenu(
    trigger,
    modelOptions,
    byId('model').value.trim(),
    (picked) => {
      byId('model').value = picked;
      markDirty(true);
      setStatus(byId('model-result'), '已填入模型名称，记得保存。', 'ok');
    },
    byId('model-combo'),
  );
}

function forgetModelOptions() {
  modelOptions = null;
  setStatus(byId('model-result'), '');
}

async function fetchModelOptions(trigger) {
  const result = byId('model-result');
  trigger.disabled = true;
  setStatus(result, '正在向端点请求模型列表…');
  try {
    const response = await fetch(AI_MODELS_URL, {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'X-DSH-Pet-Token': TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        protocol: protocolSelect ? protocolSelect.getValue() : 'openai-compatible',
        baseUrl: byId('baseUrl').value.trim(),
        apiKey: byId('apiKey').value,
      }),
    });
    if (response.status === 403) throw new Error('打开凭据已失效。请从桌宠菜单重新打开设置。');
    const data = await response.json().catch(() => null);
    if (!data) throw new Error('本机接口没有返回结果，请重试。');
    if (!data.ok) throw new Error(data.message || '拉取失败');
    const models = data.models || [];
    if (!models.length) {
      setStatus(result, '端点没有返回任何模型，请手动填写。', 'error');
      return;
    }
    modelOptions = models.map((model) => ({ value: model.id, label: modelLabel(model) }));
    setStatus(result, '已拉取 ' + models.length + ' 个模型，选中即可填入。', 'ok');
    openModelMenu(trigger);
  } catch (error) {
    setStatus(result, error && error.message ? error.message : String(error), 'error');
  } finally {
    trigger.disabled = false;
  }
}

function wireModelPicker() {
  const toggle = byId('model-toggle');
  if (!toggle) return;
  toggle.append(chevron());
  toggle.addEventListener('click', () => {
    if (modelOptions) openModelMenu(toggle);
    else void fetchModelOptions(toggle);
  });
  byId('baseUrl').addEventListener('input', forgetModelOptions);
}
`;
}
