/**
 * Mobile effect card (global): collision and vibration, tilt to control gravity, shake to throw.
 *
 * Separate from the physical card: These three items all rely on things that are only available on mobile phones -
 * vibration motors, posture/acceleration sensors - and will only be silent and not effective on desktop browsers;
 * putting them in the same card as the values of "drag feel" will make people think that they can also bring out
 * effects on the desktop. Only the local status is changed, and the entire package is written with "Save".
 * @module dsh-pet/src/client/settings/mobile-card
 */
import type { FunctionComponent } from 'react';
import type { PhysicsParams } from '../../shared/types.ts';
import { requestMotionPermission } from '../pet/device-tilt.ts';
import type { SettingsRuntime } from './runtime.ts';
import { makeUiKit } from './ui.ts';

/** Input of mobile effect cards. */
export interface MobileCardProps {
  /** All controls are disabled while saving or configuration is not ready. */
  busy: boolean;
  /** Current physical parameters: The three switches all live in the optional keys in this section. */
  physics: PhysicsParams;
  /** Change some fields of physical parameters. */
  onChange: (patch: Partial<PhysicsParams>) => void;
}

/**
 * Create mobile effect cards.
 *
 * @param rt - Injected react capabilities and translation functions.
 * @returns card assembly.
 */
export function makeMobileCard(rt: SettingsRuntime): FunctionComponent<MobileCardProps> {
  const { h, t } = rt;
  const { cardHead, toggleCell } = makeUiKit({ h, t });

  return function MobileCard(props: MobileCardProps) {
    const { busy, physics } = props;
    return h('div', {
      className: 'dsh-pet-cfg__card',
      children: [
        cardHead(t('mobileTitle'), t('mobileHint')),
        h('div', {
          className: 'dsh-pet-cfg__grid3',
          children: [
            toggleCell('physicsHaptic', physics.hapticEnabled !== false, busy, (v) =>
              props.onChange({ hapticEnabled: v }),
            ),
            toggleCell('physicsTilt', physics.tiltGravity === true, busy, (v) => {
              // iOS 13+ requires that sensor permissions must be applied for in the user gesture; the switch click
              // happens to be that gesture. Only apply for the type of switch you want to use. If you don't want to
              // shake it, you can also ask for permission.
              if (v) void requestMotionPermission({ tilt: true, shake: false });
              props.onChange({ tiltGravity: v });
            }),
            toggleCell('physicsShake', physics.shakeThrow === true, busy, (v) => {
              if (v) void requestMotionPermission({ tilt: false, shake: true });
              props.onChange({ shakeThrow: v });
            }),
          ],
        }),
      ],
    });
  };
}
