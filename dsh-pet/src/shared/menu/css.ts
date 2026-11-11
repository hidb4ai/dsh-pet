/**
 * Right-click menu style: only selectors and rules are listed, and the injection is handled by the mounting side.
 *
 * No interaction logic is included. The menu is a floating layer covering the web page and desktop content. It needs
 * to have a fixed contrast, so it comes with a set of light color palettes and does not read the host `--dsw-*`
 * variable: following the theme will be blurred on the dark background, and the desktop rendering process will not
 * inject the set of token, so the two ends will look different. Must always be true: menu color matching only appears
 * in this file, caller may not be overridden separately.
 * @module dsh-pet/src/shared/menu/css
 */

/** Menu style - Inject the same portion at both ends. Each level of panel is an independent absolute positioning box. The position is written inline by JS and is not nested in each other. */
export const MENU_CSS = [
  // Fixed light color of the floating layer: the contrast is consistent with the conventions at both ends, taking precedence over following the host theme.
  '.dsh-pet-menu{position:fixed;left:0;top:0;z-index:2147483000;color:#2b2b2b;font-size:13px;line-height:1.5;',
  "font-family:'Microsoft YaHei UI','Segoe UI','PingFang SC',sans-serif;user-select:none;pointer-events:auto}",
  '.dsh-pet-menu,.dsh-pet-menu *{box-sizing:border-box}',
  '.dsh-pet-menu-column{position:absolute;min-width:150px;max-width:300px;padding:4px;',
  'background:rgba(255,255,255,.98);border:1px solid rgba(0,0,0,.12);border-radius:8px;',
  'box-shadow:0 8px 28px rgba(0,0,0,.2);max-height:min(62vh,460px);overflow-y:auto;',
  // Customized scroll bar: Chromium system runs::- webkit-scrollbar, Firefox runs scrollbar-width/scrollbar-color;
  // thumb uses border + background-clip to shrink the white space, and coordinates with the rounded white background.
  'scrollbar-width:thin;scrollbar-color:rgba(0,0,0,.22) transparent}',
  '.dsh-pet-menu-column::-webkit-scrollbar{width:8px;height:8px}',
  '.dsh-pet-menu-column::-webkit-scrollbar-track{background:transparent}',
  '.dsh-pet-menu-column::-webkit-scrollbar-thumb{background:rgba(0,0,0,.16);border-radius:4px;',
  'border:2px solid transparent;background-clip:content-box}',
  '.dsh-pet-menu-column::-webkit-scrollbar-thumb:hover{background:rgba(43,99,255,.4);',
  'border:2px solid transparent;background-clip:content-box}',
  '.dsh-pet-menu-column::-webkit-scrollbar-corner{background:transparent}',
  '.dsh-pet-menu-item{position:relative;display:flex;align-items:center;justify-content:space-between;',
  'gap:14px;padding:5px 12px;border-radius:6px;white-space:nowrap;cursor:default}',
  '.dsh-pet-menu-item:hover{background:rgba(43,99,255,.14)}',
  // The text fills up the remaining width: the menu item is the flex row of space-between. After label eats up the
  // flexible space, the arrow and hint will stick to the right. Select by class name instead of `>span:first-child` -
  // the first child node in the thumbnail item is img.
  '.dsh-pet-menu-label{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis}',
  // Image thumbnail: cut into a small square image and not involved in stretching; the line height is supported by it to 28+ padding.
  '.dsh-pet-menu-thumb{width:28px;height:28px;border-radius:4px;object-fit:cover;flex:none;',
  'background:rgba(0,0,0,.06)}',
  // Items with pictures: The space between pictures and text is narrowed (default 14 px is the spacing for "text ↔ arrow")
  '.dsh-pet-menu-item-pic{gap:8px}',
  // Right shortcut key prompt (menu item hint): flex is on the same line as label, space-between is automatically pasted to the right
  '.dsh-pet-menu-hint{color:#9aa0a6;font-size:12px;flex:none;white-space:nowrap}',
  '.dsh-pet-menu-arrow{color:#9aa0a6;font-size:12px;flex:none}',
].join('');
