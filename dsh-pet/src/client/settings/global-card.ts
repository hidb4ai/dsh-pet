/**
 * Global switch card: notifications, click sound effects, lock on current screen and system tray. Switch to only
 * change the local state, and then "save" the entire package to write - instant disk writing will restart the desktop
 * Helper and rebuild all desktop pet windows. The notification switch requires additional user gestures. Both opening
 * and closing have to go through the same entry point of the shell, so the card only returns the key name and target
 * value.
 * @module dsh-pet/src/client/settings/global-card
 */
import type { FunctionComponent } from 'react';
import type { SettingsRuntime } from './runtime.ts';
import { makeUiKit } from './ui.ts';

/** The key names of the four global switches are consistent with the field names of the resolved configuration. */
export type GlobalFlagKey = 'notificationsEnabled' | 'clickSoundEnabled' | 'confineToScreen' | 'trayEnabled';

/** Current values of four global switches. */
export type GlobalFlags = Record<GlobalFlagKey, boolean>;

/** Global switch card input. */
export interface GlobalCardProps {
  /** All switches are disabled while saving or configuration is not ready. */
  busy: boolean;
  /** Current value. */
  values: GlobalFlags;
  /** A switch is toggled; permission request for notification switch is handled by the shell. */
  onChange: (key: GlobalFlagKey, value: boolean) => void;
}

/** Display order and text keys of switches. */
const TOGGLES: Array<{ key: GlobalFlagKey; label: string }> = [
  { key: 'notificationsEnabled', label: 'notifyToggle' },
  { key: 'clickSoundEnabled', label: 'clickSoundToggle' },
  { key: 'confineToScreen', label: 'confineToggle' },
  { key: 'trayEnabled', label: 'trayToggle' },
];

/**
 * Create a global switch card.
 *
 * @param rt - Injected react capabilities and translation functions.
 * @returns card assembly.
 */
export function makeGlobalCard(rt: SettingsRuntime): FunctionComponent<GlobalCardProps> {
  const { h, t } = rt;
  const { cardHead, toggleCell } = makeUiKit({ h, t });

  return function GlobalCard(props: GlobalCardProps) {
    return h('div', {
      className: 'dsh-pet-cfg__card',
      children: [
        cardHead(t('globalTitle'), t('globalHint')),
        h('div', {
          className: 'dsh-pet-cfg__grid4',
          children: TOGGLES.map((toggle) =>
            toggleCell(toggle.label, props.values[toggle.key], props.busy, (value) =>
              props.onChange(toggle.key, value),
            ),
          ),
        }),
      ],
    });
  };
}
