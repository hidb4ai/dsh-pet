/**
 * Shared widgets on the settings page: fields, question mark descriptions, card headers, switch grids, and shared
 * constants between input boxes and monospaced fonts. It's all just creating nodes, not including status and not
 * reading the whole world other than translation - the style rules are in `css.ts` and the copy key is in `locales.ts`
 * . It shows that the `data-tip` attribute is unified (the bubble is hung from `./tip-layer` to body for positioning),
 * and does not include an additional layer of DOM to avoid disturbing the spacing and alignment of the outer flex.
 * @module dsh-pet/src/client/settings/ui
 */
import type { ChangeEvent, KeyboardEvent } from 'react';
import type * as ReactNS from 'react';
import type { jsx } from 'react/jsx-runtime';
import type { SettingsRuntime } from './runtime.ts';

/** The class name shared by the input box and the drop-down box. */
export const INPUT_CLASS = 'dsh-pet-cfg__inp';

/**
 * Unified properties for digital input: uncontrolled + out-of-focus submission.
 *
 * The controlled writing method (`value={String(n)}` + `Number(e.target.value)` ) will inevitably turn the empty
 * string into 0 when deleting it. The user will be interrupted when he wants to "delete it completely and then enter
 * it again"; here, the empty box is a valid intermediate state, and it is parsed and submitted only when it is out of
 * focus. `key` follows the value change: if the external configuration is changed, it will be remounted and refreshed.
 * During editing, state will not move, so the input will not be interrupted.
 *
 * @param value - the current effective value.
 * @param onCommit - Submit new value; callback only when there is a real change.
 * @param extra - This input has its own properties (step / min / max / disabled etc.).
 * @returns can be directly assigned to the attributes of `<input>` .
 */
export function numberInputProps(
  value: number,
  onCommit: (value: number) => void,
  extra: ReactNS.JSX.IntrinsicElements['input'] = {},
): ReactNS.JSX.IntrinsicElements['input'] {
  return {
    ...extra,
    type: 'number',
    className: INPUT_CLASS,
    defaultValue: String(value),
    key: String(value),
    onBlur: (e: ChangeEvent<HTMLInputElement>) => {
      const text = e.target.value.trim();
      const parsed = Number(text);
      // Empty string/dirty value = Abandon this edit and return the display to the effective value.
      const next = text !== '' && Number.isFinite(parsed) ? parsed : value;
      e.target.value = String(next);
      if (next !== value) onCommit(next);
    },
    onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') e.currentTarget.blur();
    },
  };
}

/** Fixed-width font stack (for path and command display), use the system stack to avoid pulling in an extra resource. */
export const MONO_STACK = 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Courier New", monospace';

/** Input of folded cards: the title line is permanent and the text is retracted into the cropping layer. */
export interface FoldCardOptions {
  /** The text is id, which is also the target of the title button `aria-controls`. */
  readonly id: string;
  readonly title: string;
  /** Description in question mark bubble. */
  readonly hint: string;
  /** Several lines after expansion; `null` means that the line does not exist and the entire item is skipped. */
  readonly body: ReadonlyArray<ReturnType<typeof jsx> | null>;
  /** Whether it is currently expanded; the opening and closing status is held by the caller using `useState`, and the hook sequence is stable. */
  readonly open: boolean;
  readonly onToggle: () => void;
}

/** Shared widget for the settings page; built in one go by {@link makeUiKit}, each card shares the same set of translations and node factories. */
export interface SettingsUiKit {
  /** The expansion attribute of the floating description: with `data-tip`, it means floating out the bubble. */
  tip: (text: string) => Record<string, string>;
  /** Question mark description entry point: The circular trigger element of bubble. */
  q: (text: string) => ReturnType<typeof jsx>;
  /** Card header: title and question mark description; the action on the right is added by the caller. */
  cardHead: (title: string, hint?: string) => ReturnType<typeof jsx>;
  /** A field: the label (can have a question mark) is at the top and the control is at the bottom. */
  field: (label: string, control: ReturnType<typeof jsx>, hint?: string) => ReturnType<typeof jsx>;
  /** One grid of the switch: check box, title and question mark; the instructions are hung on the question mark, and clicking the title only turns on the switch. */
  toggleCell: (
    label: string,
    value: boolean,
    disabled: boolean,
    onToggle: (value: boolean) => void,
  ) => ReturnType<typeof jsx>;
  /**
   * Folding card skeleton: the title line is permanent and the entire line is clickable, and the text is retracted
   * into the cropping layer.
   *
   * The high transition goes from 0 fr → 1 fr of `grid-template-rows` , no guessing max-height - the text can be
   * collected no matter how long it is.
   */
  foldCard: (options: FoldCardOptions) => ReturnType<typeof jsx>;
}

