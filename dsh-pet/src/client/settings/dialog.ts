/**
 * Confirmation/prompt pop-up window (imitation of the official visual: mask + centered card + button). Each of the
 * five scenarios has its own button combination: deletion requires confirmation, only one left (main / a certain type)
 * can only be "got it", synchronization requires confirmation, and configuration damage requires confirmation and
 * forced reconstruction. The action after confirmation is performed by the settings page shell (it only knows how to
 * delete and save force). We are only responsible for questions and answers here.
 * @module dsh-pet/src/client/settings/dialog
 */
import type { FunctionComponent } from 'react';
import type * as ReactNS from 'react';
import type { SettingsRuntime } from './runtime.ts';

/** Pop-up scene; `corrupt` brings out the real writing path given by the host, and `lastOfKind` brings out the category name that cannot be deleted. */
export type DialogState =
  | null
  | { kind: 'remove' }
  | { kind: 'lastOne' }
  | { kind: 'lastOfKind'; entry: string }
  | { kind: 'sync' }
  | { kind: 'corrupt'; path: string };

/** Pop-up window input. */
export interface DialogProps {
  /** Current scene; `null` means not displayed. */
  dialog: Exclude<DialogState, null>;
  /** The currently selected pet id is used for the confirmation text of "Delete pet X". */
  selId: string;
  /** Cancel: Click the mask, cancel button or "Got it". */
  onDismiss: () => void;
  /** Confirmation: dispatched by shell to delete/force rebuild/synchronize by scene. */
  onConfirm: () => void;
}

/** Text copy: one sentence for each scene, and the parameters are substituted in place. */
function bodyText(dialog: Exclude<DialogState, null>, t: (key: string) => string, selId: string): string {
  if (dialog.kind === 'remove') return t('confirmRemove').replace('{id}', selId);
  if (dialog.kind === 'lastOne') return t('atLeastOne');
  if (dialog.kind === 'lastOfKind') return t('lastOfKind').replace('{entry}', dialog.entry);
  if (dialog.kind === 'corrupt') return t('corruptBody').replace('{path}', dialog.path);
  return t('confirmSync');
}

/** Confirm button copy: one sentence for each of the three confirmable scenes. */
function confirmLabel(kind: 'remove' | 'sync' | 'corrupt', t: (key: string) => string): string {
  if (kind === 'remove') return t('remove');
  if (kind === 'corrupt') return t('corruptConfirm');
  return t('sync');
}

/**
 * Create confirmation pop-up window.
 *
 * @param rt - Injected react capabilities and translation functions.
 * @returns pop-up component.
 */
export function makeDialog(rt: SettingsRuntime): FunctionComponent<DialogProps> {
  const { h, t } = rt;

  return function SettingsDialog(props: DialogProps) {
    const { dialog } = props;
    // There is only one left (main or a certain type) with no confirmable action: directly narrow it to null, and there is no need to look at kind for the following branches.
    const confirmable = dialog.kind === 'lastOne' || dialog.kind === 'lastOfKind' ? null : dialog;
    return h('div', {
      style: {
        position: 'fixed',
        inset: 0,
        zIndex: 2147483647,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0, 0, 0, 0.45)',
      },
      onClick: props.onDismiss,
      children: h('div', {
        style: {
          width: '340px',
          maxWidth: 'calc(100vw - 40px)',
          background: 'var(--dsw-alias-bg-layer-1)',
          border: '1px solid var(--dsw-alias-border-l2)',
          borderRadius: '12px',
          padding: '16px 18px',
          boxShadow: '0 8px 30px rgba(0, 0, 0, 0.35)',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
        },
        onClick: (e: ReactNS.MouseEvent<HTMLDivElement>) => e.stopPropagation(),
        children: [
          h('div', {
            style: { fontSize: '14px', fontWeight: 500, color: 'var(--dsw-alias-label-primary)' },
            children: t(dialog.kind === 'corrupt' ? 'corruptTitle' : 'confirmTitle'),
          }),
          h('div', {
            style: { fontSize: '13px', lineHeight: '20px', color: 'var(--dsw-alias-label-secondary)' },
            children: bodyText(dialog, t, props.selId),
          }),
          h('div', {
            style: { display: 'flex', gap: '8px', justifyContent: 'flex-end' },
            // There is only one left with no confirmable action, only "got it"; the others have cancel + confirm double buttons.
            children:
              confirmable === null
                ? [
                    h('button', {
                      key: 'ok',
                      type: 'button',
                      onClick: props.onDismiss,
                      className: 'dsh-pet-cfg__btn is-primary',
                      children: t('ok'),
                    }),
                  ]
                : [
                    h('button', {
                      key: 'cancel',
                      type: 'button',
                      onClick: props.onDismiss,
                      className: 'dsh-pet-cfg__btn',
                      children: t('cancel'),
                    }),
                    h('button', {
                      key: 'confirm',
                      type: 'button',
                      onClick: props.onConfirm,
                      className: 'dsh-pet-cfg__btn ' + (confirmable.kind === 'sync' ? 'is-primary' : 'is-danger'),
                      children: confirmLabel(confirmable.kind, t),
                    }),
                  ],
          }),
        ],
      }),
    });
  };
}
