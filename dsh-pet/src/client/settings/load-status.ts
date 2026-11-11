/**
 * Loading status bar: The configuration also displays a line of status when the pull or pull fails, and gives "Retry"
 * when it fails. When ready, the entire block does not appear and does not take up space - it is just the temporary
 * prompt at the top of the settings page.
 * @module dsh-pet/src/client/settings/load-status
 */
import type { FunctionComponent } from 'react';
import type { SettingsRuntime } from './runtime.ts';
import type { LoadState } from './config/index.ts';

/** Load status bar input. */
export interface LoadStatusProps {
  /** Current loading status; no rendering when `ready`. */
  loadState: LoadState;
  /** Pull the configuration again. */
  onRetry: () => void;
}

/**
 * Create a status bar.
 *
 * @param rt - Injected react capabilities and translation functions.
 * @returns status bar component.
 */
export function makeLoadStatus(rt: Pick<SettingsRuntime, 'h' | 't'>): FunctionComponent<LoadStatusProps> {
  const { h, t } = rt;

  return function LoadStatus(props: LoadStatusProps) {
    if (props.loadState === 'ready') return null;
    const failed = props.loadState === 'error';
    return h('div', {
      role: failed ? 'alert' : 'status',
      className: 'dsh-pet-cfg__actions',
      children: [
        h('span', { children: t(failed ? 'loadError' : 'loading') }),
        failed
          ? h('button', {
              type: 'button',
              className: 'dsh-pet-cfg__btn',
              onClick: props.onRetry,
              children: t('retry'),
            })
          : null,
      ],
    });
  };
}
