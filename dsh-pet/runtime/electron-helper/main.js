/**
 * dsh-pet desktop Helper main process: Each desktop pet has a transparent always-on-top small window. The window
 * follows the bounding box reported by the renderer. The process is also responsible for system tray, bridge data
 * forwarding and host survival determination; it is not responsible for rendering and hit determination (renderer.js /
 * sprite.js). The local small window must be maintained: Windows DWM The black screen of the video requires four items
 * to be met at the same time - transparent always-on-top, non-click-through, focusable and focused, and completely
 * covering the video window; this process just meets the first three items, while it is almost impossible for a small
 * window to satisfy the fourth item, and the default is click-through for the entire window. Depends on the
 * environment variables injected by host and the pure judgment module in the same directory.
 * @module dsh-pet/runtime/electron-helper/main
 */
let electronApi;
// When being pulled up in "pure Node mode" (host transparent transmission ELECTRON_RUN_AS_NODE), the built-in electron
// module will not register: report a message that can locate the cause before exiting, don't leave just
// MODULE_NOT_FOUND.
try {
  electronApi = require('electron');
} catch (error) {
  process.stderr.write(
    '[dsh-pet helper] 启动失败：本进程被以「纯 Node 模式」拉起（ELECTRON_RUN_AS_NODE=' +
      JSON.stringify(process.env.ELECTRON_RUN_AS_NODE ?? null) +
      '）。该变量必须在 spawn 前删除（见 src/host/helper-process.ts 的 helperSpawnEnv），' +
      '运行期再删无效，设成空串会让 Electron 直接 abort。原始错误：' +
      (error instanceof Error ? error.message.split('\n')[0] : String(error)) +
      '\n',
  );
  process.exit(3);
}
const { app, BrowserWindow, ipcMain, screen, shell, protocol, Tray, Menu, nativeImage, powerMonitor } = electronApi;
const path = require('node:path');
const fsPromises = require('node:fs/promises');
// Pure determination of click-through fallback channel (does not rely on forward mouse hook of Electron; see file
// header) Linux exclusive: X11 pointer real-time query. The click-through window does not receive mouse events,
// screen.getCursorScreenPoint() on Chromium will freeze at the old coordinates on X11, and fallback polling must
// directly ask X for server (see x11-pointer.js).
const { createLinuxPointer } = require('./x11-pointer.js');
// always-on-top watchdog: WS_EX_TOPMOST is just the style bit, which does not mean that the window is really in the always-on-top band (see topmost-watchdog.js header)
const {
  TOPMOST_WATCHDOG_TICK_MS,
  TOPMOST_WATCHDOG_ENABLED,
  shouldReassertTopmost,
  topmostLevel,
} = require('./topmost-watchdog.js');
// Taskbar watchdog: skipTaskbar on Windows is just a one-time DeleteTab, shell button reappears after rebuilding the taskbar (see taskbar-watchdog.js)
const { taskbarWatchdogEnabledFromEnv } = require('./taskbar-watchdog.js');
// Host survival determination: host exits → pipe is disconnected → exits by itself, never pops up, never leaves zombies
const { HOST_POLL_MS, hostIsGone, isBrokenPipeError, parseHostPid } = require('./host-liveness.js');
// Pure judgment and conversion of global DPI linearization (see the file header for platform exceptions) Platform
// differences of system tray (template diagram / whether the left button automatically pops up the menu / Dock): The
// rules live in the module, main.js only wires
const { trayPlatform } = require('./tray-platform.js');
const { buildDeskGeometry } = require('./desktop-geometry.js');
const { runSmokeCheck } = require('./main/smoke.js');
const { createDpi } = require('./main/dpi.js');
const { createBridge } = require('./main/bridge.js');
const { createTray } = require('./main/tray.js');
const { createWindows } = require('./main/windows.js');
const { registerIpc } = require('./main/ipc.js');
const { createDisplaySync } = require('./main/displays.js');
const { dshHomeDir, resolveUserDataDir } = require('./main/user-data.js');

