/**
 * Self-drawn pop-up windows and drop-down selectors: replace window.confirm and native select.
 *
 * Both are hung on body and positioned with fixed to avoid being clipped by the scrolling container of the panel;
 * close the path and use capture for monitoring. Be sure to turn off the old one before opening the new menu. The
 * selector does not hold business status, and the value is collected by the caller's onChange.
 * @module dsh-pet/src/standalone/settings-page/script/overlay
 */

/** Generate overlay fragments. */
export function overlayScript(): string {
  return `
let openMenu = null;

function closeMenu() {
  if (!openMenu) return;
  const dispose = openMenu;
  openMenu = null;
  dispose();
}

function chevron() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('class', 'selectChevron');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M4 6.5 8 10.5 12 6.5');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '1.4');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.append(path);
  return svg;
}

function placeMenu(menu, trigger, widthOf) {
  const rect = trigger.getBoundingClientRect();
  const span = widthOf ? widthOf.getBoundingClientRect() : rect;
  const below = window.innerHeight - rect.bottom;
  const height = Math.min(260, Math.max(120, below > 200 ? below - 16 : rect.top - 16));
  menu.style.left = Math.round(span.left) + 'px';
  menu.style.width = Math.round(span.width) + 'px';
  menu.style.maxHeight = Math.round(height) + 'px';
  if (below > 200 || rect.top < 220) menu.style.top = Math.round(rect.bottom + 4) + 'px';
  else menu.style.top = Math.round(rect.top - height - 4) + 'px';
}

/**
 * Open a drop-down menu.
 *  @param trigger - Trigger button, used to locate and determine "outside point" and mark expansion status.
 *  @param options - Candidates, each item { value , label }.
 *  @param current - Current value.
 *  @param onPick - Check callback.
 *  @param widthOf - Reference element for menu alignment width; defaults to the same width as trigger, used
 * to trigger a combo box whose button is narrower than the menu.
 */
function openSelectMenu(trigger, options, current, onPick, widthOf) {
  closeMenu();
  const menu = make('ul', { class: 'selectMenu' });
  menu.setAttribute('role', 'listbox');
  const items = [];
  for (const option of options) {
    const item = make('li', { class: 'selectItem', text: option.label });
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', option.value === current ? 'true' : 'false');
    item.addEventListener('click', () => pick(option.value));
    menu.append(item);
    items.push({ node: item, value: option.value });
  }
  document.body.append(menu);
  placeMenu(menu, trigger, widthOf);
  trigger.setAttribute('aria-expanded', 'true');
  let active = Math.max(0, options.findIndex((option) => option.value === current));
  highlight(active);

  function highlight(index) {
    active = (index + items.length) % items.length;
    items.forEach((entry, position) => {
      const on = position === active;
      entry.node.classList.toggle('active', on);
      if (on) entry.node.scrollIntoView({ block: 'nearest' });
    });
  }

  function pick(value) {
    dispose();
    onPick(value);
  }

  function onKey(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      dispose();
      trigger.focus();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      highlight(active + (event.key === 'ArrowDown' ? 1 : -1));
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      pick(items[active].value);
      trigger.focus();
    } else if (event.key === 'Tab') {
      dispose();
    }
  }

  function onPointer(event) {
    if (menu.contains(event.target) || trigger.contains(event.target)) return;
    dispose();
  }

  function onReflow() {
    placeMenu(menu, trigger, widthOf);
  }

  function dispose() {
    if (!menu.isConnected) return;
    menu.remove();
    trigger.setAttribute('aria-expanded', 'false');
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('pointerdown', onPointer, true);
    window.removeEventListener('scroll', onReflow, true);
    window.removeEventListener('resize', onReflow);
    if (openMenu === dispose) openMenu = null;
  }

  document.addEventListener('keydown', onKey, true);
  document.addEventListener('pointerdown', onPointer, true);
  window.addEventListener('scroll', onReflow, true);
  window.addEventListener('resize', onReflow);
  openMenu = dispose;
}

/**
 * Create a drop-down selector.
 *  @param options - Candidates, each item { value , label }.
 *  @param value - Initial value.
 *  @param onChange - callback after user selection.
 *  @returns root node and methods for reading and writing the current value.
 */
function createSelect(options, value, onChange) {
  const root = make('div', { class: 'select' });
  const trigger = make('button', { type: 'button', class: 'selectTrigger' });
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');
  const label = make('span', { class: 'selectValue' });
  trigger.append(label, chevron());
  root.append(trigger);
  let current = value;

  function paint() {
    const hit = options.find((option) => option.value === current);
    label.textContent = hit ? hit.label : current;
    trigger.disabled = options.length <= 1;
  }

  trigger.addEventListener('click', () => {
    if (openMenu) {
      closeMenu();
      return;
    }
    openSelectMenu(trigger, options, current, (picked) => {
      current = picked;
      paint();
      onChange(picked);
    });
  });

  paint();
  return {
    root: root,
    getValue: () => current,
    setValue: (next) => {
      current = next;
      paint();
    },
    redraw: paint,
  };
}

/**
 * A confirmation box pops up.
 *  @param options - Title, text, button copy and whether it is a dangerous operation.
 *  @returns is true when confirmed by the user.
 */
function confirmDialog(options) {
  const config = options || {};
  return new Promise((resolve) => {
    const mask = make('div', { class: 'dialogMask' });
    const panel = make('div', { class: 'dialog' });
    panel.setAttribute('role', 'alertdialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', config.title || '确认');
    const text = make('p', { class: 'dialogText', text: config.text || '' });
    // cancelLabel passes to null, which means only prompting and no cancellation: used for pure explanations
    // such as "the last one cannot be deleted".
    const cancel =
      config.cancelLabel === null
        ? null
        : make('button', { type: 'button', class: 'btn', text: config.cancelLabel || '取消' });
    const confirm = make('button', {
      type: 'button',
      class: 'btn ' + (config.danger ? 'danger' : 'primary'),
      text: config.confirmLabel || '确定',
    });
    const actions = make('div', { class: 'dialogActions' }, cancel ? [cancel, confirm] : [confirm]);
    panel.append(make('h2', { class: 'dialogTitle', text: config.title || '确认' }), text, actions);
    mask.append(panel);
    document.body.append(mask);

    function close(result) {
      document.removeEventListener('keydown', onKey, true);
      mask.remove();
      resolve(result);
    }

    function onKey(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close(false);
        return;
      }
      if (event.key !== 'Tab' || !cancel) return;
      event.preventDefault();
      (document.activeElement === confirm ? cancel : confirm).focus();
    }

    if (cancel) cancel.addEventListener('click', () => close(false));
    confirm.addEventListener('click', () => close(true));
    mask.addEventListener('pointerdown', (event) => {
      if (event.target === mask) close(false);
    });
    document.addEventListener('keydown', onKey, true);
    confirm.focus();
  });
}
`;
}
