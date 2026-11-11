/**
 * Desktop Helper renderer entry point: configuration loading, error handling, startup assembly and asset injection.
 * Dependency chain (index.html sequential loading): shared-core.js → constants.js → sprite.js → events.js → this file.
 * The only source of configuration is the finished aggregate of host / config (one step fetch → S.flattenConfigPets
 * flattening), failure loudly reports an error and retries every 5 s, no silent fallback. Window = pet bounding box +
 * surrounding expansion margin. Pet movement is reported to the main process frame by frame from this page. Pet
 * behavior and system notifications are not implemented (see sprite.js).
 * @module dsh-pet/runtime/electron-helper/renderer
 */
'use strict';

// Configuration (loud error; failed 5 s retry)
function showError(message) {
  console.error('[dsh-pet] ' + message);
  window.__dshPetDebug.configOk = false;
  errorEl.textContent = 'dsh-pet 配置错误：' + message;
  errorEl.classList.add('visible');
}
function hideError() {
  errorEl.classList.remove('visible');
  errorEl.textContent = '';
}
function scheduleReboot() {
  if (bootTimer) return;
  bootTimer = setTimeout(() => {
    bootTimer = null;
    void boot();
  }, 5000);
}

/**
 * Number of consecutive startup failures (cleared once successful). The first failure is most likely due to a startup
 * race: the main process does not wait for the bridge callback service to be ready before building a window, and the
 * first frame fetch will be empty; 5 s will self-heal after retrying, and the red bar should not flash. Continuous
 * failure is a real configuration error, and it will still be reported loudly.
 */
let bootFailures = 0;

async function loadConfig() {
  // The only configuration entry point: the finished aggregate of host/config (already merged and guaranteed to be absolutely correct), one step pull → flat, zero check zero fallback
  const res = await fetch(BASE + '/config', { cache: 'no-store' });
  if (!res.ok) throw new Error(`config http ${res.status}`);
  const merged = await res.json();
  // Interface unified 200 + entity: The status code is still 200 when it fails, it depends on the ok in the body.
  if (merged && merged.ok === false) throw new Error('config ' + String(merged.reason ?? 'failed'));
  return {
    pets: S.flattenConfigPets(merged),
    // Drag and throw physical parameters (top-level global, shared by all pets; the merger has filled in the built-in default)
    physics: (merged && merged.main && merged.main.physics) || S.DEFAULT_PHYSICS,
    // Throwing is locked on the current screen (root field; combiner filled built-in default false)
    confineToScreen: (merged && merged.main && merged.main.confineToScreen) === true,
    // Click the sound effect switch (global copy, read-only main entry; the merger has filled in the built-in default false = mute)
    clickSoundEnabled: (merged && merged.main && merged.main.clickSoundEnabled) === true,
    // Font (a global copy, the merger has filled in the built-in default): the font family injects global variables here, and the font size is calculated by each pet according to its own size.
    font: (merged && merged.main && merged.main.font) || S.DEFAULT_FONT,
    // Voice: voice and volume (by default, the shared layer processes it according to the default voice/maximum volume)
    voiceName: (merged && merged.main && merged.main.voiceName) || '',
    // The volume is only used at the playback entry point. By default, the shared layer handles it according to the maximum volume. This is not covered here 1
    voiceVolume: merged && merged.main ? merged.main.voiceVolume : undefined,
  };
}

