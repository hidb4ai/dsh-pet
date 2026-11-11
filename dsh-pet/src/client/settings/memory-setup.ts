/** DSH Native Memory Settings: Installation progress and lifecycle operations are independent of the host chat model. */
import { EMPTY_MEMORY_DRAFT, makeMemoryModelFields, type MemoryModelDraft } from './memory-model-fields.ts';
import { useMemorySetup, type MemorySetupCallbacks } from './memory-setup-state.ts';
import { makeUiKit } from './ui.ts';
import type { SettingsRuntime } from './runtime.ts';

/** Inherit the settings page style; keep editing drafts, polling does not reset the fields the user is entering. */
export function makeMemorySetup(rt: SettingsRuntime) {
  const { h, t, useState, useRef, useEffect } = rt;
  const { cardHead } = makeUiKit(rt);
  const ModelFields = makeMemoryModelFields(rt);
  return function MemorySetup(props: MemorySetupCallbacks & { disabled: boolean }) {
    const { status, error, pending, send } = useMemorySetup(rt, props);
    const [draft, setDraft] = useState(EMPTY_MEMORY_DRAFT);
    const filled = useRef(false);
    const modelSnapshot = useRef('');
    useEffect(() => {
      if (!status?.available || status.busy) return;
      const serialized = JSON.stringify(status.models ?? null);
      if (filled.current && serialized === modelSnapshot.current) return;
      filled.current = true;
      modelSnapshot.current = serialized;
      if (status.models)
        setDraft({
          ...EMPTY_MEMORY_DRAFT,
          ...status.models,
          embeddingDimension: String(status.models.embeddingDimension),
          embeddingSendDimensions: status.models.embeddingSendDimensions !== false,
        });
    }, [status]);
    if (status?.available === false) return null;
    const blocked = props.disabled || pending || !!status?.busy || !status || !!error;
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
                h(ModelFields, {
                  draft,
                  models: status?.models,
                  embedding: false,
                  locked: false,
                  update: (change: Partial<MemoryModelDraft>) => setDraft((old) => ({ ...old, ...change })),
                }),
                h(ModelFields, {
                  draft,
                  models: status?.models,
                  embedding: true,
                  locked: !!status?.configured,
                  update: (change: Partial<MemoryModelDraft>) => setDraft((old) => ({ ...old, ...change })),
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
