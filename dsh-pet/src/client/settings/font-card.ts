/**
 * Appearance and font card (global default): font type, font size, whether to follow the pet to talk. The font type
 * applies to all text currently using soft candy bodies; the font size only applies to bubbles and floating prompts,
 * while dialog windows and score pop-ups remain unchanged. The same semantics as other global defaults: only the local
 * state is changed, and the entire package is written with "save".
 * @module dsh-pet/src/client/settings/font-card
 */
import type { FunctionComponent } from 'react';
import type { FontConfig, FontFamilyId } from '../../shared/types.ts';
import { FONT_PRESETS, FONT_SIZE_MAX, FONT_SIZE_MIN } from '../../shared/fonts.ts';
import type { SettingsRuntime } from './runtime.ts';
import { makeUiKit, numberInputProps } from './ui.ts';
import { makeSelect } from './panel/select.ts';

/** Input of font card. */
export interface FontCardProps {
  /** All controls are disabled while saving or configuration is not ready. */
  busy: boolean;
  /** Current font configuration. */
  font: FontConfig;
  /** Change some fields of font configuration. */
  onChange: (patch: Partial<FontConfig>) => void;
}

/**
 * Create appearance and font cards.
 *
 * @param rt - Injected react capabilities and translation functions.
 * @returns card assembly.
 */
export function makeFontCard(rt: SettingsRuntime): FunctionComponent<FontCardProps> {
  const { h, t } = rt;
  const { cardHead, field, toggleCell } = makeUiKit({ h, t });
  const Select = makeSelect(rt);

  return function FontCard(props: FontCardProps) {
    const { busy, font } = props;
    return h('div', {
      className: 'dsh-pet-cfg__card',
      children: [
        cardHead(t('fontTitle'), t('fontHint')),
        h('div', {
          className: 'dsh-pet-cfg__grid2',
          children: [
            field(
              t('fontFamilyLabel'),
              h(Select, {
                label: t('fontFamilyLabel'),
                value: font.family,
                options: FONT_PRESETS.map((preset) => ({ id: preset.id, label: t('font.' + preset.id) })),
                disabled: busy,
                onChange: (id: string) => props.onChange({ family: id as FontFamilyId }),
              }),
              t('fontFamilyHint'),
            ),
            field(
              t('fontSizeLabel'),
              h(
                'input',
                numberInputProps(font.size, (v) => props.onChange({ size: v }), {
                  step: '1',
                  min: String(FONT_SIZE_MIN),
                  max: String(FONT_SIZE_MAX),
                  disabled: busy,
                }),
              ),
              t('fontSizeHint'),
            ),
          ],
        }),
        h('div', {
          className: 'dsh-pet-cfg__grid2',
          children: [toggleCell('fontFollowToggle', font.followPet, busy, (v) => props.onChange({ followPet: v }))],
        }),
      ],
    });
  };
}