/** Linux pointer provider: only created in Linux; when query fails, get() returns null (caller falls back to Electron native API) */
const linuxPointer = process.platform === 'linux' ? createLinuxPointer() : null;

// Allow direct playback without user gestures (balance animation, etc.)
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// Explicit naming: Helper cannot get the app name when it is directly pulled up by `electron.exe <main.js>` , and will
// fallback to "Electron". userData will fall into the public directory % APPDATA %\ Electron. DPI cache and Chromium
// profile Will mix with others. It must be set before any getPath (' userData '); the name must be word-for-word
// consistent with src/host/storage-paths.ts's DESKTOP_APP_NAME (test the direct reading file comparison, red if the
// name is not synchronized). Application mode (this file is the same process as src/app/main.ts require): the user who
// double-clicks to start does not have a terminal, and the system tray must have "Exit"; the same applies to the
// manual start-desktop stream. In BRIDGE mode, the host decides whether to exit (see quitApp of startTray).
const APP_MODE = process.env.DSH_PET_APP_MODE === '1';
// It is only used by the application's own requests in the same process and will never appear in the renderer address or log.
const APP_TOKEN = APP_MODE ? process.env.DSH_PET_APP_TOKEN : undefined;
app.setName('dsh-pet-electron-helper');
// Windows taskbar grouping: When AppUserModelID is not set, the window is assigned to the name electron.exe, and the
// taskbar button appears unexpectedly and displays the Electron default icon. Must be called before ready; use
// different ID in independent applications and helper in DSH to avoid being synthesized into one group.
if (process.platform === 'win32') {
  app.setAppUserModelId(APP_MODE ? 'com.dsh.pet.app' : 'com.dsh.pet.helper');
}
// In application mode, only the data directory is changed, but the application name is not changed: When the same userData is shared, two Chromium processes will grab the same profile and kick each other.
if (APP_MODE) app.setPath('userData', path.join(app.getPath('appData'), 'dsh-pet'));

/** DPI detects sub-process mode: no window is created, just hit the main screen scaleFactor to stdout and exit (see probePrimaryScale) */
const DPI_PROBE = process.env.DSH_PET_DPI_PROBE === '1';
/** The output tag of the detection process (the parent process grabs the value according to it) */
const DPI_MARK = 'dsh-pet-primary-scale:';
// Host survival: After the host exits, the read end of stdout/stderr disappears. The next time helper writes (at least
// one per second / state polling), it gets EPIPE; the unhandled stream error will become an uncaught exception, and
// the default processor of Electron only pops up the box and does not exit - the desktop pet is stuck, and the process
// is stuck. Two paths are indispensable: ① Pipe guard, any write failure is not allowed to become an exception,
// disconnect and exit (only triggered when the upper layer is actually writing); ② Host detection, ask kill ( pid , 0)
// every HOST_POLL_MS, ESRCH will exit (when the renderer crashes or does not get up at all, a write will not happen,
// only it can converge). Both roads only pass through exitForDeadHost() and only go back once.
let hostGone = false;
/** The host is gone → Exit immediately. No more logging is allowed here: the pipe is broken, and writing will only cause the same error again. */
function exitForDeadHost() {
  if (hostGone) return;
  hostGone = true;
  app.exit(0); // The host disappears because "the environment requires me to exit", not because it crashes, and the exit code is 0
}

// ① The pipe guard must be installed before any write (if probePrimaryScale fails, it will write to stderr)
for (const stream of [process.stdout, process.stderr]) {
  stream.on('error', (error) => {
    if (isBrokenPipeError(error)) exitForDeadHost();
    // Other stream errors are also swallowed: The default processing of Electron is to pop up the modal box, and it is not worth using the desktop pet to change the box.
  });
}

