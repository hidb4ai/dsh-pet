/**
 * Action frequency card (main entry): the three weights of standby/turn/move can be changed, and random actions are
 * read-only and automatically calculated. Only the local state is changed, and the entire package is written with
 * "Save"; the total is locked at 100%, and when one item is changed, the rest remains unchanged, and the difference is
 * absorbed by random actions. The entry main is written as the global default for all pets; pet pack can be overridden
 * in your own category file.
 * @module dsh-pet/src/client/settings/motion-card
 */
import type { FunctionComponent } from 'react';
import type { Weights } from '../../shared/types.ts';
import type { SettingsRuntime } from './runtime.ts';
import { INPUT_CLASS, makeUiKit, numberInputProps } from './ui.ts';
import { actionPercent, WEIGHT_KEYS, withWeight } from '../../shared/weights.ts';

/** Input of action frequency card. */
export interface MotionCardProps {
  /** All input is disabled while saving or configuration is not ready. */
  busy: boolean;
  /** The current three weights (random action is the margin, not here). */
  weights: Weights;
  /** The complete weight after changing one of the items. */
  onChange: (weights: Weights) => void;
}

/**
 * Make action frequency card.
 *
 * @param rt - Injected react capabilities and translation functions.
 * @returns card assembly.
 */
export function makeMotionCard(rt: SettingsRuntime): FunctionComponent<MotionCardProps> {
  const { h, t } = rt;
  const { cardHead, field } = makeUiKit({ h, t });

  return function MotionCard(props: MotionCardProps) {
    const { busy, weights } = props;
    // Three editable weights: when one is changed, the other two remain unchanged, and the clamping rule is weights.withWeight.
    const weightFields = WEIGHT_KEYS.map((key) =>
      field(
        t('motion.' + key),
        h(
          'input',
          numberInputProps(weights[key], (value) => props.onChange(withWeight(weights, key, value)), {
            step: '1',
            min: '0',
            max: '100',
            disabled: busy,
          }),
        ),
      ),
    );
    // Random action read-only: Calculated from the sum of 100 − three terms, no entry point is given.
    const actionField = field(
      t('motion.action'),
      h('input', {
        className: INPUT_CLASS,
        type: 'number',
        value: actionPercent(weights),
        readOnly: true,
        tabIndex: -1,
        'aria-label': t('motion.action'),
      }),
    );
    return h('div', {
      className: 'dsh-pet-cfg__card',
      children: [
        cardHead(t('motionTitle'), t('motionHint')),
        h('div', { className: 'dsh-pet-cfg__grid4', children: [...weightFields, actionField] }),
      ],
    });
  };
}
