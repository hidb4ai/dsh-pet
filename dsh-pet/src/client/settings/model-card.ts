/**
 * "AI Model and Dialogue Context" card: whisper/dialogue's respective model (entry level), the maximum number of
 * dialogue history items and the number of pictures (global default), and three dialogue-related switches (whisper
 * picture/dialogue picture/dialogue action linkage). They have the same semantics as the global switch: only the local
 * state is changed, and the entire package is written with "save"; the model is used first when generating the host,
 * and fallback occurs automatically if it fails. If the candidate list fails to be pulled, only one line will be
 * prompted here, and the display and saving of existing configuration values will not be blocked.
 * @module dsh-pet/src/client/settings/model-card
 */
import type { FunctionComponent } from 'react';
import type { ModelSelection } from '../../shared/types.ts';
import type { ModelCatalogGroup } from './picker/index.ts';
import type { ModelPickerProps } from './picker/index.ts';
import type { SettingsRuntime } from './runtime.ts';
import { makeUiKit, numberInputProps } from './ui.ts';
import { makeMemoryStatus } from './memory-status.ts';
import type { ChatMemoryConfig } from '../../shared/chat-memory-config.ts';

/** Key names of two model fields. */
export type ModelFieldKey = 'whisperModel' | 'chatModel';

/** The key names of the three dialogue switches are consistent with the field names of the resolved configuration. */
export type ChatFlagKey = 'whisperImageEnabled' | 'chatImageEnabled' | 'chatAnimationEnabled';

/** Current values of three dialogue switches. */
export type ChatFlagValues = Record<ChatFlagKey, boolean>;

/** Display order and text keys of dialogue switches. */
const CHAT_TOGGLES: Array<{ key: ChatFlagKey; label: string }> = [
  { key: 'whisperImageEnabled', label: 'whisperImageToggle' },
  { key: 'chatImageEnabled', label: 'chatImageToggle' },
  { key: 'chatAnimationEnabled', label: 'chatAnimationToggle' },
];

/** Input of model card. */
export interface ModelCardProps {
  petId?: string;
  longTermMemory?: ChatMemoryConfig;
  onLongTermMemoryChange?: (value: ChatMemoryConfig) => void;
  /** All controls are disabled while saving or configuration is not ready. */
  busy: boolean;
  /** Candidate list; `null` means it is still being pulled. */
  catalog: readonly ModelCatalogGroup[] | null;
  /** Failed to pull candidate list. */
  failed: boolean;
  /** Model used by whisper. */
  whisperModel: ModelSelection;
  /** Model for dialogue. */
  chatModel: ModelSelection;
  /** A certain model field was changed. */
  onModelChange: (key: ModelFieldKey, value: ModelSelection) => void;
  /** Number of conversation history items. */
  chatMemory: number;
  /** The maximum number of dialogue pictures. */
  chatImageLimit: number;
  /** Change the number of dialogue history items. */
  onChatMemoryChange: (value: number) => void;
  /** Change the upper limit of the number of dialogue pictures. */
  onChatImageLimitChange: (value: number) => void;
  /** Current values of three dialogue switches. */
  values: ChatFlagValues;
  /** A certain dialogue switch is toggled. */
  onFlagChange: (key: ChatFlagKey, value: boolean) => void;
}

/**
 * Make model cards.
 *
 * @param rt - Injected react capabilities and translation functions.
 * @param picker - Model selector component (built from the same runtime by the shell, stable across renders).
 * @returns card assembly.
 */
