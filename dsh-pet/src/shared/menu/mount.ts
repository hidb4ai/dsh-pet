/**
 * Right-click menu mounting: create DOM, position, click outside to close and callback dispatch.
 *
 * Does not determine the menu content (owned by ./tree), only responsible for presentation and events. This must
 * always be true: when unmounting, all monitors must be removed, leaving no hanging elements.
 * @module dsh-pet/src/shared/menu/mount
 */
import type { ContextMenuMount, MenuBranch, MenuLeaf, MenuNode } from './types.ts';
import { pickPanelPosition } from './position.ts';

function isBranchNode(n: MenuNode): n is MenuBranch {
  return 'children' in n && Array.isArray((n as MenuBranch).children);
}

/**
 * Mount a system-style right-click menu (cascading submenu) to document.body, and the position is the viewport
 * coordinates. Structure: The root container has zero size, each level of panel is mounted horizontally, and is
 * positioned next to the screen position of the trigger item (prioritizes the right side of the parent panel, flips to
 * the left side of the parent panel if it cannot fit, and does not overlap with any expanded panels). Cascading: The
 * pointer will never automatically close up in the menu tree, and the entire menu will be closed only when the entire
 * menu leaves (root mouseleave, soft 200 ms). clamp: The rectangle allowed to be occupied (local coordinates of the
 * viewport); the desktop passes "Window ∩ Workspace" - when the pet is attached to the edge, the extended part of the
 * window will be cut off by OS, and it can be fully displayed when constrained in, with zero movement of the window
 * and the pet.
 */
