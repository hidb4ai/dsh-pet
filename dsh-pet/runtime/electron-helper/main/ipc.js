'use strict';
const { BrowserWindow, desktopCapturer, screen } = require('electron');
const { decideWindowIgnore } = require('../pointer-target.js');
/**
 * ipc from renderer to main process: window following, flight state, collision forwarding, click-through flip, input
 * lease and menu first item (open software/open AI settings).
 *
 * The only window status entry point is the method exported by the windows module and state; this module does not
 * store any status by itself.
 * @module dsh-pet/runtime/electron-helper/main/ipc
 */

/**
 * register all ipc processors.
 *
 * @param deps.ipcMain - Electron ipcMain.
 * @param deps.petWindows - Window capabilities (state with methods).
 * @param deps.shell - Electron shell (open site).
 * @param deps.openTarget - The destination of the first menu item: desktop launches the desktop application; the other
 * forms are left to the default browser to open the authenticated address.
 * @param deps.petRoute - pet route prefix.
 */
function registerIpc({ ipcMain, petWindows, shell, openTarget, petRoute }) {
  // Pet window following: renderer reports the position/size of the window content area frame by frame
  ipcMain.on('pet:set-bounds', (event, bounds) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return;
    const x = Number(bounds?.x);
    const y = Number(bounds?.y);
    const width = Number(bounds?.width);
    const height = Number(bounds?.height);
    if (![x, y, width, height].every(Number.isFinite)) return;
    // deduplicate must compare the value of our last request. It must not be compared with the readback value of
    // win.getContentBounds(): DIP ↔ across the zoom screen. The physical round trip has outward rounding and origin
    // rounding. The readback value will never be equal to the set value, and deduplicate will never take effect.
    const rect = { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
    const key = rect.x + ',' + rect.y + ',' + rect.width + ',' + rect.height;
    if (petWindows.state.lastRequestedBounds.get(win.id) !== key) {
      petWindows.state.lastRequestedBounds.set(win.id, key);
      win.setContentBounds(rect, false);
    }
    // The distance from the origin of the window to the origin of the body (left/top): the basis for determining the
    // hit zone. It is no longer equal to the margin - the window is clamped back by the system. After the work area,
    // the offset of the body within the window becomes larger, and only "window width - body width - left offset" is
    // left on the right side. Calculate and write down them together.
    const ml = Number(bounds?.marginL);
    const mt = Number(bounds?.marginT);
    const bodyWidth = Number(bounds?.size);
    if (Number.isFinite(ml) && Number.isFinite(mt) && Number.isFinite(bodyWidth)) {
      petWindows.state.winMargins.set(win.id, { l: ml, t: mt, r: rect.width - ml - bodyWidth });
    }
    // The position of the collision station must be the upper left corner of the bounding box (the renderer explicitly
    // reports boxX/boxY): window coordinates = bounding box − margin. Taking the window coordinates directly will
    // cause the overall misalignment of cross-window detection.
    const petId = [...petWindows.state.windows.keys()].find((id) => petWindows.state.windows.get(id) === win);
    if (petId) {
      const bx = Number(bounds?.boxX);
      const by = Number(bounds?.boxY);
      const size = Number(bounds?.size);
      const bottomPad = Number(bounds?.bottomPad);
      const vx = Number(bounds?.vx);
      const vy = Number(bounds?.vy);
      // Position + size + speed are registered together: set-bounds will be triggered every time the position changes.
      // Only a stationary pet with size can be seen by cross-window collision detection; the speed is the value
      // reported by the renderer (real-time, stationary/drag = 0 during flight), and the old speed will not be
      // retained after landing.
      petWindows.updatePetState(petId, {
        x: Number.isFinite(bx) ? bx : x,
        y: Number.isFinite(by) ? by : y,
        size: Number.isFinite(size) && size > 0 ? size : petWindows.state.petStates.get(petId)?.size || 0,
        bottomPad:
          Number.isFinite(bottomPad) && bottomPad > 0
            ? bottomPad
            : petWindows.state.petStates.get(petId)?.bottomPad || 0,
        vx: Number.isFinite(vx) ? vx : 0,
        vy: Number.isFinite(vy) ? vy : 0,
      });
    }
  });

  // Forwarding of collision results: The flying side window detects a collision with targetId → forwards the momentum result (target new initial velocity) to the target window
  ipcMain.on('pet:collide-result', (event, payload) => {
    const targetId = payload && typeof payload === 'object' ? String(payload.targetId || '') : '';
    const vx = Number(payload?.vx);
    const vy = Number(payload?.vy);
    if (!targetId || !Number.isFinite(vx) || !Number.isFinite(vy)) return;
    const targetWin = petWindows.state.windows.get(targetId);
    if (targetWin && !targetWin.isDestroyed()) {
      targetWin.webContents.send('pet:hit', { vx, vy });
    }
  });

  // Click-through flip: The renderer reports when the cursor enters and exits the body hit area; forward is retained
  // during click-through. Fallback polling also takes the same exit setWindowIgnore, and the two channels share the
  // same mirror state.
  ipcMain.on('pet:set-interactive', (event, interactive) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return;
    const input = petWindows.state.inputRegions.get(win.id);
    // The old menuOpen/chatOpen guard of the renderer will request that the entire window be interactive; here the decision is based on the real cursor and control rectangle.
    const ignoring =
      interactive && input && petWindows.state.inputBusy.get(win.id)
        ? decideWindowIgnore(
            win.getContentBounds(),
            screen.getCursorScreenPoint(),
            false,
            true,
            0,
            input,
            petWindows.state.winMargins.get(win.id),
          )
        : !interactive;
    petWindows.setWindowIgnore(win, ignoring);
  });

  // Drag and drop holds full input lease; menus/dialogs are restricted to the actual control rectangle by
  // petWindows.state.inputRegions. Only marks are stored here, and windows are not opened directly - the only exit is
  // still setWindowIgnore, otherwise the two channels will rush to open the same window.
  ipcMain.on('pet:input-busy', (event, busy) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return;
    petWindows.state.inputBusy.set(win.id, !!busy);
  });

  ipcMain.on('pet:input-regions', (event, input) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed() || !input || !Array.isArray(input.rects)) return;
    const rects = input.rects.filter(
      (r) => r && [r.x, r.y, r.width, r.height].every(Number.isFinite) && r.width > 0 && r.height > 0,
    );
    petWindows.state.inputRegions.set(win.id, { dragging: input.dragging === true, rects });
  });

  // The text input box getting the DOM focus is not equal to the window getting the keyboard focus: the window is
  // displayed by showInactive and never actively requests the focus, so the cursor is flashing but the keys fall to
  // the previous window (Linux/X11 must appear). Make an activation request here; skip it when it is focused or
  // destroyed to avoid taking the focus from other applications.
  ipcMain.on('pet:request-keyboard-focus', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed() || win.isFocused()) return;
    win.focus();
    win.webContents.focus();
  });

  // The first item in the right-click menu (Open software / Open AI settings / Open website): Leave it to the system
  // default browser (equivalent to Ctrl + click link in the web page), and do not create a dedicated window - the pet
  // window is a small transparent window and should not host regular web browsing. URL is derived by the renderer from
  // configUrl.
  const openSite = (url) => {
    // The authenticated site URL injected by the host (including the startup token of this process): DSH is only
    // accepted in GET /and the browser is changed to Cookie. The naked origin must be 401 in the default browser. The
    // token-equivalent login state is only enabled when it is the same as the target origin and will never be taken to
    // other sites; when the variable cannot be obtained, the behavior is the same as before.
    let target = url;
    const authed = process.env.DSH_PET_SITE_URL || '';
    if (/^https?:[/][/]/.test(authed)) {
      try {
        if (new URL(authed).origin === new URL(url).origin) target = authed;
      } catch {
        /* Wrong shape: keep naked address (original behavior) */
      }
    }
    shell.openExternal(target).catch((error) => {
      console.error('[dsh-pet-desktop-helper] openExternal failed:', error);
    });
  };

  // dsh :// protocol applied from register: bring the main window to the foreground when it is running, and directly
  // pull up the application when it is not running. Only the desktop form can be sent - the protocol is a system-level
  // register. If the dsh web form is issued, it will pull up the desktop version DSH.
  const focusDesktopApp = () => shell.openExternal('dsh://open');

  // The destination is determined by the host form: desktop calls the main window back to the front desk, which is
  // cleaner than spawn host exe; site is the original behavior: the system default browser opens the site.
  ipcMain.on('pet:open-site', (event, payload) => {
    const url = payload && typeof payload === 'object' ? String(payload.url || '') : '';
    if (!/^https?:[/][/]/.test(url)) return;
    if (openTarget === 'desktop') {
      // When the protocol is not registered (green version / register table is cleared), the fallback will open the site, at least it will not "no response after clicking"
      focusDesktopApp().catch((error) => {
        console.error('[dsh-pet-desktop-helper] open dsh:// failed, falling back to site:', error);
        openSite(url);
      });
      return;
    }
    openSite(url);
  });

  // Only call the window, do not change the direction: bring the main window to the front when blocked by other windows.
  ipcMain.on('pet:focus-host', () => {
    if (openTarget !== 'desktop') return;
    focusDesktopApp().catch((error) => {
      console.warn('[dsh-pet-desktop-helper] focus host failed:', error && error.message);
    });
  });

  /**
   * Capture a frame of the desktop: only take the screen where the pet is, request a thumbnail based on physical
   * pixels, and return JPEG base64 once. No streaming, no persistence to disk; after the renderer gets it, it goes
   * through the same budget encoding as the uploaded image.
   */
  ipcMain.handle('pet:capture-screen', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const display = win ? screen.getDisplayMatching(win.getBounds()) : screen.getPrimaryDisplay();
    const scale = display.scaleFactor || 1;
    const size = {
      width: Math.max(1, Math.min(4096, Math.round(display.size.width * scale))),
      height: Math.max(1, Math.min(4096, Math.round(display.size.height * scale))),
    };
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size });
    // display_id is a character string; when the corresponding screen cannot be obtained, return to the first block, which is better than "no response after clicking"
    const source = sources.find((item) => String(item.display_id) === String(display.id)) ?? sources[0];
    if (!source || source.thumbnail.isEmpty()) return null;
    const thumbnail = source.thumbnail;
    const { width, height } = thumbnail.getSize();
    const data = thumbnail.toJPEG(85).toString('base64');
    return { mediaType: 'image/jpeg', data, width, height, bytes: Math.floor((data.length * 3) / 4) };
  });
}

module.exports = { registerIpc };
