/**
 * "AI Model" single-select drop-down selector (one instance each of whisper/dialogue): trigger + floating layer, a
 * pair of service providers and models are selected at the same time. The data originates from `GET /models` ; when it
 * is turned on, the measured trigger locates the floating layer, point outside the floating layer or Esc is turned
 * off, ↑↓/ Enter shares a set of row lists with the mouse. There is no need for two `<select>` : it takes up space,
 * and it is easy to leave an invalid combination of "only the service provider is selected but not the model"; it also
 * does not provide a retreat for the hand-filled model id. The line list and floating layer positioning are all in
 * pure functions in the same directory. This file only takes care of the status, keyboard and device.
 * @module dsh-pet/src/client/settings/picker/model-picker
 */
import type * as ReactNS from 'react';
import type { FunctionComponent } from 'react';
import type { ModelSelection } from '../../../shared/types.ts';
import type { SettingsRuntime } from '../runtime.ts';
import { buildModelRows, selectableIndexes, type ModelCatalogGroup, type ModelRow } from './model-rows.ts';
import { computePanelPlacement, type PanelPosition } from '../panel/placement.ts';
import { buildModelPanel } from './model-picker-panel.ts';

/** External contract of selector: one field per instance. */
export interface ModelPickerProps {
  /** Field label, used as the accessibility name of the floating layer. */
  label: string;
  /** Current selection; both empty = follow current conversation. */
  value: ModelSelection;
  /** Reason for disabling (saving/configuration not loaded). */
  disabled: boolean;
  /** Candidate list; `null` means it is still being pulled. */
  catalog: readonly ModelCatalogGroup[] | null;
  /** Failed to pull candidate list. */
  failed: boolean;
  /** Backfill the entire pair of values when one is selected. */
  onChange: (value: ModelSelection) => void;
}

/**
 * Build model selector. Dependencies are only injected once at call time: the component type must be stable across
 * renders, otherwise the overlay state (open/search term/highlight) will be lost every render.
 *
 * @param rt - Injected react capabilities and translation functions.
 * @returns selector component.
 */
export function makeModelPicker(
  rt: Pick<SettingsRuntime, 'h' | 'useState' | 'useEffect' | 'useRef' | 't'>,
): FunctionComponent<ModelPickerProps> {
  const { h, useState, useEffect, useRef, t } = rt;

  return function ModelPicker(props: ModelPickerProps) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    // Highlight row (keyboard ↑↓ will go to it; only stop on optional items)
    const [active, setActive] = useState(0);
    // Floating layer position: Press the trigger to measure once when opening. If there is not enough space, turn it to the top.
    const [pos, setPos] = useState<PanelPosition | null>(null);
    const rootRef = useRef<HTMLDivElement | null>(null);
    const panelRef = useRef<HTMLDivElement | null>(null);

    const groups = props.catalog ?? [];
    const group = groups.find((g) => g.id === props.value.provider);
    const picked = group?.models.find((m) => m.id === props.value.model);
    const isFollow = props.value.provider === '';
    const triggerLabel = isFollow ? t('modelFollow') : (picked?.name ?? props.value.model);
    // When the current configuration is not in the list (the service provider is offline/the model is removed from the shelves), it will be marked truthfully and will never be displayed as another model.
    const triggerSub = isFollow ? '' : (group?.name ?? props.value.provider + t('modelUnknown'));

    const rows = buildModelRows(groups, query);
    const selectable = selectableIndexes(rows);

    const commit = (value: ModelSelection): void => {
      props.onChange(value);
      setOpen(false);
      setQuery('');
    };
    const pick = (row: ModelRow | undefined): void => {
      if (!row) return;
      if (row.kind === 'follow') commit({ provider: '', model: '' });
      else if (row.kind === 'model') commit({ provider: row.provider, model: row.model.id });
    };
    const step = (dir: number): void => {
      if (selectable.length === 0) return;
      const at = selectable.indexOf(active);
      const next = selectable[at < 0 ? 0 : (at + dir + selectable.length) % selectable.length];
      setActive(next);
      panelRef.current?.querySelector('[data-row="' + next + '"]')?.scrollIntoView({ block: 'nearest' });
    };

    useEffect(() => {
      if (!open) return;
      const el = rootRef.current;
      // Positioning + closing timing: The floating layer breaks away from the document flow for actual positioning, scroll/zoom to follow, click outside or Esc to close.
      const place = (): void => {
        if (!el) return;
        setPos(
          computePanelPlacement(el.getBoundingClientRect(), {
            width: window.innerWidth,
            height: window.innerHeight,
          }),
        );
      };
      place();
      // Open and focus the search box (DSH also gives focus to search)
      panelRef.current?.querySelector('input')?.focus();
      const onDown = (e: MouseEvent): void => {
        const target = e.target as Node | null;
        if (target && (rootRef.current?.contains(target) === true || panelRef.current?.contains(target) === true)) {
          return;
        }
        setOpen(false);
      };
      const onKey = (e: KeyboardEvent): void => {
        if (e.key === 'Escape') setOpen(false);
      };
      document.addEventListener('mousedown', onDown, true);
      document.addEventListener('keydown', onKey, true);
      window.addEventListener('scroll', place, true);
      window.addEventListener('resize', place);
      return () => {
        document.removeEventListener('mousedown', onDown, true);
        document.removeEventListener('keydown', onKey, true);
        window.removeEventListener('scroll', place, true);
        window.removeEventListener('resize', place);
      };
    }, [open]);

    const toggle = (): void => {
      if (props.disabled) return;
      if (!open) {
        setQuery('');
        // When opening, the highlight stops on the current selection (DSH also locates the selected option first when opening the menu)
        const at = rows.findIndex(
          (r) => r.kind === 'model' && r.provider === props.value.provider && r.model.id === props.value.model,
        );
        setActive(at >= 0 ? at : 0);
      }
      setOpen(!open);
    };

    const panel =
      open && pos
        ? buildModelPanel({
            h,
            t,
            label: props.label,
            disabled: props.disabled,
            catalog: props.catalog,
            failed: props.failed,
            rows,
            active,
            query,
            value: props.value,
            pos,
            panelRef,
            onQueryChange: (value) => {
              setQuery(value);
              setActive(selectable.length > 0 ? selectable[0] : 0);
            },
            onPick: pick,
            onHover: setActive,
            onKeyDown: (event: ReactNS.KeyboardEvent<HTMLInputElement>) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                step(1);
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                step(-1);
              } else if (event.key === 'Enter') {
                event.preventDefault();
                pick(rows[active]);
              }
            },
          })
        : null;

    return h('div', {
      ref: rootRef,
      className: 'dsh-pet-mp',
      children: [
        h('button', {
          key: 'trigger',
          type: 'button',
          className: 'dsh-pet-mp__trigger',
          disabled: props.disabled,
          'aria-haspopup': 'menu',
          'aria-expanded': open,
          'aria-label': t('modelTriggerAria').replace('{model}', triggerLabel),
          onClick: toggle,
          children: [
            h('span', { key: 'l', className: 'dsh-pet-mp__label', children: triggerLabel }),
            triggerSub ? h('span', { key: 's', className: 'dsh-pet-mp__sub', children: triggerSub }) : null,
            h('span', { key: 'c', className: 'dsh-pet-mp__chevron' + (open ? ' is-open' : ''), children: '▾' }),
          ],
        }),
        panel,
      ],
    });
  };
}