// The original userData may not be writable under restricted tokens: profile initialization of Chromium will get
// stuck, whenReady never resolve, the host only sees 0xC0000005 once after about 6 seconds, without any readable
// errors. The detection is placed after the pipe guard to ensure that the log writing here will not step on the EPIPE
// when the host is dead.
const userDataDecision = resolveUserDataDir({
  currentDir: app.getPath('userData'),
  dshHome: dshHomeDir(),
  appMode: APP_MODE,
});
if (userDataDecision.fallback) {
  app.setPath('userData', userDataDecision.dir);
  console.error('[dsh-pet-desktop-helper] userData is not writable; falling back to', userDataDecision.dir);
} else if (userDataDecision.error) {
  console.error(
    '[dsh-pet-desktop-helper] userData fallback failed:',
    String(userDataDecision.error.message || userDataDecision.error),
  );
}

// ② Host detection: DSH_PET_HOST_PID is injected by host spawn; not injected or invalid → 0 → no detection (no false
// exit). The DPI detection instance is a one-time short-lived process (the parent process is helper instead of host)
// and does not participate in this mechanism.
const HOST_PID = parseHostPid(process.env.DSH_PET_HOST_PID);
if (!DPI_PROBE && HOST_PID > 0) {
  setInterval(() => {
    if (hostIsGone(HOST_PID)) exitForDeadHost();
  }, HOST_POLL_MS).unref?.();
}

// The Windows transparent layered window (WS_EX_LAYERED) has defects under the DWM hardware accelerated synthesis:
// black borders appear around the window when dragged and moved, and the content of the latter is lost when the large
// transparent window is moved to cover the small transparent window. This process only renders lightweight pet
// animations (640×360), and uses software synthesis instead; the non-Windows synthesis path is different, and hardware
// acceleration is retained.
if (process.platform === 'win32') {
  app.disableHardwareAcceleration();
  // It only turns off the hardware GL and does not remove the GPU process of Chromium: When a virtual monitor (ToDesk
  // / remote desktop IDD, etc.) is installed, the GPU process sandbox will repeatedly crash with STATUS_BREAKPOINT
  // during the initialization phase, and the browser process will then exit with 0x80000003. helper will crash every
  // time and the host only sees a line of exit code with no information. Turn off the GPU sandbox to restore (single
  // test:
  // --disable-gpu and --use-angle are invalid, --disable-gpu-sandbox is valid). This process only renders local
  // assets and does not load untrusted content; the sandbox environment setting DSH_PET_GPU_SANDBOX =1 needs to be
  // retained.
  if (process.env.DSH_PET_GPU_SANDBOX !== '1') {
    app.commandLine.appendSwitch('disable-gpu-sandbox');
  }
}

// Global DPI linearization: All monitors are forced to the same scale factor - screen-by-screen affine transformation
// will flip repeatedly when dragged across screen gaps ("split flicker"). The value must be locked to 1, and the main
// screen scaleFactor cannot be used (the measured forced =1.5 will make bounds and workArea contradictory); the price
// is that the size unit becomes a physical pixel, which is offset by multiplying the detected scaleFactor into
// CONFIG.scale. If the detection fails, it will not be enabled. See dpi-linearization.js for platform rules. This
// document only connects the wiring.

/** DPI/Pointer capabilities: zoom detection, forced zoom switch, petScale and cursor position. */
const dpi = createDpi({
  app,
  screen,
  mainPath: __filename,
  linuxPointer,
  dpiProbe: DPI_PROBE,
  dpiMark: DPI_MARK,
  forceDsf: process.env.DSH_PET_FORCE_DSF,
});

/** bridge mode: DSH_PET_BRIDGE =1 (host injection). When enabled, register dsh-pet-bridge scheme + pipe forwarding */
const BRIDGE = process.env.DSH_PET_BRIDGE === '1';

/**
 * The destination of the first menu item (host is injected according to its own form): ' desktop ' = DSH desktop
 * application → evoke the application main window; ' standalone ' = standalone mode → open the local AI settings
 * page; ' web ' = dsh web / handwritten start-desktop (No such variable) → The default browser to open the site.
 */
