/**
 * Public exit from right-click menu: tree construction, styles and DOM mount.
 *
 * Only re-export; criterion is in ./menu/tree and mounted in ./menu/mount. It must always be true: data and criteria
 * are pure functions, shared by both browser and desktop.
 * @module dsh-pet/src/shared/menu
 */
export type { ContextMenuMount, MenuBranch, MenuLeaf, MenuMoreItem, MenuNode } from './menu/types.ts';
export type { MemeGroups, MemeGroupSource } from './menu/memes.ts';
export {
  MORE_MENU_LABEL,
  buildMenuTree,
  buildMoreBranch,
  displayMenuBranch,
  isNoMirrorAnimation,
  isSleepAllowedAction,
  readMenuItems,
} from './menu/tree.ts';
export { buildMemeBranch, groupMemes, memeThumbUrl } from './menu/memes.ts';
export { MENU_CSS } from './menu/css.ts';
export { mountContextMenu } from './menu/mount.ts';
