'use strict';
/**
 * System system tray: desktop mode display switch and "exit" entry point.
 *
 * The system tray is the only entry point in desktop mode that does not enter the browser - after a certain pet is
 * changed to web/none, the window and the right-click menu disappear together, and only the system tray can switch it
 * back. The menu is static: after switching to display, the host will restart the process, and the new process will be
 * rebuilt according to the new configuration.
 * @module dsh-pet/runtime/electron-helper/main/tray
 */

const path = require('node:path');

/**
 * Create system tray capability.
 *
 * @param deps.app - Electron app (exit).
 * @param deps.Tray - Electron Tray constructor.
 * @param deps.Menu - Electron Menu (Template → Menu).
 * @param deps.nativeImage - Electron nativeImage (icons).
 * @param deps.hostRequest - communicate with host (read configuration, change display, request to exit).
 * @param deps.callbackUrl - bridge callback address (you must wait until it is ready before building the system tray).
 * @param deps.isBridge - Whether to be pulled up by the host in bridge mode.
 * @param deps.appMode - Whether it is the same as the process application mode.
 * @param deps.petRoute - pet route prefix.
 * @param deps.platform - system tray platform difference (determination result of tray-platform.js).
 * @param deps.helperDir - Absolute directory for runtime/electron-helper (the icon is under assets / in the package).
 */
