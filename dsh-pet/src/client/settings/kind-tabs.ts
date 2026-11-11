/**
 * Category label bar: List all categories horizontally (built-in + each pet pack), click to switch the current
 * category.
 *
 * It is only responsible for "which category to switch to"; the addition, deletion and field editing of instances are
 * handled by the pet tag strip and the settings page shell.
 * @module dsh-pet/src/client/settings/kind-tabs
 */
import type { FunctionComponent } from 'react';
import type { PetKind } from './use-pet-list.ts';
import type { SettingsRuntime } from './runtime.ts';

/** Input of category label strip. */
export interface KindTabsProps {
  /** All categories (the order is the order of items in the resolved value). */
  kinds: readonly PetKind[];
  /** Current category (entry name). */
  kind: string;
  /** Switching is disabled while saving or configuration is not ready. */
  busy: boolean;
  /** Switch to another category. */
  onSelect: (entry: string) => void;
}

/**
 * Create category label strips.
 *
 * @param rt - Injected react capabilities and translation functions.
 * @returns category label strip component.
 */
export function makeKindTabs(rt: Pick<SettingsRuntime, 'h' | 't'>): FunctionComponent<KindTabsProps> {
  const { h, t } = rt;

  return function KindTabs(props: KindTabsProps) {
    return h('div', {
      className: 'dsh-pet-cfg__kinds',
      children: [
        h('span', { key: 'label', className: 'dsh-pet-cfg__tabsLabel', children: t('kindLabel') }),
        ...props.kinds.map((item) =>
          h('button', {
            key: item.entry,
            type: 'button',
            disabled: props.busy,
            onClick: () => props.onSelect(item.entry),
            className: 'dsh-pet-cfg__tab' + (item.entry === props.kind ? ' is-active' : ''),
            // The main entry is fixedly displayed as "built-in"; the file pet directly displays the directory prefix (consistent with the asset root).
            children: (item.kind === 'main' ? t('kindMain') : item.entry) + ' (' + item.count + ')',
          }),
        ),
      ],
    });
  };
}