/**
 * Create a shared widget for the settings page.
 *
 * @param rt - only node factory `h` and translation `t` are used.
 * @returns A collection of small items shared by each card.
 */
export function makeUiKit(rt: Pick<SettingsRuntime, 'h' | 't'>): SettingsUiKit {
  const { h, t } = rt;

  /**
   * Expand property of hover description.
   *
   * @param text - Description text (translated).
   */
  const tip = (text: string): Record<string, string> => ({ 'data-tip': text });

  /** Question mark: The bubble's circular trigger element. Use `<i>` instead of `<button>` - it only shows the description, there should be no behavior when clicked, and it should not enter the Tab sequence. */
  const q = (text: string): ReturnType<typeof jsx> =>
    h('i', { className: 'dsh-pet-cfg__q', ...tip(text), 'aria-label': text, role: 'img', children: '?' });

  return {
    tip,
    q,
    cardHead: (title, hint) =>
      h('div', {
        className: 'dsh-pet-cfg__cardHead',
        children: [
          h('span', { key: 't', className: 'dsh-pet-cfg__cardTitle', children: title }),
          hint ? q(hint) : null,
        ],
      }),
    field: (label, control, hint) =>
      h('div', {
        className: 'dsh-pet-cfg__field',
        children: [
          h('span', {
            key: 'l',
            className: 'dsh-pet-cfg__flabel',
            children: hint ? [label, q(hint)] : label,
          }),
          control,
        ],
      }),
    toggleCell: (label, value, disabled, onToggle) =>
      h('div', {
        className: 'dsh-pet-cfg__toggle',
        children: [
          h('label', {
            key: 'l',
            children: [
              h('input', {
                key: 'i',
                type: 'checkbox',
                checked: value,
                disabled,
                onChange: (e: ChangeEvent<HTMLInputElement>) => onToggle(e.target.checked),
              }),
              h('span', { key: 't', children: t(label) }),
            ],
          }),
          q(t(label + 'Hint')),
        ],
      }),
    foldCard: (options) =>
      h('div', {
        className: 'dsh-pet-cfg__card is-fold' + (options.open ? ' is-open' : ''),
        children: [
          // The entire row is clickable: the title, question mark and arrow are all in the button. The question mark stops bubbling by itself. Clicking it will only produce bubbles, but will not open or close.
          h('button', {
            key: 'head',
            type: 'button',
            className: 'dsh-pet-cfg__foldToggle',
            'aria-expanded': options.open,
            'aria-controls': options.id,
            onClick: options.onToggle,
            children: [
              h('span', { key: 't', className: 'dsh-pet-cfg__cardTitle', children: options.title }),
              h('span', {
                key: 'q',
                className: 'dsh-pet-cfg__qWrap',
                onClick: (e: ReactNS.MouseEvent<HTMLSpanElement>) => e.stopPropagation(),
                children: q(options.hint),
              }),
              // Arrow: rotates 180° when expanded, consistent with the model selector's expanded indication.
              h('i', {
                key: 'c',
                className: 'dsh-pet-cfg__chevron' + (options.open ? ' is-open' : ''),
                'aria-hidden': 'true',
              }),
            ],
          }),
          // The cutting layer bears overflow, and the height of the inner layer of the text is: 0 fr when folded. Cut padding together, leaving no gap at the bottom of the card.
          h('div', {
            key: 'body',
            id: options.id,
            className: 'dsh-pet-cfg__fold',
            'aria-hidden': options.open ? undefined : 'true',
            children: h('div', {
              className: 'dsh-pet-cfg__foldClip',
              children: h('div', { className: 'dsh-pet-cfg__foldBody', children: options.body }),
            }),
          }),
        ],
      }),
  };
}
