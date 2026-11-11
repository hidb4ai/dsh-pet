/**
 * Select the pet's configuration card: avatar, name/size/display position, corners and offsets, four function
 * switches, instance-level persona. Only edit the instance fields of the main entry: the entry-level fields are
 * configured with fallback by the resolved value, and will not appear in the card or be written back; file pets will
 * never enter this card. Pure display + callback, the status is all in the settings page shell; the patch shape of
 * `onChange` is a preview of the submitted shape. The avatar grid and two sets of fields are in ./pet-card-parts. This
 * file is only for arrangement.
 * @module dsh-pet/src/client/settings/pet-card
 */
import type { ChangeEvent, FunctionComponent } from 'react';
import type { Pet } from '../../shared/types.ts';
import type { SettingsRuntime } from './runtime.ts';
import { INPUT_CLASS, makeUiKit } from './ui.ts';
import { makePetAvatarCell, makePetIdentityFields, makePetPositionFields, type PetPatch } from './pet-card-parts.ts';

/** All input of pet cards. */
export interface PetCardProps {
  /** The currently selected pet; `null` means the list is empty. */
  pet: Pet | null;
  /** Is the form disabled (it is being saved or the configuration has not been loaded yet). */
  busy: boolean;
  /** The latest saved/synchronized feedback is displayed in the upper right corner of the card. */
  msg: { kind: 'ok' | 'err' | ''; text: string };
  /** Entry-level persona text, placeholder as instance persona input box. */
  entryPrompt: string;
  /** The avatar preview address (the cache version number has been broken); when it is not uploaded, the host returns the default logo. */
  avatarSrc: string;
  /** The avatar is being uploaded: the mask is always displayed and the file box is disabled. */
  avatarBusy: boolean;
  /** Select a new avatar; the built-in entry does not have this capability. When undefined is uploaded, only a preview is displayed and cannot be clicked. */
  onAvatar?: (file: File) => void;
  /** Change the selected pet field. */
  onChange: (patch: PetPatch) => void;
  /** Save nearby. */
  onSave: () => void;
  /** Delete the current pet (confirm first). */
  onRemove: () => void;
}

/**
 * Create a pet configuration card.
 *
 * @param rt - Injected react capabilities and translation functions.
 * @returns card assembly.
 */
export function makePetCard(rt: SettingsRuntime): FunctionComponent<PetCardProps> {
  const { h, t } = rt;
  const { tip, q, field, toggleCell } = makeUiKit({ h, t });
  // Component factories are adjusted once each during assembly: component types are stable across renders, and card re-rendering will not rebuild them.
  const AvatarCell = makePetAvatarCell(rt);
  const IdentityFields = makePetIdentityFields(rt);
  const PositionFields = makePetPositionFields(rt);

  return function PetCard(props: PetCardProps) {
    const { pet, busy, msg } = props;
    if (pet === null) return h('p', { className: 'dsh-pet-cfg__note', children: t('emptyPets') });
    return h('div', {
      className: 'dsh-pet-cfg__card',
      children: [
        h('div', {
          className: 'dsh-pet-cfg__cardHead',
          children: [
            h('span', { key: 't', className: 'dsh-pet-cfg__cardTitle', children: t('petCardTitle') }),
            q(t('petCardHint')),
            // Right action group: auto margin is hung on this layer wrapper. The button position will not jump when the saved result appears/disappears.
            h('div', {
              key: 'acts',
              style: { marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '6px' },
              children: [
                // Save the result to the nearest feedback (the same msg status as the bottom of the page), otherwise you will not see the result when you click Save on the card.
                msg.text
                  ? h('span', {
                      key: 'msg',
                      className: 'dsh-pet-cfg__msg' + (msg.kind === 'err' ? ' is-err' : ''),
                      children: msg.text,
                    })
                  : null,
                // Save nearby: save the pet in place after making changes, no need to scroll to "Save" at the bottom; the shortcut bubble will pop up from the floating button.
                h('button', {
                  key: 'sv',
                  type: 'button',
                  onClick: props.onSave,
                  disabled: busy,
                  className: 'dsh-pet-cfg__btn is-primary is-sm',
                  ...tip(t('saveHotkey')),
                  children: t('save'),
                }),
                h('button', {
                  key: 'rm',
                  type: 'button',
                  onClick: props.onRemove,
                  disabled: busy,
                  className: 'dsh-pet-cfg__btn is-danger is-sm',
                  children: t('remove'),
                }),
              ],
            }),
          ],
        }),

        // Top row: avatars in the left column, and a 2×2 input grid on the right.
        h('div', {
          className: 'dsh-pet-cfg__topRow',
          children: [
            h(AvatarCell, {
              avatarSrc: props.avatarSrc,
              avatarBusy: props.avatarBusy,
              busy,
              onAvatar: props.onAvatar,
            }),
            h(IdentityFields, { pet, busy, onChange: props.onChange }),
          ],
        }),

        h(PositionFields, { pet, busy, onChange: props.onChange }),

        h('div', {
          className: 'dsh-pet-cfg__grid4',
          children: [
            toggleCell('balanceEnabled', !!pet.balanceEnabled, busy, (v) => props.onChange({ balanceEnabled: v })),
            toggleCell('whisperEnabled', !!pet.whisperEnabled, busy, (v) => props.onChange({ whisperEnabled: v })),
            toggleCell('workStatusEnabled', !!pet.workStatusEnabled, busy, (v) =>
              props.onChange({ workStatusEnabled: v }),
            ),
            toggleCell('fixedEnabled', !!pet.fixedEnabled, busy, (v) => props.onChange({ fixedEnabled: v })),
          ],
        }),

        // Optional per-pet persona: an empty whisperPrompt inherits the containing entry's persona.
        // Store and display it here; the host builds the system prompt with the pet name and time context.
        // Show the inherited persona as placeholder text. There is no length limit; display only a character count.
        field(
          t('personaLabel'),
          h('div', {
            className: 'dsh-pet-cfg__persona',
            children: [
              h('textarea', {
                className: INPUT_CLASS + ' dsh-pet-cfg__area',
                rows: 3,
                value: String(pet.whisperPrompt ?? ''),
                disabled: busy,
                placeholder: props.entryPrompt,
                onChange: (e: ChangeEvent<HTMLTextAreaElement>) => props.onChange({ whisperPrompt: e.target.value }),
              }),
              h('span', {
                className: 'dsh-pet-cfg__count',
                children: t('personaCount').replace('{n}', String(String(pet.whisperPrompt ?? '').length)),
              }),
            ],
          }),
          t('personaHint'),
        ),
      ],
    });
  };
}