const OPEN_TARGET_RAW = process.env.DSH_PET_OPEN_TARGET;
const OPEN_TARGET = OPEN_TARGET_RAW === 'desktop' || OPEN_TARGET_RAW === 'standalone' ? OPEN_TARGET_RAW : 'web';
/** Protocol line prefix (consistent with BRIDGE_PREFIX of helper-process.ts) */
const BRIDGE_PREFIX = 'dsh-pet-bridge:';

if (BRIDGE) {
  // Customize scheme: standard (can parse URL) + secure (treat as https) + supportFetchAPI (fetch is available) +
  // stream (video stream) + corsEnabled (let the CORS rule take effect, in accordance with the response) ACAO head
  // release file:// source page)
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'dsh-pet-bridge',
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        bypassCSP: true,
        corsEnabled: true,
      },
    },
  ]);
}

// bridge protocol: Each fetch of the renderer falls to dsh-pet-bridge://, protocol.handle writes the request to stdout
// with a line of JSON and forwards it to the host. The host response does not go to pipe No. 0 (Electron main process
// cannot receive piped stdin on Windows), so this process opens a 127.0.0.1 random port HTTP callback, and presses id
// to wake up the waiting request; the asset only returns the absolute path, and the process reads the disk response by
// itself (binary but not the pipe). The protocol line has a unified prefix of BRIDGE_PREFIX, and the host uses this to
// distinguish protocols and logs.

// System system tray: display switch on the desktop. The system tray is placed in this process because it is the only
// entry point in desktop mode that does not enter the browser: after a certain pet's display is changed to web/none,
// the desktop window disappears together with its own right-click menu. Only the system tray can switch it back on the
// desktop side. It is not necessary: when the trayEnabled of the main entry is false, no system tray is created, and
// the host is no longer resident for this process. There is no new channel for data: both reading and writing go
// through the same channel bridge used by renderer. The menu is static - every time you switch the display host, the
// process (syncDesktop) will be restarted. The new process will rebuild the menu according to the new configuration,
// so there is no need to "rebuild the menu refresh check" logic.

const PET_ROUTE = '/dsh-pet-7340';
const ORIGIN = new URL(process.env.DSH_PET_CONFIG_URL || 'http://127.0.0.1:3080/dsh-pet-7340/config').origin;
const TRAY_PLATFORM = trayPlatform(process.platform);

/** Channel with host: bridge uses pipeline + local callback, otherwise HTTP is directly connected. */
const bridge = createBridge({ isBridge: BRIDGE, prefix: BRIDGE_PREFIX, origin: ORIGIN, token: APP_TOKEN });

/** Window capabilities: window creation, whole window click-through mirroring, pet status broadcast, two real-time pumps. */
const petWindows = createWindows({
  BrowserWindow,
  screen,
  buildDeskGeometry,
  dpi,
  helperDir: __dirname,
  isBridge: BRIDGE,
  openTarget: OPEN_TARGET,
  platform: TRAY_PLATFORM,
  shouldReassertTopmost,
  topmostLevel,
  taskbarWatchdogEnabled: taskbarWatchdogEnabledFromEnv(process.env.DSH_PET_TASKBAR_WATCHDOG),
});
/** system tray: display switch and exit entry point. */
const tray = createTray({
  app,
  Tray,
  Menu,
  nativeImage,
  hostRequest: bridge.hostRequest,
  callbackUrl: bridge.callbackUrl,
  isBridge: BRIDGE,
  appMode: APP_MODE,
  petRoute: PET_ROUTE,
  platform: TRAY_PLATFORM,
  helperDir: __dirname,
});

/**
 * Application mode reconstruction hook: There is no "Restart helper process" path in the same process. After changing
 * the display position of the host, it will be adjusted - close the window → Rebuild according to the new DSH_PET_PETS
 * → Refresh the system tray check box. The dual-process mode does not register: restarting the process itself is
 * rebuilding, and registering it will create an extra path that no one will take.
 */
if (process.env.DSH_PET_IN_PROCESS === '1') {
  globalThis.__dshPetRebuildUi = async () => {
    petWindows.closeAll();
    petWindows.create();
    await tray.refresh();
  };
}

