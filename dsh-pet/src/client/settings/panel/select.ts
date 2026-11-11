/**
 * General radio selection drop-down on the settings page: trigger + fixed floating layer, replacing the native
 * `<select>` . The native drop-down expanded panel is drawn by the operating system. The font size, rounded corners
 * and hover are not controlled by `--dsw-*` token and have different origins from the input boxes in the same row.
 * Here is a self-drawn copy: the appearance of the trigger reuse `INPUT_CLASS` and the positioning reuse `./placement`
 * . There is no search box or grouping: the number of options is within ten, and the scroll wheel is enough. This
 * document covers states, keyboards, and devices.
 * @module dsh-pet/src/client/settings/panel/select
 */
import type * as ReactNS from 'react';
import type { FunctionComponent } from 'react';
import { INPUT_CLASS } from '../ui.ts';
import type { SettingsRuntime } from '../runtime.ts';
import { computePanelPlacement, type PanelPosition } from './placement.ts';

/** A candidate: return `id` to `onChange`; `label` is already translated display text. */
export interface SelectOption {
  id: string;
  label: string;
}

/** Drop-down external contract: one instance per field. */
export interface SelectProps {
  /** Field label (translated), used as the accessibility name of the trigger. */
  label: string;
  /** Current value; when it is not in `options`, the trigger is left blank and will never be displayed as other options. */
  value: string;
  options: readonly SelectOption[];
  disabled: boolean;
  /** Selected callback; only triggered when the value actually changes, has the same semantics as `change` of native `<select>`. */
  onChange: (id: string) => void;
}

/**
 * Create a single-select drop-down. Dependencies are only injected once at call time: the component type must be
 * stable across renders, otherwise the overlay state (open/highlighted) will be lost every render.
 *
 * @param rt - Injected react capability; no translation is required, the copy is passed in by the caller.
 * @returns drop-down component.
 */
export function makeSelect(
  rt: Pick<SettingsRuntime, 'h' | 'useState' | 'useEffect' | 'useRef'>,
): FunctionComponent<SelectProps> {
  const { h, useState, useEffect, useRef } = rt;

  return function Select(props: SelectProps) {
    const [open, setOpen] = useState(false);
    // Highlighted row: Keyboard ↑↓ This is it.
    const [active, setActive] = useState(0);
    // Floating layer position: Press the trigger to measure once when opening. If there is not enough space, turn it to the top.
    const [pos, setPos] = useState<PanelPosition | null>(null);
    const rootRef = useRef<HTMLDivElement | null>(null);
    const panelRef = useRef<HTMLDivElement | null>(null);

    const selectedAt = props.options.findIndex((option) => option.id === props.value);
    const currentLabel = selectedAt >= 0 ? props.options[selectedAt].label : '';

    /** Open and stop the highlight on the currently selected item. */
    const openAt = (index: number): void => {
      setActive(index >= 0 ? index : 0);
      setOpen(true);
    };
    const commit = (index: number): void => {
      const option = props.options[index];
      setOpen(false);
      if (option !== undefined && option.id !== props.value) props.onChange(option.id);
    };
    const step = (dir: number): void => {
      const count = props.options.length;
      if (count === 0) return;
      const next = (Math.max(active, 0) + dir + count) % count;
      setActive(next);
      panelRef.current?.querySelector('[data-row="' + next + '"]')?.scrollIntoView({ block: 'nearest' });
    };

    useEffect(() => {
      if (!open) return;
      const root = rootRef.current;
      // Positioning + closing timing: The floating layer breaks away from the document flow for actual positioning, scroll/zoom to follow, click outside or Esc to close.
      const place = (): void => {
        if (!root) return;
        setPos(
          computePanelPlacement(
            root.getBoundingClientRect(),
            { width: window.innerWidth, height: window.innerHeight },
            // The same width as the trigger: the lower limit of 240 is reserved for the two paragraphs of text "Service Provider + Model", and the single-line drop-down should not be inherited.
            { minWidthPx: 0 },
          ),
        );
      };
      place();
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

    // It will be disabled during saving: if the overlay is still open, click on the value that should not be changed and close it directly.
    useEffect(() => {
      if (props.disabled) setOpen(false);
    }, [props.disabled]);

    const toggle = (): void => {
      if (props.disabled) return;
      if (open) setOpen(false);
      else openAt(selectedAt);
    };

    const onTriggerKey = (e: ReactNS.KeyboardEvent<HTMLButtonElement>): void => {
      const count = props.options.length;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (open) step(e.key === 'ArrowDown' ? 1 : -1);
        else openAt(selectedAt);
        return;
      }
      if (open && (e.key === 'Home' || e.key === 'End')) {
        e.preventDefault();
        setActive(e.key === 'Home' || count === 0 ? 0 : count - 1);
        return;
      }
      // The Enter/Space of the button will synthesize click once: when the floating layer is on, it will be changed to "select the highlighted row", otherwise it will be closed and then opened again.
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (open) commit(active);
        else openAt(selectedAt);
      }
    };

    const panel =
      open && pos
        ? h('div', {
            ref: panelRef,
            className: 'dsh-pet-sel__panel',
            role: 'listbox',
            'aria-label': props.label,
            style: {
              left: pos.left + 'px',
              top: pos.top === undefined ? undefined : pos.top + 'px',
              bottom: pos.bottom === undefined ? undefined : pos.bottom + 'px',
              width: pos.width + 'px',
              maxHeight: pos.maxHeight + 'px',
            },
            children: h('div', {
              className: 'dsh-pet-sel__list',
              children: props.options.map((option, index) =>
                h('button', {
                  key: option.id,
                  type: 'button',
                  role: 'option',
                  'aria-selected': option.id === props.value,
                  'data-row': index,
                  className: 'dsh-pet-sel__item' + (index === active ? ' is-active' : ''),
                  onMouseMove: () => setActive(index),
                  onClick: () => commit(index),
                  children: [
                    h('span', { key: 'n', className: 'dsh-pet-sel__name', children: option.label }),
                    h('span', {
                      key: 'c',
                      className: 'dsh-pet-sel__check',
                      children: option.id === props.value ? '✓' : '',
                    }),
                  ],
                }),
              ),
            }),
          })
        : null;

    return h('div', {
      ref: rootRef,
      className: 'dsh-pet-sel',
      children: [
        h('button', {
          key: 'trigger',
          type: 'button',
          className: INPUT_CLASS + ' dsh-pet-sel__trigger',
          disabled: props.disabled,
          'aria-haspopup': 'listbox',
          'aria-expanded': open,
          'aria-label': props.label,
          onClick: toggle,
          onKeyDown: onTriggerKey,
          children: [
            h('span', { key: 'l', className: 'dsh-pet-sel__label', children: currentLabel }),
            h('span', { key: 'c', className: 'dsh-pet-sel__chevron' + (open ? ' is-open' : '') }),
          ],
        }),
        panel,
      ],
    });
  };
}
