/**
 * Setting page startup: partition switching, initial load and save button wiring.
 *
 * The configuration page puts desktop pet and AI in the same panel, and each loads its own interface: desktop pet
 * reads / config, AI reads / standalone-ai/settings, and the two sets of saves do not affect each other. When the
 * token is missing, it only prompts and does not send any requests - all write operations on this page rely on the
 * valid credentials for that run.
 * @module dsh-pet/src/standalone/settings-page/script/boot
 */

/** Generate startup fragment. */
export function bootScript(): string {
  return `
let protocolSelect = null;
let balanceSelect = null;

function mountProtocolSelect() {
  const host = byId('protocol-host');
  if (!host) return;
  protocolSelect = createSelect(
    [
      { value: 'openai-compatible', label: 'OpenAI 兼容' },
      { value: 'anthropic', label: 'Anthropic' },
    ],
    'openai-compatible',
    () => forgetModelOptions(),
  );
  protocolSelect.root.firstElementChild.setAttribute('aria-labelledby', 'protocol-label');
  host.append(protocolSelect.root);
}

function mountBalanceSelect() {
  const host = byId('balance-provider-host');
  if (!host) return;
  balanceSelect = createSelect(
    [
      { value: '', label: '不查询余额' },
      { value: 'deepseek-official', label: 'DeepSeek 官方' },
      { value: 'opencode-go', label: 'opencode Go' },
      { value: 'commandcode', label: 'commandcode' },
    ],
    '',
    (picked) => {
      const button = byId('balance-btn');
      if (button) button.disabled = picked === '';
      const result = byId('balance-result');
      if (result) {
        result.textContent = '';
        result.dataset.ok = '';
        result.dataset.error = '';
      }
    },
  );
  balanceSelect.root.firstElementChild.setAttribute('aria-labelledby', 'balance-provider-label');
  host.append(balanceSelect.root);
}

function selectTab(name) {
  for (const cell of document.querySelectorAll('[data-tab]')) {
    const active = cell.dataset.tab === name;
    cell.setAttribute('aria-selected', active ? 'true' : 'false');
    const panel = byId('panel-' + cell.dataset.tab);
    if (panel) panel.hidden = !active;
    if (active && cell.dataset.title) {
      const title = byId('page-title');
      if (title) title.textContent = cell.dataset.title;
    }
  }
}

function wireTabs() {
  const cells = Array.prototype.slice.call(document.querySelectorAll('.navCell'));
  cells.forEach((cell, index) => {
    cell.addEventListener('click', () => selectTab(cell.dataset.tab));
    cell.addEventListener('keydown', (event) => {
      const forward = event.key === 'ArrowDown' || event.key === 'ArrowRight';
      const backward = event.key === 'ArrowUp' || event.key === 'ArrowLeft';
      if (!forward && !backward) return;
      event.preventDefault();
      const step = forward ? 1 : -1;
      const next = cells[(index + step + cells.length) % cells.length];
      next.focus();
      selectTab(next.dataset.tab);
    });
  });
}

async function loadPets() {
  const status = byId('pet-status');
  setStatus(status, '正在读取本机配置…');
  try {
    const config = await callApi('GET', '/config');
    const meta = await callApi('GET', '/config/meta').catch(() => null);
    if (!config || config.ok === false || !config.main) throw new Error('读取配置失败：宿主没有返回可用的配置。');
    state.meta = meta;
    initDrafts(config);
    renderPetsPanel();
    byId('pet-save').disabled = false;
    setStatus(status, '');
  } catch (error) {
    setStatus(status, (error && error.message) || String(error), 'error');
  }
}

async function loadAi() {
  const status = byId('status');
  try {
    populateAi(await aiRequest('GET'));
    byId('save').disabled = false;
    setStatus(status, '设置只在本机保存。');
  } catch (error) {
    setStatus(status, (error && error.message) || String(error), 'error');
  }
}

function boot() {
  wireTabs();
  selectTab('chat');
  // The token in the address bar has been cleared after refreshing. At this time, the HttpOnly cookie
  // exchanged for the first visit continues;
  //  When cookie is gone, each panel's own request will fail and a prompt to reopen the settings will be
  // displayed.
  mountProtocolSelect();
  mountBalanceSelect();
  wireAiPanel();
  wireSetup();
  byId('pet-save').addEventListener('click', savePets);
  window.addEventListener('beforeunload', (event) => {
    if (!state.dirty) return;
    event.preventDefault();
    event.returnValue = '';
  });
  loadPets();
  loadAi();
}
`;
}