function createTray({
  app,
  Tray,
  Menu,
  nativeImage,
  hostRequest,
  callbackUrl,
  isBridge,
  appMode,
  petRoute,
  platform,
  helperDir,
}) {
  const isDesktopDisplay = (display) => display === 'desktop' || display === 'both';

  /** Flip the "desktop bit": both ↔ web , desktop ↔ none - the browser bit remains unchanged, so no new one-way door is created */
  const toggleDisplay = (display) =>
    display === 'both' ? 'web' : display === 'web' ? 'both' : display === 'desktop' ? 'none' : 'desktop';

  let tray = null;

  /** Write back display of a certain pet: The host will restart the process after writing the configuration, and the response may never be returned (same as sprite.js's setPetDisplay) */
  function traySetPetDisplay(id, display) {
    hostRequest('POST', petRoute + '/pet-display', JSON.stringify({ id, display })).catch((e) => {
      console.error('[dsh-pet-desktop-helper] tray pet-display failed:', String(e && e.message ? e.message : e));
    });
  }

  /** system tray icon: logo in the package is reduced to 16×16 (macOS requires a template image, otherwise it cannot be seen under the dark menu bar) */
  function trayIcon() {
    const file = path.join(helperDir, '..', '..', 'assets', 'logo.png');
    let img = nativeImage.createFromPath(file);
    if (img.isEmpty()) {
      // The icon cannot be read = the system tray is not visible but the menu logic still runs. The most difficult method to check: a log that can be located must be left.
      console.error('[dsh-pet-desktop-helper] tray icon missing or unreadable: ' + file);
      return img;
    }
    img = img.resize({ width: 16, height: 16 });
    if (platform.templateImage) img.setTemplateImage(true);
    return img;
  }

  /**
   * Should system tray "Exit" appear?
   *
   * Independent applications and manual start-desktop streams can app.quit() by themselves; under isBridge, the
   * process is started by the host. If it exits by itself, it will be regarded as a crash and press retreat to
   * restart. The host must be asked first (canQuit of GET /quit).
   * @returns can exit by itself as true; detection failure is handled as not supported, so the menu item does not
   * appear.
   */
  async function canQuitSelf() {
    if (appMode || !isBridge) return true;
    try {
      return JSON.parse((await hostRequest('GET', petRoute + '/quit')).body || '{}').canQuit === true;
    } catch (e) {
      console.error('[dsh-pet-desktop-helper] quit capability probe failed:', String(e && e.message ? e.message : e));
      return false;
    }
  }

  /**
   * The system tray menu is assembled according to the current configuration; returning null means there should be no
   * system tray at this time (the switch is turned off/there are no pets in the configuration).
   *
   * It is made into an independent function for the purpose of rebuilding the application mode: changing display there
   * will only rebuild the window without restarting the process. The check status must be refreshed by re-reading
   * here, otherwise the menu and configuration will not match.
   */
  async function buildMenu() {
    const resp = await hostRequest('GET', petRoute + '/config');
    const merged = JSON.parse(resp.body || '{}');
    // system tray switch (trayEnabled of main entry): Only explicit false will not be built. If it is missing or
    // written bad, it will be kept built to prevent an old configuration or an incorrect value from silently
    // disappearing the system tray. Taken from the same finished configuration as pets below.
    if (merged && merged.main && merged.main.trayEnabled === false) return null;
    // The shape of the finished aggregate is { <entry>: <entire configuration document> }: the top-level key is not a
    // pet, and the pet is in the pets array of each entry (same contract as the renderer). The system tray only needs
    // id/name/display, so the entry-level fields are not blown.
    const pets = Object.values(merged)
      .flatMap((conf) => (conf && Array.isArray(conf.pets) ? conf.pets : []))
      .map((pet) => ({
        id: String((pet && pet.id) || ''),
        name: String((pet && pet.name) || '').trim(), // host is guaranteed fallback id when name is missing
        display: String((pet && pet.display) || ''),
      }))
      .filter((pet) => pet.id);
    if (!pets.length) return null; // There are no pets in the configuration: no switchable objects, no system tray is created
    const canQuit = await canQuitSelf();
    const quitApp = () => {
      if (!isBridge || appMode) {
        app.quit();
        return;
      }
      // Leave it to the host to stop: it will stop the process first and then exit, so this request does not need to wait for the result.
      hostRequest('POST', petRoute + '/quit').catch((e) => {
        console.error('[dsh-pet-desktop-helper] tray quit failed:', String(e && e.message ? e.message : e));
      });
    };
    return Menu.buildFromTemplate([
      ...pets.map((pet) => ({
        label: pet.name || pet.id,
        type: 'checkbox',
        checked: isDesktopDisplay(pet.display),
        click: () => traySetPetDisplay(pet.id, toggleDisplay(pet.display)),
      })),
      ...(canQuit ? [{ type: 'separator' }, { label: '退出', click: quitApp }] : []),
    ]);
  }

  /**
   * Create system tray: List all pets in the configuration (including display to web/none - their current checkboxes
   * are empty and can be sent back with one click. This is the increment of the system tray relative to the pet
   * right-click menu). Tick = current display contains desktop/both.
   */
  async function startTray() {
    try {
      // The request line must carry callback URL, and the port only has a value in the listen callback of startBridgeCallback (up to 2 s)
      for (let i = 0; isBridge && !callbackUrl() && i < 100; i += 1) {
        await new Promise((r) => setTimeout(r, 20));
      }
      const menu = await buildMenu();
      if (menu === null) return;
      tray = new Tray(trayIcon());
      tray.setToolTip('dsh-pet 桌面宠物');
      tray.setContextMenu(menu);
      // On Windows, setContextMenu only takes over the right button, and the left button does nothing by default (macOS does the opposite: the left button pops up the menu)
      if (platform.leftClickPopsMenu) tray.on('click', () => tray.popUpContextMenu());
    } catch (e) {
      console.error('[dsh-pet-desktop-helper] tray init failed:', String(e && e.message ? e.message : e));
    }
  }

  /** Reread configuration and refresh menu check; do nothing when system tray is not created (called after application mode rebuilds window). */
  async function refreshTray() {
    if (!tray) return;
    try {
      const menu = await buildMenu();
      if (menu !== null) tray.setContextMenu(menu);
    } catch (e) {
      console.error('[dsh-pet-desktop-helper] tray refresh failed:', String(e && e.message ? e.message : e));
    }
  }

  return {
    start: startTray,
    refresh: refreshTray,
    exists: () => tray !== null,
    destroy() {
      if (!tray) return;
      try {
        tray.destroy();
      } catch (e) {
        console.error('[dsh-pet-desktop-helper] tray destroy failed:', String(e && e.message ? e.message : e));
      }
      tray = null;
    },
  };
}

module.exports = { createTray };