export function makeModelCard(
  rt: SettingsRuntime,
  picker: FunctionComponent<ModelPickerProps>,
): FunctionComponent<ModelCardProps> {
  const { h, t } = rt;
  const MemoryStatus = makeMemoryStatus(rt);
  const { cardHead, field, toggleCell } = makeUiKit({ h, t });

  return function ModelCard(props: ModelCardProps) {
    const { busy, catalog, failed } = props;
    const memory = props.longTermMemory;
    const changeMemory = (patch: Partial<ChatMemoryConfig>) => {
      if (memory) props.onLongTermMemoryChange?.({ ...memory, ...patch });
    };

    /** "Global Default" number grid: labels and question marks are at the top, and number input is at the bottom. */
    const numField = (label: string, value: number, setter: (v: number) => void) =>
      field(
        t(label),
        h('input', numberInputProps(value, setter, { step: '1', min: '0', disabled: busy })),
        t(label + 'Hint'),
      );

    /** A grid of "AI model": the label and question mark are on the top, and the single drop-down selector is on the bottom. */
    const modelCell = (key: ModelFieldKey, value: ModelSelection) => {
      const label = t(key === 'whisperModel' ? 'whisperModelLabel' : 'chatModelLabel');
      return field(
        label,
        h(picker, {
          label,
          value,
          disabled: busy,
          catalog,
          failed,
          onChange: (next: ModelSelection) => props.onModelChange(key, next),
        }),
        t('modelFieldHint'),
      );
    };

    return h('div', {
      className: 'dsh-pet-cfg__card',
      children: [
        cardHead(t('modelTitle'), t('modelHint')),
        failed
          ? h('p', {
              className: 'dsh-pet-cfg__note',
              style: { color: 'var(--dsw-alias-state-error-primary)' },
              children: t('modelCatalogFailed'),
            })
          : null,
        h('div', {
          className: 'dsh-pet-cfg__grid2',
          children: [modelCell('whisperModel', props.whisperModel), modelCell('chatModel', props.chatModel)],
        }),
        h('div', {
          className: 'dsh-pet-cfg__grid4',
          children: [
            numField('chatMemory', props.chatMemory, props.onChatMemoryChange),
            numField('chatImageLimit', props.chatImageLimit, props.onChatImageLimitChange),
          ],
        }),
        h('div', {
          className: 'dsh-pet-cfg__grid3',
          children: CHAT_TOGGLES.map((toggle) =>
            toggleCell(toggle.label, props.values[toggle.key], busy, (value) => props.onFlagChange(toggle.key, value)),
          ),
        }),
        memory
          ? h('div', {
              children: [
                field(
                  t('longTermMemory'),
                  h('select', {
                    value: memory.backend,
                    disabled: busy,
                    onChange: (event: { target: { value: string } }) =>
                      changeMemory({
                        backend: event.target.value === 'powercontext' ? 'powercontext' : 'native',
                      }),
                    children: [
                      h('option', { value: 'native', children: t('memoryNative') }),
                      h('option', { value: 'powercontext', children: 'PowerContext' }),
                    ],
                  }),
                  t('memoryHint'),
                ),
                field(
                  t('historyBytes'),
                  h(
                    'input',
                    numberInputProps(memory.maxHistoryBytes, (value) => changeMemory({ maxHistoryBytes: value }), {
                      min: '0',
                      max: '131072',
                      step: '1',
                      disabled: busy,
                    }),
                  ),
                ),
                memory.backend === 'powercontext'
                  ? h('div', {
                      className: 'dsh-pet-cfg__grid2',
                      children: [
                        field(
                          'PowerContext URL',
                          h('input', {
                            type: 'url',
                            value: memory.serverUrl,
                            disabled: busy,
                            onChange: (event: { target: { value: string } }) =>
                              changeMemory({ serverUrl: event.target.value }),
                          }),
                        ),
                        field(
                          t('recallBytes'),
                          h(
                            'input',
                            numberInputProps(
                              memory.maxRecallBytes,
                              (value) => changeMemory({ maxRecallBytes: value }),
                              { min: '512', max: '32768', step: '1', disabled: busy },
                            ),
                          ),
                        ),
                      ],
                    })
                  : null,
                props.petId ? h(MemoryStatus, { petId: props.petId }, props.petId) : null,
              ],
            })
          : null,
      ],
    });
  };
}
