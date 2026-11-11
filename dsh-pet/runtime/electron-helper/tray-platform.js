/**
 * Platform differences in system tray (pure judgment, not require electron).
 *
 * The rules live here, main.js is only wired, so that it can be loaded directly by node:test: macOS menu bar has dark
 * and light colors, the icon must be processed according to the template image and the left-click menu pops up;
 * Windows's setContextMenu only takes over the right click, and the icon will be included in the overflow panel;
 * Linux's click event is unreliable and native GNOME does not display the system tray icon by default. These different
 * codes cannot be managed and can only be divided according to platforms.
 * @module dsh-pet/runtime/electron-helper/tray-platform
 */
'use strict';

/**
 * Platform switch of system tray.
 *
 * @param platform - process.platform value.
 * @returns templateImage Whether the icon is processed according to the template image; leftClickPopsMenu Whether the
 * menu needs to be opened manually when left clicking;
 * hideDock Whether to hide the Dock icon (macOS exclusive).
 */
function trayPlatform(platform) {
  const mac = platform === 'darwin';
  return {
    templateImage: mac,
    leftClickPopsMenu: platform === 'win32',
    hideDock: mac,
  };
}

module.exports = { trayPlatform };
