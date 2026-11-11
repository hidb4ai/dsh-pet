/**
 * Pet tag bar: Each instance of the current type has a button (showing name and width), with "Add Pet" at the end. It
 * is only responsible for "selecting someone" and "adding one". The validity of additions and deletions is determined
 * by the settings page shell.
 * @module dsh-pet/src/client/settings/pet-tabs
 */
import type { FunctionComponent } from 'react';
import type { Pet } from '../../shared/types.ts';
import type { SettingsRuntime } from './runtime.ts';

/** Input of label strip. */
export interface PetTabsProps {
  /** List of instances of the current category. */
  pets: readonly Pet[];
  /** The currently selected pet is id. */
  selId: string;
  /** "Add" is disabled while saving or the configuration is not ready. */
  busy: boolean;
  /** Cut to another pet. */
  onSelect: (id: string) => void;
  /** Add a new instance to the current type. */
  onAdd: () => void;
}

/**
 * Make pet tags.
 *
 * @param rt - Injected react capabilities and translation functions.
 * @returns label strip assembly.
 */
export function makePetTabs(rt: Pick<SettingsRuntime, 'h' | 't'>): FunctionComponent<PetTabsProps> {
  const { h, t } = rt;

  return function PetTabs(props: PetTabsProps) {
    return h('div', {
      className: 'dsh-pet-cfg__tabs',
      children: [
        h('span', { key: 'label', className: 'dsh-pet-cfg__tabsLabel', children: t('petsLabel') }),
        ...props.pets.map((pet) =>
          h('button', {
            key: pet.id,
            type: 'button',
            onClick: () => props.onSelect(pet.id),
            className: 'dsh-pet-cfg__tab' + (pet.id === props.selId ? ' is-active' : ''),
            children:
              (pet.name || pet.id) +
              ' (' +
              pet.size +
              'px' +
              (pet.sizePercent === undefined || pet.sizePercent >= 100 ? '' : ' / ' + pet.sizePercent + '%') +
              ')',
          }),
        ),
        h('button', {
          key: 'add',
          type: 'button',
          onClick: props.onAdd,
          disabled: props.busy,
          className: 'dsh-pet-cfg__tab is-ghost',
          children: '+ ' + t('add'),
        }),
      ],
    });
  };
}
