/** Browser-side setup: drafts are separate from persisted state; credentials never round-trip. */

export function setupScript(): string {
  return `
let setupTimer = null;
let setupWasBusy = false;
let setupData = null;
let setupDirty = false;
let setupInitialized = false;
async function setupRequest(body, signal) {
  const response = await fetch('/standalone-ai/setup', {
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
    method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
    headers: { 'X-DSH-Pet-Token': TOKEN, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '无法读取准备状态，请从桌宠菜单重新打开设置。');
  return data;
}
function showSetup(data) {
  setupData = data;
  if (!setupInitialized) {
    setupInitialized = true;
    if (!data.chatReady) selectTab('setup');
    if (!setupDirty) fillSetup(data);
  }
  const completed = setupWasBusy && !data.busy;
  setStatus(byId('setup-status'), data.message, data.stage === 'error' ? 'error' : data.stage === 'ready' ? 'ok' : '');
  byId('setup-start').disabled = data.busy;
  byId('setup-fields').disabled = data.busy;
  byId('setup-retry').hidden = data.busy || !data.canRetry || (data.memoryReady && data.stage !== 'error');
  byId('setup-retry').disabled = data.busy;
  byId('setup-retry').textContent = data.retryDraft ? '重试本次设置' : data.memoryEnabled ? '重试启动记忆' : '恢复记忆';
  byId('setup-stop').hidden = !(data.memoryEnabled || data.memoryRunning);
  byId('setup-stop').disabled = data.busy;
  byId('setup-cancel').hidden = !data.busy;
  byId('setup-cancel').disabled = !data.canCancel;
  byId('setup-chat').hidden = !data.chatReady;
  byId('setup-chat').textContent = data.busy ? '先去聊天（记忆准备中）' : '去聊天';
  const memory = data.memoryReady ? '服务已就绪' : data.busy ? '准备中' : data.configured && !data.memoryEnabled ? '已暂停，数据保留' : data.memoryEnabled ? '暂不可用，可重试' : '未开启';
  byId('setup-checks').textContent = '聊天：' + (data.chatReady ? '已配置' : '待配置') + ' · 长期记忆：' + memory;
  byId('setup-steps').hidden = !data.busy;
  const step = ['checking', 'checking_embedding'].includes(data.stage) ? 0
    : ['checking_runtime', 'downloading', 'installing_python', 'installing_memory'].includes(data.stage) ? 1 : 2;
  Array.from(byId('setup-steps').children).forEach((li, i) => { if (i === step) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current'); });
  byId('setup-elapsed').hidden = !data.busy;
  byId('setup-elapsed').textContent = data.startedAt ? '已等待 ' + Math.max(0, Math.floor((Date.now() - data.startedAt) / 1000)) + ' 秒；可取消，不会删除记忆。' : '';
  if (completed) {
    loadAi(); loadPets();
    if (data.stage === 'ready' || data.stage === 'stopped') { setupDirty = false; fillSetup(data); }
  } else if (!data.busy && !setupDirty) { byId('setup-memory').checked = !!data.memoryEnabled; setupControls(); }
  setupWasBusy = data.busy;
  clearTimeout(setupTimer);
  setupTimer = setTimeout(refreshSetup, data.busy ? 1000 : 5000);
}
async function refreshSetup() {
  try { showSetup(await setupRequest()); }
  catch (error) {
    setStatus(byId('setup-status'), error.message + '；正在重新连接…', 'error');
    byId('setup-checks').textContent = '连接中断，当前状态未知。';
    for (const id of ['setup-start', 'setup-retry', 'setup-stop', 'setup-cancel']) byId(id).disabled = true;
    setupTimer = setTimeout(refreshSetup, 5000);
  }
}
function wireSetup() {
  byId('quick-setup').addEventListener('invalid', (event) => {
    if (byId('setup-model-details').contains(event.target)) byId('setup-model-details').open = true;
  }, true);
  byId('quick-setup').addEventListener('input', () => { setupDirty = true; });
  byId('quick-setup').addEventListener('change', () => { setupDirty = true; });
  wireSetupModels();
  byId('setup-reuse').addEventListener('change', () => {
    if (byId('setup-reuse').checked && setupData && setupData.chat) {
      byId('setup-url').value = setupData.chat.baseUrl; byId('setup-model').value = setupData.chat.model;
      byId('setup-key').value = '';
    }
    for (const prefix of ['setup', 'setup-generation', 'setup-embedding']) invalidateSetupModels(prefix);
    setupControls();
  });
  byId('setup-memory').addEventListener('change', () => {
    setupControls();
    if (byId('setup-memory').checked) byId('setup-model-details').open = true;
  });
  byId('setup-chat').addEventListener('click', () => selectTab('chat'));
  for (const action of ['retry', 'stop', 'cancel']) byId('setup-' + action).addEventListener('click', async () => {
    try { setupWasBusy = true; showSetup(await setupRequest({ action: action })); }
    catch (error) { setStatus(byId('setup-status'), error.message, 'error'); }
  });
  byId('quick-setup').addEventListener('submit', async (event) => {
    event.preventDefault();
    const value = (id) => byId(id).value.trim();
    const body = { action: 'start', memory: byId('setup-memory').checked, baseUrl: value('setup-url'), model: value('setup-model'), apiKey: value('setup-key') };
    if (body.memory) {
      if (!byId('setup-generation-reuse').checked) body.generation = { baseUrl: value('setup-generation-url'), model: value('setup-generation-model'), apiKey: value('setup-generation-key') };
      Object.assign(body, { embeddingBaseUrl: value('setup-embedding-url') || (body.generation ? body.generation.baseUrl : body.baseUrl), embeddingModel: value('setup-embedding-model'), embeddingApiKey: value('setup-embedding-key'), embeddingDimension: Number(value('setup-dimension')), embeddingSendDimensions: byId('setup-send-dimensions').checked });
    }
    byId('setup-start').disabled = true;
    try {
      setupWasBusy = true;
      showSetup(await setupRequest(body));
      byId('setup-key').value = ''; byId('setup-generation-key').value = ''; byId('setup-embedding-key').value = '';
    } catch (error) { byId('setup-start').disabled = false; setStatus(byId('setup-status'), error.message, 'error'); }
  });
  refreshSetup();
}
`;
}
