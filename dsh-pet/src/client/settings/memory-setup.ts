/** DSH 本机记忆设置：安装进度与生命周期操作独立于宿主聊天模型。 */
import type { MemorySetupModels } from '../../shared/memory-setup.ts';
import { MEMORY_PRESETS } from '../../shared/memory-presets.ts';
import { useMemorySetup, type MemorySetupCallbacks } from './memory-setup-state.ts';
import { INPUT_CLASS, makeUiKit } from './ui.ts';
import type { SettingsRuntime } from './runtime.ts';

const initial = {
  baseUrl: '',
  model: '',
  apiKey: '',
  embeddingBaseUrl: '',
  embeddingModel: '',
  embeddingApiKey: '',
  embeddingDimension: '1024',
};

/** 沿用设置页样式；保留编辑草稿，轮询不会重置用户正在输入的字段。 */
export function makeMemorySetup(rt: SettingsRuntime) {
  const { h, t, useState, useRef, useEffect } = rt;
  const { cardHead, field } = makeUiKit(rt);
  return function MemorySetup(props: MemorySetupCallbacks & { disabled: boolean }) {
    const { status, error, pending, send } = useMemorySetup(rt, props);
    const [draft, setDraft] = useState(initial);
    const [preset, setPreset] = useState('custom');
    const filled = useRef(false);
    const modelSnapshot = useRef('');
    useEffect(() => {
      if (!status?.available || status.busy) return;
      const serialized = JSON.stringify(status.models ?? null);
      if (filled.current && serialized === modelSnapshot.current) return;
      filled.current = true;
      modelSnapshot.current = serialized;
      if (status.models)
        setDraft({ ...initial, ...status.models, embeddingDimension: String(status.models.embeddingDimension) });
    }, [status]);
    if (status?.available === false) return null;
    const blocked = props.disabled || pending || !!status?.busy || !status || !!error;
    const update = (key: keyof typeof initial, value: string) => setDraft((old) => ({ ...old, [key]: value }));
    const input = (key: keyof typeof initial, type = 'text', locked = false) =>
      field(
        t('memorySetup_' + key),
        h('input', {
          className: INPUT_CLASS,
          type,
          value: draft[key],
          readOnly: locked,
          'aria-label': t('memorySetup_' + key),
          autoComplete: type === 'password' ? 'new-password' : undefined,
          min: type === 'number' ? 1 : undefined,
          max: type === 'number' ? 65536 : undefined,
          maxLength: type === 'password' ? 4096 : key.endsWith('Url') ? 2048 : 200,
          required: !['apiKey', 'embeddingApiKey', 'embeddingBaseUrl'].includes(key),
          onChange: (event: { target: { value: string } }) => update(key, event.target.value),
        }),
      );
    const choose = (value: string) => {
      setPreset(value);
      if (value === 'custom') return;
      const option = value === 'openai' ? MEMORY_PRESETS.openai : MEMORY_PRESETS.qwen;
      const baseUrl =
        value === 'openai'
          ? 'https://api.openai.com/v1'
          : value === 'qwen-sg'
            ? 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1'
            : 'https://dashscope.aliyuncs.com/compatible-mode/v1';
      setDraft((old) => ({
        ...old,
        baseUrl,
        model: option.model,
        apiKey: '',
        ...(!status?.configured
          ? {
              embeddingBaseUrl: baseUrl,
              embeddingModel: option.embedding,
              embeddingDimension: String(option.dimension),
              embeddingApiKey: '',
            }
          : {}),
      }));
    };
    const run = async (body: unknown) => {
      if (await send(body)) setDraft((old) => ({ ...old, apiKey: '', embeddingApiKey: '' }));
    };
    const button = (action: string, label: string, disabled = false) =>
      h('button', {
        type: 'button',
        disabled: props.disabled || pending || disabled,
        onClick: () => void run({ action }),
        children: t(label),
      });
    const stage = status?.stage ?? 'loading';
    const saved = (models: MemorySetupModels | undefined) =>
      !!models && models.baseUrl.replace(/\/+$/, '') === draft.baseUrl.replace(/\/+$/, '');
    const detail = error || status?.errorCode;
    const errorKey = detail ? 'memorySetup_error_' + detail : '';
    const translatedError = detail && t(errorKey) !== errorKey ? t(errorKey) : t('memorySetup_error');
    return h('div', {
      className: 'dsh-pet-cfg__card',
      'data-memory-setup': '',
      children: [
        cardHead(t('memorySetupTitle'), t('memorySetupHint')),
        h('p', { className: 'dsh-pet-cfg__note', children: t('memorySetupScope') }),
        h('form', {
          onSubmit: (event: { preventDefault(): void }) => {
            event.preventDefault();
            void run({
              ...draft,
              action: 'start',
              memory: true,
              embeddingBaseUrl: draft.embeddingBaseUrl || draft.baseUrl,
              embeddingDimension: Number(draft.embeddingDimension),
            });
          },
          children: [
            h('fieldset', {
              disabled: blocked,
              style: { border: 0, padding: 0, minWidth: 0 },
              children: [
                field(
                  t('memorySetupPreset'),
                  h('select', {
                    className: INPUT_CLASS,
                    value: preset,
                    'aria-label': t('memorySetupPreset'),
                    onChange: (event: { target: { value: string } }) => choose(event.target.value),
                    children: ['custom', 'qwen-cn', 'qwen-sg', 'openai'].map((id) =>
                      h('option', { value: id, children: t('memorySetupPreset_' + id) }, id),
                    ),
                  }),
                ),
                input('baseUrl', 'url'),
                input('model'),
                input('apiKey', 'password'),
                h('p', {
                  className: 'dsh-pet-cfg__note',
                  children: saved(status?.models) ? t('memorySetupSavedKey') : t('memorySetupNewKey'),
                }),
                input('embeddingModel', 'text', !!status?.configured),
                input('embeddingDimension', 'number', !!status?.configured),
                h('details', {
                  children: [
                    h('summary', { children: t('memorySetupAdvanced') }),
                    input('embeddingBaseUrl', 'url', !!status?.configured),
                    input('embeddingApiKey', 'password'),
                    h('p', { className: 'dsh-pet-cfg__note', children: t('memorySetupEmbeddingHint') }),
                  ],
                }),
                h('p', { className: 'dsh-pet-cfg__note', children: t('memorySetupConsent') }),
                h('button', { type: 'submit', children: t('memorySetupStart') }),
              ],
            }),
          ],
        }),
        h('p', {
          role: 'status',
          'aria-live': 'polite',
          children: detail ? translatedError : t('memorySetupStage_' + stage),
        }),
        status
          ? h('p', {
              className: 'dsh-pet-cfg__note',
              children: error
                ? t('memorySetupDisconnected')
                : status.memoryReady
                  ? t('memorySetupReady')
                  : status.busy
                    ? t('memorySetupWorking')
                    : status.configured && !status.memoryEnabled
                      ? t('memorySetupPaused')
                      : t('memorySetupNotReady'),
            })
          : null,
        status?.busy && status.startedAt
          ? h('p', {
              children: t('memorySetupElapsed').replace(
                '{seconds}',
                String(Math.max(0, Math.floor((Date.now() - status.startedAt) / 1000))),
              ),
            })
          : null,
        h('div', {
          style: { display: 'flex', flexWrap: 'wrap', gap: '8px' },
          children: [
            h('button', {
              type: 'button',
              disabled: pending,
              onClick: () => void send(),
              children: t('memoryRefresh'),
            }),
            status?.canRetry && !status.busy && (!status.memoryReady || status.stage === 'error')
              ? button('retry', status.retryDraft ? 'memorySetupRetry' : 'memorySetupResume', !!error)
              : null,
            status?.busy ? button('cancel', 'memorySetupCancel', !status.canCancel || !!error) : null,
            status?.memoryEnabled || status?.memoryRunning
              ? button('stop', 'memorySetupStop', !!status.busy || !!error)
              : null,
          ],
        }),
      ],
    });
  };
}
