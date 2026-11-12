/** Explicit physical controls, distinct from automatic pet chat and animation. */
import { makeRobotSettings } from './settings.ts';
import { robotRequestId, useRobotState, type RobotRuntime } from './state.ts';
import type { RobotKey } from './locales.ts';

/** Create one control panel shared by DSH and standalone chat. */
export function makeRobotPanel(rt: RobotRuntime) {
  const { h, t, useState } = rt;
  const Settings = makeRobotSettings(rt);
  return function RobotPanel(props: { petId: string }) {
    const { snapshot: status, error, pending, send } = useRobotState(rt);
    const [selected, setSelected] = useState('');
    const [text, setText] = useState('');
    const action = status?.config.actions.find((item) => item.key === selected) ?? status?.config.actions[0];
    const blocked = !status || pending || status.busy || status.stopping;
    const ready =
      status?.connected &&
      status.telemetry?.actionCode === 520000 &&
      status.telemetry.modes.every((mode) => mode === 1);
    const button = (label: RobotKey, body: unknown, disabled = false, danger = false) =>
      h('button', {
        type: 'button',
        disabled,
        className: danger ? 'pet-robot-stop' : '',
        onClick: () => void send(body),
        children: t(label),
      });
    return h('details', {
      className: 'pet-robot',
      'data-robot-panel': '',
      children: [
        h('summary', { children: t('robotTitle') }),
        h('div', {
          className: 'pet-robot-body',
          children: [
            h('p', {
              role: 'status',
              children: !status?.config.enabled
                ? t('robotDisabled')
                : status.connected
                  ? t('robotConnected')
                  : t('robotDisconnected'),
            }),
            h('p', {
              children: status?.stopping
                ? t('robotStopping')
                : status?.busy
                  ? t('robotBusy')
                  : status?.armed
                    ? t('robotArmed')
                    : t('robotDisarmed'),
            }),
            h('p', { children: t('robotReady') }),
            h('div', {
              className: 'pet-robot-buttons',
              children: [
                button('robotCheck', { action: 'check' }, pending || !status?.config.enabled || status.checking),
                button(
                  'robotArm',
                  { action: 'arm', session: status?.session, confirmed: true },
                  blocked || !ready || status.armed,
                ),
                button('robotDisarm', { action: 'disarm' }, !status?.armed),
                // Stop remains clickable while action, configuration and connection requests are pending.
                button('robotStop', { action: 'stop' }, !status?.config.address || status.stopping, true),
              ],
            }),
            h('p', { className: 'pet-robot-note', children: t('robotStopHint') }),
            status?.config.actions.length
              ? h('label', {
                  children: [
                    t('robotName'),
                    h('select', {
                      value: action?.key ?? '',
                      disabled: blocked,
                      onChange: (event: { target: { value: string } }) => setSelected(event.target.value),
                      children: status.config.actions.map((item) =>
                        h('option', { key: item.key, value: item.key, children: item.name }),
                      ),
                    }),
                  ],
                })
              : h('p', { children: t('robotEmpty') }),
            h('button', {
              type: 'button',
              disabled: blocked || !status?.armed || !status.connected || !action || !props.petId,
              onClick: () =>
                void send({
                  action: 'execute',
                  session: status?.session,
                  id: robotRequestId(),
                  key: action?.key,
                  petId: props.petId,
                  confirmed: true,
                }),
              children: t('robotRun'),
            }),
            h('label', {
              children: [
                t('robotText'),
                h('input', {
                  value: text,
                  maxLength: 500,
                  onChange: (event: { target: { value: string } }) => setText(event.target.value),
                }),
              ],
            }),
            h('button', {
              type: 'button',
              disabled: blocked || !status?.connected || !text.trim() || !props.petId,
              onClick: () =>
                void send({
                  action: 'speak',
                  session: status?.session,
                  id: robotRequestId(),
                  text,
                  petId: props.petId,
                  confirmed: true,
                }),
              children: t('robotSpeak'),
            }),
            error ? h('p', { role: 'alert', children: `${t('robotRequestError')} (${error})` }) : null,
            status?.error ? h('p', { role: 'alert', children: status.error }) : null,
            status?.telemetry ? h('p', { children: status.telemetry.description }) : null,
            status?.stopResult
              ? h('div', {
                  role: 'status',
                  children: [
                    h('p', { children: status.stopResult.message }),
                    ...Object.entries(status.stopResult.stops ?? {}).map(([name, result]) =>
                      h('p', {
                        key: name,
                        children: `${name}: ${result.ok ? 'ACK' : '?'} ${result.message}`,
                      }),
                    ),
                  ],
                })
              : null,
            status
              ? h(Settings, {
                  key: status.session,
                  config: { ...status.config, petId: props.petId || status.config.petId },
                  disabled: blocked || status.checking,
                  save: (config: unknown) => send({ action: 'configure', config }),
                })
              : null,
            h('details', {
              children: [
                h('summary', { children: t('robotHistory') }),
                h('p', { className: 'pet-robot-note', children: t('robotResultHint') }),
                ...(status?.commands ?? [])
                  .slice()
                  .reverse()
                  .map((item) =>
                    h('p', {
                      key: item.id,
                      children: [
                        `${item.key}: ${t(
                          item.state === 'reported-success'
                            ? 'robotReported'
                            : item.state === 'unknown'
                              ? 'robotUnknown'
                              : item.state === 'failed'
                                ? 'robotFailed'
                                : 'robotRunning',
                        )}`,
                        h('br'),
                        item.message,
                      ],
                    }),
                  ),
              ],
            }),
          ],
        }),
      ],
    });
  };
}