// Startup (sprite will be built only after the configuration verification is passed; if it fails, a loud error message + 5 s will be automatically retried)
async function boot() {
  try {
    const cfg = await loadConfig();
    config = cfg;
    // Voice: This window is fixed to the desktop; the tone, master switch and volume are directly configured from the
    // resolved value, without lazy loading - you have to wait for the first playback before pulling / config. If you
    // encounter bridge in the starting competition state, you will never be able to read the switch (only try once if
    // the reading fails).
    S.setVoiceBase(BASE);
    S.setSurface('desktop');
    S.setVoiceConfig(cfg.voiceName, cfg.voiceVolume);
    bootFailures = 0;
    hideError();
    // Font family changed to documentElement: the dialog window/score pop-up window is hung under body, cannot be
    // inherited from the pet root container, and can only use global variables. You must wait for / config to be
    // pulled back before setting it (the font family comes from the configuration).
    document.documentElement.style.setProperty('--dsh-pet-font-family', S.fontStackOf(cfg.font.family));
    const pets = cfg.pets.filter((p) => S.isDesktopVisible(p.display));
    if (pets.length === 0) {
      // The fact that all pets are only displayed on the web page is in a valid state and is not a configuration
      // error: there are no desktop pets, which means that there is no work to do in this window. It will be closed
      // quietly, no pop-up bars will be displayed, and no retry will be performed. Whether the system tray is still
      // looking at trayEnabled for the main entry is irrelevant here. The host flow is reconstructed by syncDesktop()
      // Helper when the configuration changes; the manual flow needs to restart itself.
      hideError();
      console.info('[dsh-pet] no desktop pets; closing this helper window (tray kept only if trayEnabled)');
      window.close();
      return;
    }
    // This window only carries one pet: petIndex is injected by the main process in the order of DSH_PET_PETS
    const pet = pets[CONFIG.petIndex];
    if (!pet) {
      showError('petIndex=' + CONFIG.petIndex + ' 超出桌面宠物列表（共 ' + pets.length + ' 只），本窗口不创建宠物');
      scheduleReboot();
      return;
    }
    for (const s of sprites) s.dispose();
    sprites = [new PetSprite(pet)];
    window.__dshPetDebug.configOk = true;
    window.__dshPetDebug.spriteCount = sprites.length;
    for (const s of sprites) s.playIdle();
    startLoops();
  } catch (e) {
    const msg = '配置加载失败：' + (e && e.message ? String(e.message) : String(e));
    // After the first failure, it will be silent (mostly due to a startup race condition, see the description of bootFailures), and it will be reported only after the next 5 s retries still fail.
    bootFailures += 1;
    if (bootFailures > 1) showError(msg);
    else console.error('[dsh-pet] ' + msg + ' (first boot, retrying)');
    scheduleReboot();
  }
}

// Inject typing resources: bubble font + click/drag cursor icon (the same set of assets as the browser, provided by host / dsh-pet-7340 /)
function injectAssets() {
  const style = document.createElement('style');
  style.textContent =
    '@font-face{font-family:"ShangshouSoftCandy";src:url("' +
    BASE +
    '/font/' +
    encodeURIComponent('上首软糖体') +
    '.ttf") format("truetype");font-display:swap;font-weight:400}' +
    '.pet-hit{cursor:url("' +
    BASE +
    '/pic/cursor-grab.png") 16 16, grab}' +
    '.pet-hit.dragging{cursor:url("' +
    BASE +
    '/pic/cursor-grabbing.png") 16 16, grabbing}';
  document.head.appendChild(style);
  // Unify the right-click menu style (inject the same MENU_CSS as the browser)
  const menuStyle = document.createElement('style');
  menuStyle.textContent = S.MENU_CSS;
  document.head.appendChild(menuStyle);
  // Floating prompt style (the same TOOLTIP_CSS is injected into the browser, replacing the native title prompt on the hit layer)
  const tipStyle = document.createElement('style');
  tipStyle.textContent = S.TOOLTIP_CSS;
  document.head.appendChild(tipStyle);
}

// Changes in display geometry (resolution/scaling, screen insertion and removal, rotation): The main process is recalculated and the renderer re-hangs the viewport and boundaries in place.
if (window.petBridge && window.petBridge.onDisplays) {
  window.petBridge.onDisplays((geo) => {
    // The viewport origin before change must be taken before applyDeskGeometry: relayout relies on it to restore the
    // old viewport relative coordinates to world coordinates. Otherwise, as soon as the viewport origin is translated
    // when closing/opening the cover, the pet will be mistakenly judged to be out of bounds.
    const prevView = { x: VIEW.x, y: VIEW.y, w: VIEW.w, h: VIEW.h };
    if (!applyDeskGeometry(geo)) return;
    for (const s of sprites) s.relayout(prevView);
  });
}

// When the size of the window content area is abnormal, it is reorganized according to the current position. Guard:
// Never reset position while dragging/flying/roaming - in these three states the position is driven by input or
// physics, and position() will pull the pet back to customPos. When crossing screens, Windows will actively change
// the window size due to WM_DPICHANGED. If you are not careful, you will see the pet jump back to the previous landing
// point.
window.addEventListener('resize', () => {
  for (const s of sprites) {
    if (s.dragState.active || s.throwRef !== null || s.moveRef !== null) continue;
    s.position();
  }
});

injectAssets();
void boot();
