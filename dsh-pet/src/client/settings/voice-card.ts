/**
 * Voice card: four broadcast switches, tone and volume.
 *
 * Switch to only change the local state and write the entire package with "Save" - instant disk writing will restart
 * the desktop Helper and rebuild all desktop pet windows. The tone selector is shell-injected (isomorphic to the model
 * card injecting picker), and the card itself does not hardcode any tone id.
 * @module dsh-pet/src/client/settings/voice-card
 */
import type { FunctionComponent } from 'react';
import type { VoiceOption, VoicePickerProps } from './picker/voice-picker.ts';
import type { SettingsRuntime } from './runtime.ts';
import { makeUiKit, numberInputProps } from './ui.ts';

export type { VoiceOption } from './picker/voice-picker.ts';

/** Voice card input. */
export interface VoiceCardProps {
  /** All controls are disabled while saving or configuration is not ready. */
  readonly busy: boolean;
  /** Current value of manual broadcast switch: manually triggered whisper and conversation reply. */
  readonly enabled: boolean;
  /** Current tone id. */
  readonly voiceName: string;
  /** Playback volume coefficient: decimal of 0–1, 1 = maximum volume. */
  readonly volume: number;
  /** Optional voice; when empty, the selector only displays the current value (the list has not been pulled back or the pull failed). */
  readonly voices: readonly VoiceOption[];
  /** Do you want to read the cycle whisper? */
  readonly whisperEnabled: boolean;
  /** Do you want to read out the to-do reminder? */
  readonly todoEnabled: boolean;
  /** Do you need to read out the work status report? */
  readonly notifyEnabled: boolean;
  /** Switch the manual broadcast switch. */
  readonly onToggle: (value: boolean) => void;
  /** Select tone. */
  readonly onVoiceChange: (voiceName: string) => void;
  /** Adjust playback volume. */
  readonly onVolumeChange: (volume: number) => void;
  /** Switch the periodic whisper broadcast. */
  readonly onWhisperToggle: (value: boolean) => void;
  /** Switch the broadcast of to-do reminders. */
  readonly onTodoToggle: (value: boolean) => void;
  /** Switch working status broadcast. */
  readonly onNotifyToggle: (value: boolean) => void;
}

/**
 * Make a voice card.
 *
 * @param rt - Injected react capabilities and translation functions.
 * @param picker - Tone selector component; like the model card, it is created once and then injected by the assembly
 * root to ensure the stability of component types across renderings.
 * @returns card assembly.
 */
export function makeVoiceCard(
  rt: SettingsRuntime,
  picker: FunctionComponent<VoicePickerProps>,
): FunctionComponent<VoiceCardProps> {
  const { h, t } = rt;
  const { cardHead, field, toggleCell } = makeUiKit({ h, t });

  return function VoiceCard(props: VoiceCardProps) {
    return h('div', {
      className: 'dsh-pet-cfg__card',
      children: [
        cardHead(t('voiceTitle'), t('voiceHint')),
        // Four switches in the first row: one for each of the four types of voices, which must be adjacent and read as
        // "the same type"; two inputs in the second row: voice and volume. There is no text label or question mark
        // attached to the voice: pulling down the current value "Xiao Yi (female, lively)" itself explains what it
        // is.
        h('div', {
          className: 'dsh-pet-cfg__grid4',
          children: [
            toggleCell('voiceEnabled', props.enabled, props.busy, props.onToggle),
            toggleCell('voiceWhisperEnabled', props.whisperEnabled, props.busy, props.onWhisperToggle),
            toggleCell('voiceTodoEnabled', props.todoEnabled, props.busy, props.onTodoToggle),
            toggleCell('voiceNotifyEnabled', props.notifyEnabled, props.busy, props.onNotifyToggle),
          ],
        }),
        h('div', {
          className: 'dsh-pet-cfg__grid2',
          children: [
            h(picker, {
              label: t('voiceNameLabel'),
              value: props.voiceName,
              options: props.voices,
              disabled: props.busy,
              onChange: props.onVoiceChange,
            }),
            field(
              t('voiceVolumeLabel'),
              h(
                'input',
                numberInputProps(props.volume, props.onVolumeChange, {
                  step: '0.05',
                  min: '0',
                  max: '1',
                  disabled: props.busy,
                }),
              ),
              t('voiceVolumeHint'),
            ),
          ],
        }),
      ],
    });
  };
}
