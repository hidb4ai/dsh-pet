/**
 * Menu node types: leaf, branch and mount handle.
 *
 * Pure type declaration, no implementation. This must always be true: a leaf must have action or anim (at least one of
 * them), a branch must have children, not both.
 * @module dsh-pet/src/shared/menu/types
 */
import { type PetDisplay } from '../types.ts';

/** Leaves: Clickable menu items. */
export interface MenuLeaf {
  label: string;
  /** Playback animation name (playback request action); action takes precedence over anim */
  anim?: string;
  /**
   * Custom actions: open website / check balance / whisper immediately / open conversation pop-up window / open to-do
   * panel / return to initial position / reload configuration (exclusive for desktop, restart desktop Helper and
   * rebuild the window according to the latest configuration) / change display position (see display for target value,
   * injected from both ends) / third-party menu item (only report owner and label to register Party, it determines
   * what to do specifically). Manual triggering is not affected by whisperEnabled - that field only turns off
   * automatic polling.
   */
  action?:
    | 'open-site'
    | 'show-balance'
    | 'whisper'
    | 'chat'
    | 'todo'
    | 'home'
    | 'reload'
    | 'set-display'
    | 'sleep'
    | 'wake'
    | 'third-party';
  /** Target display position of set-display (same set of values as the drop-down box on the settings page) */
  display?: PetDisplay;
  /**
   * third-party: register its owner (identity key, only used for return, not displayed); items of the same owner are
   * collected under the same group. When there is only one item, this layer is skipped and tiled directly.
   */
  owner?: string;
  /** The small gray text on the right side of the item (such as shortcut keys): purely visual prompt, does not participate in text matching and does not affect action distribution, and does not occupy space by default. */
  hint?: string;
  /**
   * Specify the accompanying picture (the name in the emoticon pool): When used together with action =' whisper ', it
   * means "use this picture to say something", and other actions will ignore it. The name is verified by the host to
   * see if it is still in the pool before being generated.
   */
  image?: string;
  /** Thumbnail address to the left of the item (full URL, encoded). Default = text only, no placeholder. */
  thumb?: string;
}

/** Branch: Item with submenu. */
export interface MenuBranch {
  label: string;
  children: MenuNode[];
}

export type MenuNode = MenuLeaf | MenuBranch;

/** Third-party menu item (snapshot delivered by host via sections.menu of /state, one item = one clickable item). */
export interface MenuMoreItem {
  /** register party identity; it is also the first-level group name (for display) */
  owner: string;
  /** Item name (used for display and also the identifier returned to the register party) */
  label: string;
}

/** Right-click menu to mount handle. */
export interface ContextMenuMount {
  /** Mounted root element (under document.body) */
  el: HTMLElement;
  /** Close and clean up (idempotent) */
  close: () => void;
}