app.whenReady().then(() => {
  // Detecting child processes: There is no force-device-scale-factor at this time, and what is read is the real main
  // screen zoom of Windows. Exit is delayed for a beat - directly app.exit() in ready callback will tear down the
  // process before stdout persist to disk
  if (DPI_PROBE) {
    process.stdout.write(DPI_MARK + screen.getPrimaryDisplay().scaleFactor + '\n');
    setTimeout(() => app.exit(0), 0);
    return;
  }
  console.error(
    '[dsh-pet-desktop-helper] displays: ' +
      JSON.stringify(petWindows.geometry()) +
      ' forcedScaleFactor=' +
      (dpi.forcedScale || 'off') +
      ' primaryScale=' +
      (dpi.primaryScale || 'unknown') +
      ' petScale=' +
      dpi.petScale(),
  );

  if (BRIDGE) {
    // Customize scheme to receive all renderer requests (configuration/balance/whisper/broadcast/asset)
    protocol.handle('dsh-pet-bridge', (request) =>
      bridge.handle(request).catch((e) => {
        console.error('[dsh-pet-desktop-helper] bridge handler error:', String(e && e.message ? e.message : e));
        return new Response('dsh-pet: bridge error', {
          status: 502,
          headers: { 'access-control-allow-origin': '*' },
        });
      }),
    );
    bridge.startCallback(); // host responds to callback server (stdin is not available in Electron main process, change to local HTTP)
  }

  // macOS: Desktop pets should not occupy Dock. Not linked to trayEnabled - the right-click menu of the pet body is still there, and it can still be operated on the desktop side.
  if (TRAY_PLATFORM.hideDock && app.dock) app.dock.hide();

  // system tray: Not await (window creation and system tray creation are independent of each other), internally waiting for the bridge callback service to be ready
  void tray.start();

  linuxPointer?.start();
  petWindows.create();

  // Closing/waking up is the most intensive moment for taskbar button reconstruction: resume / unlock-screen and then
  // pick each pet again. powerMonitor can only be used after ready, so hang it here instead of at the top level of the
  // module.
  const reassertTaskbar = () => {
    for (const win of petWindows.state.windows.values()) petWindows.keepOffTaskbar(win);
  };
  powerMonitor.on('resume', reassertTaskbar);
  powerMonitor.on('unlock-screen', reassertTaskbar);

  registerIpc({ ipcMain, petWindows, shell, openTarget: OPEN_TARGET, petRoute: PET_ROUTE });
  createDisplaySync({ screen, petWindows, dpi });

  // Smoke self-test (off by default): DSH_PET_SMOKE =1 takes a delayed screenshot to DSH_PET_SMOKE_OUT and then exits,
  // used to verify the window/rendering/animation link.
  if (process.env.DSH_PET_SMOKE === '1') {
    runSmokeCheck({
      app,
      windows: petWindows.state.windows,
      windowIgnore: petWindows.state.windowIgnore,
      setPointerFallbackPaused: petWindows.setPointerFallbackPaused,
    });
  }
});

// Destroy the system tray icon when exiting: If not destroyed, a "ghost icon" will be left in the Windows notification
// area (it will disappear after the mouse is moved over it). When the host is changed to display, SIGTERM/SIGKILL is a
// hard kill, but Windows cannot be blocked, so this only covers graceful exit.
app.on('before-quit', () => {
  petWindows.stopTaskbarWatchdog();
  if (!tray.exists()) return;
  try {
    tray.destroy();
  } catch (e) {
    console.error('[dsh-pet-desktop-helper] tray destroy failed:', String(e && e.message ? e.message : e));
  }
});

app.on('window-all-closed', () => {
  // Permanent system tray: Keep it even if there are no pets on the desktop, otherwise you will never be able to switch it back by "turning it off completely"
  if (tray.exists()) return;
  // Application mode: The window is closed by the rebuild hook, not the user wants to exit - the process is left to wait for the next rebuild
  if (process.env.DSH_PET_IN_PROCESS === '1') return;
  app.quit();
});
