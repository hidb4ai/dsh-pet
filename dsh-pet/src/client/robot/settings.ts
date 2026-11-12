/** Edit robot connection and manufacturer-provided action mappings in the chat panel. */
import type { RobotConfig } from '../../shared/robot.ts';
import { robotRequestId, type RobotRuntime } from './state.ts';

/** Parse action IDs without turning an empty field into action zero. */
export function parseRobotActionIds(value: string): number[] {
  if (!/^\d+(\s*,\s*\d+)*$/.test(value.trim())) throw new Error('robotInvalidIds');
  const ids = value.split(',').map(Number);
  if (ids.length > 32 || ids.some((id) => !Number.isSafeInteger(id) || id > 2_147_483_647))
    throw new Error('robotInvalidIds');
  return ids;
}

/** Keep operator drafts separate from polled status. */
export function makeRobotSettings(rt: RobotRuntime) {
  const { h, t, useState } = rt;
  return function RobotSettings(props: {
    config: RobotConfig;
    disabled: boolean;
    save: (config: RobotConfig) => Promise<boolean>;
  }) {
    const [draft, setDraft] = useState(props.config);
    const [rows, setRows] = useState(props.config.actions.map((item) => ({ ...item, ids: item.actionIds.join(', ') })));
    const [message, setMessage] = useState('');
    const field = (label: string, value: string, onChange: (value: string) => void, type = 'text') =>
      h('label', {
        children: [
          label,
          h('input', { type, value, onChange: (event: { target: { value: string } }) => onChange(event.target.value) }),
        ],
      });
    return h('details', {
      children: [
        h('summary', { children: t('robotSetup') }),
        h('form', {
          onSubmit: (event: { preventDefault(): void }) => {
            event.preventDefault();
            try {
              const config = {
                ...draft,
                actions: rows.map(({ ids, ...item }) => ({ ...item, actionIds: parseRobotActionIds(ids) })),
              };
              void props.save(config).then((ok) => setMessage(ok ? t('robotSaved') : t('robotRequestError')));
            } catch {
              setMessage(t('robotInvalidIds'));
            }
          },
          children: [
            h('fieldset', {
              disabled: props.disabled,
              children: [
                h('label', {
                  children: [
                    h('input', {
                      type: 'checkbox',
                      checked: draft.enabled,
                      onChange: (event: { target: { checked: boolean } }) =>
                        setDraft({ ...draft, enabled: event.target.checked }),
                    }),
                    t('robotEnabled'),
                  ],
                }),
                field(t('robotAddress'), draft.address, (address) => setDraft({ ...draft, address })),
                h('label', {
                  children: [
                    t('robotRuntime'),
                    h('select', {
                      'aria-label': t('robotRuntime'),
                      value: draft.python === 'bundled' ? 'bundled' : 'custom',
                      onChange: (event: { target: { value: string } }) =>
                        setDraft({ ...draft, python: event.target.value === 'bundled' ? 'bundled' : 'python3' }),
                      children: [
                        h('option', { value: 'bundled', children: t('robotBundled') }),
                        h('option', { value: 'custom', children: t('robotCustom') }),
                      ],
                    }),
                  ],
                }),
                draft.python === 'bundled'
                  ? null
                  : field(t('robotPython'), draft.python, (python) => setDraft({ ...draft, python })),
                field(
                  t('robotTimeout'),
                  String(draft.timeoutSeconds),
                  (value) => setDraft({ ...draft, timeoutSeconds: Number(value) }),
                  'number',
                ),
                ...rows.map((item, index) => {
                  const update = (change: Partial<typeof item>) =>
                    setRows((old) => old.map((row, n) => (n === index ? { ...row, ...change } : row)));
                  return h('div', {
                    key: item.key,
                    className: 'pet-robot-action-row',
                    children: [
                      field(t('robotName'), item.name, (name) => update({ name })),
                      field(t('robotIds'), item.ids, (ids) => update({ ids })),
                      field(t('robotAnimation'), item.petAnimation, (petAnimation) => update({ petAnimation })),
                      h('button', {
                        type: 'button',
                        onClick: () => setRows((old) => old.filter((_, n) => n !== index)),
                        children: t('robotRemove'),
                      }),
                    ],
                  });
                }),
                h('button', {
                  type: 'button',
                  disabled: rows.length >= 20,
                  onClick: () =>
                    setRows((old) => [
                      ...old,
                      {
                        key: 'action-' + robotRequestId().slice(0, 8),
                        name: '',
                        actionIds: [],
                        ids: '',
                        petAnimation: '',
                      },
                    ]),
                  children: t('robotAdd'),
                }),
                h('button', { type: 'submit', children: t('robotSave') }),
              ],
            }),
            message ? h('p', { role: 'status', children: message }) : null,
          ],
        }),
      ],
    });
  };
}
