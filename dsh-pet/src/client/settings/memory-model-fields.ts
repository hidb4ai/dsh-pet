/** Independent generation and vector form of Memory Wizard, model discovery results do not cover draft or existing vector spaces. */
import { MODEL_PRESETS, sameModelEndpoint } from '../../shared/memory-presets.ts';
import { ROUTE_PATH } from '../../shared/constants.ts';
import type { MemorySetupModels } from '../../shared/memory-setup.ts';
import type { SettingsRuntime } from './runtime.ts';
import { INPUT_CLASS, makeUiKit } from './ui.ts';

/** The credentials only exist in the edit draft and are not read back from the status interface. */
export const EMPTY_MEMORY_DRAFT = {
  baseUrl: '',
  model: '',
  apiKey: '',
  embeddingBaseUrl: '',
  embeddingModel: '',
  embeddingApiKey: '',
  embeddingDimension: '',
  embeddingSendDimensions: true,
};
/** The forms of the two roles share status and are submitted by the wizard. */
export type MemoryModelDraft = typeof EMPTY_MEMORY_DRAFT;

/** Each role manages model discovery requests independently; old results are discarded when switching addresses, keys, or unmounting. */
export function makeMemoryModelFields(rt: SettingsRuntime) {
  const { h, t, useState, useEffect, useRef } = rt;
  const { field } = makeUiKit(rt);
  return function MemoryModelFields(props: {
    draft: MemoryModelDraft;
    update(change: Partial<MemoryModelDraft>): void;
    embedding: boolean;
    locked: boolean;
    models?: MemorySetupModels;
  }) {
    const { draft, embedding, locked, update } = props;
    const [preset, setPreset] = useState('custom');
    const [models, setModels] = useState<Array<{ id: string; name: string }>>([]);
    const [notice, setNotice] = useState('');
    const [loading, setLoading] = useState(false);
    const active = useRef<AbortController | null>(null);
    const url = embedding ? draft.embeddingBaseUrl || draft.baseUrl : draft.baseUrl;
    const apiKey = embedding
      ? draft.embeddingApiKey || (sameModelEndpoint(url, draft.baseUrl) ? draft.apiKey : '')
      : draft.apiKey;
    const kind = embedding ? 'embedding' : 'generation';
    const listId = 'memory-model-list-' + kind;
    useEffect(() => {
      active.current?.abort();
      setModels([]);
      setNotice('');
      setLoading(false);
      return () => active.current?.abort();
    }, [url, apiKey, locked]);
    const discover = async () => {
      active.current?.abort();
      const controller = new AbortController();
      active.current = controller;
      setLoading(true);
      setNotice('');
      setModels([]);
      try {
        const response = await fetch(ROUTE_PATH + '/powercontext/setup', {
          method: 'POST',
          credentials: 'same-origin',
          cache: 'no-store',
          redirect: 'error',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'models', kind, baseUrl: url, apiKey }),
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
        });
        const result = await response.json();
        if (!response.ok || result.ok !== true || !Array.isArray(result.models)) throw new Error('discovery_failed');
        if (!controller.signal.aborted) {
          setModels(result.models);
          setNotice(t(result.models.length ? 'memorySetupModelsLoaded' : 'memorySetupModelsEmpty'));
        }
      } catch {
        if (!controller.signal.aborted) setNotice(t('memorySetupModelsFailed'));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    const choose = (id: string) => {
      setPreset(id);
      const option = MODEL_PRESETS.find((entry) => entry.id === id);
      if (!option || id === 'custom') return;
      if (embedding) {
        update({
          embeddingBaseUrl: option.baseUrl,
          embeddingModel: option.embedding?.model ?? '',
          embeddingDimension: String(option.embedding?.dimension || ''),
          embeddingApiKey: '',
          embeddingSendDimensions: option.embedding?.sendDimensions ?? false,
        });
      } else {
        update({
          baseUrl: option.baseUrl,
          model: option.model,
          apiKey: '',
          ...(!props.models && !draft.embeddingModel && option.embedding
            ? {
                embeddingBaseUrl: option.baseUrl,
                embeddingModel: option.embedding.model,
                embeddingDimension: String(option.embedding.dimension || ''),
                embeddingApiKey: '',
                embeddingSendDimensions: option.embedding.sendDimensions,
              }
            : {}),
        });
      }
    };
    const input = (key: Exclude<keyof MemoryModelDraft, 'embeddingSendDimensions'>, type = 'text') =>
      field(
        t('memorySetup_' + key),
        h('input', {
          className: INPUT_CLASS,
          type,
          value: draft[key],
          readOnly: locked && type !== 'password',
          'aria-label': t('memorySetup_' + key),
          list: key === 'model' || key === 'embeddingModel' ? listId : undefined,
          autoComplete: type === 'password' ? 'new-password' : undefined,
          min: type === 'number' ? 1 : undefined,
          max: type === 'number' ? 65536 : undefined,
          maxLength: type === 'password' ? 4096 : key.endsWith('Url') ? 2048 : 200,
          required: !['apiKey', 'embeddingApiKey', 'embeddingBaseUrl'].includes(key),
          onChange: (event: { target: { value: string } }) =>
            update({
              [key]: event.target.value,
              ...(key === 'baseUrl' ? { apiKey: '' } : key === 'embeddingBaseUrl' ? { embeddingApiKey: '' } : {}),
            }),
        }),
      );
    return h('div', {
      children: [
        field(
          t(embedding ? 'memorySetupEmbeddingPreset' : 'memorySetupPreset'),
          h('select', {
            className: INPUT_CLASS,
            value: preset,
            disabled: locked,
            'aria-label': t(embedding ? 'memorySetupEmbeddingPreset' : 'memorySetupPreset'),
            onChange: (event: { target: { value: string } }) => choose(event.target.value),
            children: MODEL_PRESETS.filter((entry) => !embedding || entry.embedding).map((entry) => {
              const label = t('memorySetupPreset_' + entry.id);
              return h(
                'option',
                { value: entry.id, children: label === 'memorySetupPreset_' + entry.id ? entry.name : label },
                entry.id,
              );
            }),
          }),
        ),
        input(embedding ? 'embeddingBaseUrl' : 'baseUrl', 'url'),
        input(embedding ? 'embeddingApiKey' : 'apiKey', 'password'),
        h('p', { className: 'dsh-pet-cfg__note', children: t('memorySetupKeyHint') }),
        h('button', {
          type: 'button',
          disabled: locked || loading || !url,
          onClick: () => void discover(),
          children: t(loading ? 'memorySetupModelsLoading' : 'memorySetupModelsFetch'),
        }),
        input(embedding ? 'embeddingModel' : 'model'),
        h('datalist', {
          id: listId,
          children: models.map((entry) => h('option', { value: entry.id, children: entry.name }, entry.id)),
        }),
        h('p', { role: 'status', children: notice }),
        embedding ? input('embeddingDimension', 'number') : null,
        embedding
          ? h('label', {
              children: [
                h('input', {
                  type: 'checkbox',
                  checked: draft.embeddingSendDimensions,
                  disabled: locked,
                  onChange: (event: { target: { checked: boolean } }) =>
                    update({ embeddingSendDimensions: event.target.checked }),
                }),
                t('memorySetupSendDimensions'),
              ],
            })
          : null,
        embedding
          ? h('p', {
              className: 'dsh-pet-cfg__note',
              children: t(locked ? 'memorySetupMigration' : 'memorySetupEmbeddingHint'),
            })
          : null,
      ],
    });
  };
}
