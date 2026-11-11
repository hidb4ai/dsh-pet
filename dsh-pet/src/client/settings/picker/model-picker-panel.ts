/**
 * DOM tree of model selector floating layer: search box, row list grouped by service provider, loading/failure/empty
 * result three-state prompt. The node is only constructed from view data, does not hold state, and does not read or
 * write DOM - opening and closing, positioning and keyboard are all in `model-picker.ts` . Accessible semantic
 * alignment DSH comes with selectors: floating layer `menu` , row `menuitemradio` , highlight walking `is-active`
 * class.
 * @module dsh-pet/src/client/settings/picker/model-picker-panel
 */
import type * as ReactNS from 'react';
import type { jsx } from 'react/jsx-runtime';
import type { ModelSelection } from '../../../shared/types.ts';
import type { ModelCatalogGroup, ModelRow } from './model-rows.ts';
import type { PanelPosition } from '../panel/placement.ts';

/** Everything needed for floating layer rendering; one copy is calculated for each rendering and is not saved across renderings. */
export interface ModelPanelView {
  h: typeof jsx;
  t: (key: string) => string;
  /** The field label above the trigger serves as an accessibility name for the floating layer. */
  label: string;
  /** Whether the input boxes and rows in the floating layer are disabled (follow the trigger). */
  disabled: boolean;
  /** Candidate list; `null` means it is still being pulled. */
  catalog: readonly ModelCatalogGroup[] | null;
  /** Failed to pull: When the list is still null, the failure text is displayed instead of "Loading". */
  failed: boolean;
  /** List of calculated lines, see `model-rows.ts`. */
  rows: readonly ModelRow[];
  /** The current highlighted line index. */
  active: number;
  /** Current search term. */
  query: string;
  /** Currently selected value, for row `aria-checked`. */
  value: ModelSelection;
  /** fixed positioning of floating layer. */
  pos: PanelPosition;
  /** The root node of the floating layer, which is used to query row nodes and scroll when moving the keyboard. */
  panelRef: ReactNS.MutableRefObject<HTMLDivElement | null>;
  onQueryChange: (value: string) => void;
  onPick: (row: ModelRow | undefined) => void;
  onHover: (index: number) => void;
  onKeyDown: (event: ReactNS.KeyboardEvent<HTMLInputElement>) => void;
}

/**
 * Create floating layer: search box + line list or three-state prompt.
 *
 * @param view - Overlay view data.
 * @returns floating layer root node.
 */
export function buildModelPanel(view: ModelPanelView): ReturnType<typeof jsx> {
  const { h, t } = view;
  const emptyHint =
    view.catalog !== null && view.catalog.length === 0
      ? t('modelNoModels')
      : view.rows.length === 0
        ? t('modelEmpty')
        : '';
  return h('div', {
    ref: view.panelRef,
    className: 'dsh-pet-mp__panel',
    role: 'menu',
    'aria-label': view.label,
    style: {
      left: view.pos.left + 'px',
      top: view.pos.top === undefined ? undefined : view.pos.top + 'px',
      bottom: view.pos.bottom === undefined ? undefined : view.pos.bottom + 'px',
      width: view.pos.width + 'px',
      maxHeight: view.pos.maxHeight + 'px',
    },
    children: [
      searchNode(view),
      view.catalog === null
        ? statusNode(h, 'loading', view.failed ? t('modelCatalogFailed') : t('modelLoading'), false)
        : emptyHint !== ''
          ? statusNode(h, 'empty', emptyHint, true)
          : h('div', {
              key: 'list',
              className: 'dsh-pet-mp__list',
              role: 'group',
              children: view.rows.map((row, index) => rowNode(view, row, index)),
            }),
    ],
  });
}

/** Three-state prompt line: loading/failed/empty result. */
function statusNode(h: typeof jsx, key: string, text: string, live: boolean): ReturnType<typeof jsx> {
  return h('div', {
    key,
    className: 'dsh-pet-mp__status',
    role: live ? 'status' : undefined,
    children: text,
  });
}

/** Search box: ↑↓ Walk, Enter is selected, Esc is monitored and processed by document at the floating level. */
function searchNode(view: ModelPanelView): ReturnType<typeof jsx> {
  const { h, t } = view;
  return h('input', {
    key: 'search',
    type: 'text',
    className: 'dsh-pet-mp__search',
    role: 'searchbox',
    placeholder: t('modelSearch'),
    'aria-label': t('modelSearch'),
    value: view.query,
    disabled: view.disabled,
    onChange: (event: ReactNS.ChangeEvent<HTMLInputElement>) => view.onQueryChange(event.target.value),
    onKeyDown: view.onKeyDown,
  });
}

/** One line: group header, prompt line, model (optional, can be highlighted). */
function rowNode(view: ModelPanelView, row: ModelRow, index: number): ReturnType<typeof jsx> {
  const { h, t } = view;
  if (row.kind === 'group') {
    return h('div', { key: row.key, className: 'dsh-pet-mp__group', children: row.name });
  }
  if (row.kind === 'none') {
    return h('div', { key: row.key, className: 'dsh-pet-mp__status', children: t('modelNone') });
  }
  const checked =
    row.kind === 'follow'
      ? view.value.provider === ''
      : view.value.provider === row.provider && view.value.model === row.model.id;
  return h('button', {
    key: row.key,
    type: 'button',
    role: 'menuitemradio',
    'aria-checked': checked,
    'data-row': index,
    className: 'dsh-pet-mp__item' + (index === view.active ? ' is-active' : ''),
    disabled: view.disabled,
    onClick: () => view.onPick(row),
    onMouseMove: () => view.onHover(index),
    children: [
      h('span', {
        key: 'n',
        className: 'dsh-pet-mp__name',
        children: row.kind === 'follow' ? t('modelFollow') : row.model.name,
      }),
      h('span', { key: 'c', className: 'dsh-pet-mp__check', children: checked ? '✓' : '' }),
    ],
  });
}
