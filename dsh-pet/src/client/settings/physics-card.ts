/**
 * Physics card (global): gravity, elasticity, ground friction, throwing force, and two switches for top rebound/pet
 * collision. Only the local state is changed, and the entire package is written with "save"; it takes effect
 * immediately after saving in the browser, and the Helper restart and reread triggered by the save on the desktop side
 * - physics is read-only once during the construction of sprite, so no immediate writing is done here. The collision
 * vibration and two somatosensory switches rely on the mobile phone hardware and are placed in the "Mobile Effects"
 * card.
 * @module dsh-pet/src/client/settings/physics-card
 */
import type { FunctionComponent } from 'react';
import type { PhysicsParams } from '../../shared/types.ts';
import type { SettingsRuntime } from './runtime.ts';
import { makeUiKit, numberInputProps } from './ui.ts';

/** Input of physical card. */
export interface PhysicsCardProps {
  /** All controls are disabled while saving or configuration is not ready. */
  busy: boolean;
  /** Current physical parameters. */
  physics: PhysicsParams;
  /** Change some fields of physical parameters. */
  onChange: (patch: Partial<PhysicsParams>) => void;
}

/**
 * Create a physical card.
 *
 * @param rt - Injected react capabilities and translation functions.
 * @returns card assembly.
 */
export function makePhysicsCard(rt: SettingsRuntime): FunctionComponent<PhysicsCardProps> {
  const { h, t } = rt;
  const { cardHead, field, toggleCell } = makeUiKit({ h, t });

  return function PhysicsCard(props: PhysicsCardProps) {
    const { busy, physics } = props;

    /** One grid for physical parameters: label and question mark at the top, numerical input at the bottom. */
    const physField = (key: 'gravity' | 'restitution' | 'groundFriction' | 'throwPower', step: string, min: string) =>
      field(
        t('physics.' + key),
        h(
          'input',
          numberInputProps(physics[key], (v) => props.onChange({ [key]: v }), { step, min, disabled: busy }),
        ),
        t('physics.' + key + 'Hint'),
      );

    return h('div', {
      className: 'dsh-pet-cfg__card',
      children: [
        cardHead(t('physicsTitle'), t('physicsHint')),
        h('div', {
          className: 'dsh-pet-cfg__grid4',
          children: [
            physField('gravity', '50', '0'),
            physField('restitution', '0.01', '0'),
            physField('groundFriction', '0.1', '0'),
            physField('throwPower', '0.05', '0.05'),
          ],
        }),
        h('div', {
          className: 'dsh-pet-cfg__grid2',
          children: [
            toggleCell('physicsCeilingBounce', physics.ceilingBounce, busy, (v) =>
              props.onChange({ ceilingBounce: v }),
            ),
            toggleCell('physicsPetCollision', physics.petCollision, busy, (v) => props.onChange({ petCollision: v })),
          ],
        }),
      ],
    });
  };
}