export function mountContextMenu(opts: {
  tree: MenuNode[];
  x: number;
  y: number;
  onAction: (leaf: MenuLeaf) => void;
  /** Notification after the menu is closed (click item/click outside/Esc): the mounting party resets its own state accordingly (such as the desktop interactive mark) */
  onClose?: () => void;
  /** The rectangle the menu is allowed to occupy (viewport local coordinates); default = entire viewport */
  clamp?: { x: number; y: number; w: number; h: number };
}): ContextMenuMount {
  const { tree, x, y, onAction, onClose, clamp } = opts;
  // Defense: When clamp contains non-limited values (for example, the coordinate source is missing and becomes NaN), fallback the entire viewport, otherwise the panel will fall to (0,0)
  const c =
    clamp && Number.isFinite(clamp.x + clamp.y + clamp.w + clamp.h)
      ? clamp
      : { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight };
  const root = document.createElement('div');
  root.className = 'dsh-pet-menu';
  root.style.left = '0px';
  root.style.top = '0px';
  root.addEventListener('contextmenu', (e) => e.preventDefault());

  let closed = false;

  /** Each panel's currently expanded subpanels (none = not expanded); hideChain will be cleared along the chain */
  const openChild = new Map<HTMLElement, HTMLElement>();
  /** The pointer leaves the fallback of the menu tree as a whole and closes the timer (root mouseover cancels when re-entering) */
  let leaveTimer: number | null = null;

  /** Close the entire chain of a certain panel and its descendant panels (display:none + clear openChild chain) */
  const hideChain = (panel: HTMLElement): void => {
    panel.style.display = 'none';
    const child = openChild.get(panel);
    if (child) {
      openChild.delete(panel);
      hideChain(child);
    }
  };

  /**
   * Place the sub-panel next to the trigger item: give priority to the right side of the parent panel. If it cannot
   * fit, flip to the left side of the parent panel, and do not overlap with any expanded panels; when welding, it is
   * sandwiched into clamp.
   */
  const showPanel = (panel: HTMLElement, item: HTMLElement): void => {
    const rect = item.getBoundingClientRect();
    panel.style.left = '';
    panel.style.top = '';
    panel.style.display = 'block';
    const parentEl = item.parentElement;
    const pr = parentEl ? parentEl.getBoundingClientRect() : rect;
    const pick = pickPanelPosition({
      panel: { w: panel.offsetWidth, h: panel.offsetHeight },
      item: { left: rect.left, right: rect.right, top: rect.top },
      parent: { left: pr.left, right: pr.right, top: pr.top },
      others: Array.from(root.querySelectorAll<HTMLElement>('.dsh-pet-menu-column'))
        .filter((p) => p !== panel && p.style.display !== 'none')
        .map((p) => {
          const b = p.getBoundingClientRect();
          return { left: b.left, top: b.top, right: b.right, bottom: b.bottom };
        }),
      clamp: { x: c.x, y: c.y, w: c.w, h: c.h },
    });
    panel.style.left = pick.left + 'px';
    panel.style.top = pick.top + 'px';
  };

  /**
   * Build a layer of panels; the sub-panels of branch items are horizontally linked to root and are not nested. The
   * panel enters DOM first, and the sub-panel enters last. The deeper the level, the higher it is drawn (the sub-menu
   * is placed on top of the parent menu).
   */
  const buildPanel = (nodes: MenuNode[]): HTMLElement => {
    const panel = document.createElement('div');
    panel.className = 'dsh-pet-menu-column';
    panel.style.display = 'none';
    // Desktop clamp: Cap the column height to the visible rectangle (otherwise 62 vh is relative to the window height, and when the visible area is smaller, it will still overflow and be cropped)
    if (clamp) panel.style.maxHeight = Math.min(460, Math.max(120, c.h - 16)) + 'px';
    root.appendChild(panel);
    for (const node of nodes) {
      const item = document.createElement('div');
      item.className = 'dsh-pet-menu-item';
      if (isBranchNode(node)) {
        item.classList.add('dsh-pet-menu-branch');
        const label = document.createElement('span');
        label.className = 'dsh-pet-menu-label';
        label.textContent = node.label;
        const arrow = document.createElement('span');
        arrow.className = 'dsh-pet-menu-arrow';
        arrow.textContent = '▸';
        item.appendChild(label);
        item.appendChild(arrow);
        const childPanel = buildPanel(node.children); // Recursion: The sub-panel has entered the tree (later than this panel). Hover branch: First close the expanded
        // sub-panel chains of other branches of this panel, and then expand the current one. Pointer movement within this menu
        // tree never automatically closes - crossing a 4 px gap or panel gap will not trigger a close.
        item.addEventListener('mouseenter', () => {
          const prev = openChild.get(panel);
          if (prev && prev !== childPanel) hideChain(prev);
          openChild.set(panel, childPanel);
          showPanel(childPanel, item);
        });
      } else {
        // The thumbnail must be before label: the menu item is the flex line, with the image on the left and the text
        // immediately following. Only add thumb to the picture leaf, and the structure of the other items remains
        // unchanged (no space occupied, no line height change).
        if (node.thumb) {
          const thumb = document.createElement('img');
          thumb.className = 'dsh-pet-menu-thumb';
          thumb.src = node.thumb;
          thumb.alt = '';
          thumb.draggable = false;
          // The menu panel is scrollable: pictures outside the visible area do not need to be downloaded immediately (27 original pictures total about 4.6 MB).
          thumb.loading = 'lazy';
          thumb.decoding = 'async';
          item.appendChild(thumb);
          // The spacing between pictures and text is individually narrowed (the menu default 14 px is for "text ↔ arrows", and the pictures look too scattered)
          item.classList.add('dsh-pet-menu-item-pic');
        }
        const label = document.createElement('span');
        label.className = 'dsh-pet-menu-label';
        label.textContent = node.label;
        item.appendChild(label);
        // Gray prompt on the right (such as shortcut keys): flex is on the same line as label, space-between is automatically pasted to the right
        if (node.hint) {
          const hint = document.createElement('span');
          hint.className = 'dsh-pet-menu-hint';
          hint.textContent = node.hint;
          item.appendChild(hint);
        }
        item.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          close();
          onAction(node);
        });
      }
      panel.appendChild(item);
    }
    return panel;
  };

  const rootPanel = buildPanel(tree);
  rootPanel.style.display = 'block';

  // The document must be append first: the panel size cannot be measured before the document is entered, and everything is "silent and no display"
  document.body.appendChild(root);

  // Root panel positioning: press (x, y) to drop, and clamp back when it exceeds the clamp rectangle (same set of logic as the sub-panel but no trigger items)
  rootPanel.style.left = '';
  rootPanel.style.top = '';
  const rw = rootPanel.offsetWidth;
  const rh = rootPanel.offsetHeight;
  rootPanel.style.left = Math.max(c.x + 4, Math.min(x, c.x + c.w - rw - 4)) + 'px';
  rootPanel.style.top = Math.max(c.y + 4, Math.min(y, c.y + c.h - rh - 4)) + 'px';

  // The entire menu is closed after the pointer leaves the menu tree as a whole (leaving the union of all panels) →
  // 200 ms; during this period, any pointer movement (mouseover bubbles to root) is deemed to be still within the
  // menu, and the close is cancelled.
  root.addEventListener('mouseleave', () => {
    if (leaveTimer !== null) window.clearTimeout(leaveTimer);
    leaveTimer = window.setTimeout(() => {
      leaveTimer = null;
      close();
    }, 200);
  });
  root.addEventListener('mouseover', () => {
    if (leaveTimer !== null) {
      window.clearTimeout(leaveTimer);
      leaveTimer = null;
    }
  });

  const onDocPointerDown = (e: MouseEvent): void => {
    if (closed) return;
    if (root.contains(e.target as Node)) return;
    close();
  };
  const onDocKeyDown = (e: KeyboardEvent): void => {
    if (closed) return;
    if (e.key === 'Escape') close();
  };
  document.addEventListener('mousedown', onDocPointerDown, true);
  document.addEventListener('keydown', onDocKeyDown, true);

  const close = (): void => {
    if (closed) return;
    closed = true;
    if (leaveTimer !== null) window.clearTimeout(leaveTimer);
    leaveTimer = null;
    document.removeEventListener('mousedown', onDocPointerDown, true);
    document.removeEventListener('keydown', onDocKeyDown, true);
    root.remove();
    if (onClose) onClose();
  };

  return { el: root, close };
}
