/**
 * Operation area: three buttons for save, sync, and test notification, as well as two places of feedback (save/sync
 * results and test notification results are separate). "Synchronization" will cover the entire built-in default in the
 * user layer, and the side effect description will be included in the question mark; feedback will only appear when
 * there is content and will not occupy space.
 * @module dsh-pet/src/client/settings/actions
 */
import type { FunctionComponent } from 'react';
import type { SettingsRuntime } from './runtime.ts';
import { makeUiKit } from './ui.ts';

/** One piece of feedback: the text and whether it is wrong. */
export interface Feedback {
  kind: 'ok' | 'err' | '';
  text: string;
}

/** Input in the operating area. */
export interface ActionsProps {
  /** Saving and synchronization are disabled while saving or the configuration is not ready. */
  busy: boolean;
  /** Save/synchronize results. */
  msg: Feedback;
  /** Test notification results. */
  permMsg: Feedback;
  /** Save all configurations. */
  onSave: () => void;
  /** Request synchronization (will confirm first). */
  onSync: () => void;
  /** Send a test system notification. */
  onTestNotification: () => void;
}

/**
 * Build operating area.
 *
 * @param rt - Injected react capabilities and translation functions.
 * @returns operating area component.
 */
export function makeActions(rt: SettingsRuntime): FunctionComponent<ActionsProps> {
  const { h, t } = rt;
  const { tip, q } = makeUiKit({ h, t });

  return function Actions(props: ActionsProps) {
    const { busy, msg, permMsg } = props;
    return h('div', {
      className: 'dsh-pet-cfg__actions',
      children: [
        h('button', {
          type: 'button',
          disabled: busy,
          onClick: props.onSave,
          className: 'dsh-pet-cfg__btn is-primary',
          // The shortcut key bubble pops up from the floating button.
          ...tip(t('saveHotkey')),
          children: t('save'),
        }),
        h('button', {
          type: 'button',
          disabled: busy,
          onClick: props.onSync,
          className: 'dsh-pet-cfg__btn',
          children: t('sync'),
        }),
        h('button', {
          type: 'button',
          onClick: props.onTestNotification,
          className: 'dsh-pet-cfg__btn',
          children: t('notifyTest'),
        }),
        q(t('syncHint')),
        // The two feedbacks belong to their respective fields: msg is the save/synchronization result, and permMsg is the test notification result.
        msg.text
          ? h('span', {
              className: 'dsh-pet-cfg__msg' + (msg.kind === 'err' ? ' is-err' : ''),
              children: msg.text,
            })
          : null,
        permMsg.text
          ? h('span', {
              className: 'dsh-pet-cfg__msg' + (permMsg.kind === 'err' ? ' is-err' : ''),
              children: permMsg.text,
            })
          : null,
      ],
    });
  };
}
