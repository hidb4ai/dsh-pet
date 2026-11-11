/**
 * preload Bridge: Exposes primitives for window control and cross-window collision to the renderer.
 *
 * Only forwarding IPC, no status is held, no judgment is made; flipping and judgment are all in the main process. For
 * contextBridge/ipcRenderer that depends on Electron, the channel name must be word-for-word consistent with the main
 * process.
 *
 * @module dsh-pet/runtime/electron-helper/preload
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('petBridge', {
  // The pet window follows frame by frame: x/y/width/height is the coordinates of the window content area (used for
  // moving the window), boxX/boxY is the coordinates of the workspace in the upper left corner of the pet bounding box
  // - the collision site must use a bounding box, and the window coordinates differ by half the width of the pet.
  // size/bottomPad allows stationary pets to also register into the collision site, vx/vy is the current speed
  // (stationary/drag is 0). marginL/marginT is the distance from the origin of the window to the origin of the body:
  // the four sides are not equal after the top margin is increased according to the maximum height of the bubble. The
  // window will become larger after it is clamped back to the workspace by the system. The main process cannot press
  // "window width/4" to invert the hit area, so it must be reported.
  setBounds(x, y, width, height, boxX, boxY, size, bottomPad, vx, vy, marginL, marginT) {
    ipcRenderer.send('pet:set-bounds', {
      x,
      y,
      width,
      height,
      boxX,
      boxY,
      size,
      bottomPad,
      vx,
      vy,
      marginL,
      marginT,
    });
  },
  // Click-through flip: The window defaults to click-through for the entire window, and the renderer reports when the cursor enters and exits the body hit area.
  setInteractive(interactive) {
    ipcRenderer.send('pet:set-interactive', !!interactive);
  },
  // I am using the mouse input in this window (drag/menu opening/pop-up window opening). The main process cannot tell
  // the difference between the cursor and the window displacement, drag and drop and roaming/throwing, but the
  // renderer knows; during busy, the fallback channel will never turn back to click-through, otherwise the input chain
  // will be broken. Only sent once when the state flips, not frame by frame.
  setInputBusy(busy) {
    ipcRenderer.send('pet:input-busy', !!busy);
  },
  // Control rectangle: The menu/chat box only allows its own area to receive clicks, and the remaining transparent areas continue to click-through.
  setInputRegions(input) {
    ipcRenderer.send('pet:input-regions', input);
  },
  // When the text input gets the DOM focus, it asks the main process for the system keyboard focus: the DOM focus on
  // X11 is not equal to the X keyboard focus, and the window is displayed by showInactive. Otherwise, you will be
  // unable to type (processed in main/ipc.js).
  requestKeyboardFocus() {
    ipcRenderer.send('pet:request-keyboard-focus');
  },
  // Right-click menu "Open website": the destination is determined by the main process according to the host form - the desktop application host calls up the main window, otherwise the system browser is used to open the site.
  openDshSite(url) {
    ipcRenderer.send('pet:open-site', { url });
  },
  // Only bring the DSH main window to the foreground: use the dsh :// protocol that applies the self-register (single
  // instance lock will make it focus), and it is also effective if it is blocked by other windows. The main process is
  // gating according to the host mode: only the desktop application host is actually issued. If it is issued in the
  // web mode, it will pull up the desktop version.
  focusDshHost() {
    ipcRenderer.send('pet:focus-host');
  },
  // Capture a frame of the desktop (the screen where the pet is): read it once, no stream is created, and no saving is
  // done. Return { mediaType , data , width , height , bytes } or null (cannot get the picture).
  captureScreen() {
    return ipcRenderer.invoke('pet:capture-screen');
  },
  // Collision between pets (cross-window broker): The position and speed are carried along with setBounds, and the main process gathers and broadcasts; the hit party receives pet:hit and throws it out at the new initial velocity.
  onFlightStates(cb) {
    ipcRenderer.on('pet:flight-states', (e, states) => cb(states));
  },
  reportCollide(targetId, vx, vy) {
    ipcRenderer.send('pet:collide-result', { targetId, vx, vy });
  },
  onPetHit(cb) {
    ipcRenderer.on('pet:hit', (e, payload) => cb(payload));
  },
  // Monitor hot update: after resolution/scaling changes, screen insertion and removal, and rotation, the main process
  // recalculates and pushes the desktop geometry (screen coordinates), and the renderer rehangs the viewport and
  // boundaries in place.
  onDisplays(cb) {
    ipcRenderer.on('pet:displays', (e, geo) => cb(geo));
  },
});
