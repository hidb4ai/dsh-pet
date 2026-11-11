/**
 * Starting and stopping the Helper process: locating Electron, injecting the environment, backing off retry and fuse.
 *
 * It does not count the pet list (owned by ./pets) and does not determine when to restart (owned by ./sync's caller).
 * Dependent on the two process-level environment facts passed explicitly (see Input Types), the module is read-only:
 * `DSH_PET_IN_PROCESS` and `process.versions.electron` .
 * @module dsh-pet/src/host/plugin/desktop/spawn
 */
import { join } from 'node:path';
import { ROUTE_SEGMENT } from '../../../shared/constants.ts';
import { PACKAGE_ROOT } from '../../paths.ts';
import type { DesktopHelperDeps } from './types.ts';
import type { DesktopPets } from './pets.ts';
import { toBridgeResponse } from './bridge-response.ts';
import {
  HelperProcess,
  defaultElectronExe,
  dshHomeDir,
  ensureElectronDownload,
  hasGraphicalDisplay,
  resolveElectronPath,
} from '../../helper-process.ts';

/** Input of DesktopSpawn. */
export type DesktopSpawnInput = Pick<
  DesktopHelperDeps,
  'ctx' | 'getHandlePetRoute' | 'log' | 'reportDownload' | 'thumbUserRoot'
> &
  Pick<DesktopPets, 'getHasDesktopPet' | 'desktopPetList' | 'getTrayOn'>;

/** Is host the DSH desktop application (Electron host). */
const isDesktopHost = (): boolean => Boolean(process.versions.electron);

/** The destination of the first menu item: desktop launches the desktop application, standalone opens the local AI settings page, web opens the DSH site. */
export type OpenTarget = 'desktop' | 'standalone' | 'web';

/**
 * Determine the destination of the first item in the menu based on the host form and authenticated address.
 *
 * The standalone mode and web host are not in Electron and can only be distinguished by the address shape: the
 * authenticated address of the standalone mode is fixed on the local machine settings page, and the web host points
 * to the site root. Misjudgment will cause the menu copy to mismatch the actual opened target.
 * @param siteUrl - The authenticated address given to the browser (standalone mode includes the path to the local
 * settings page).
 * @param desktopHost - host is the DSH desktop application.
 * @returns is the shape value injected into Helper.
 */
export function resolveOpenTarget(siteUrl: string, desktopHost: boolean): OpenTarget {
  if (desktopHost) return 'desktop';
  return siteUrl.includes('/standalone-ai/') ? 'standalone' : 'web';
}

/**
 * Create a handle to start and stop the Helper process: the host in the process is skipped directly, and the rest
 * downloads Electron on demand and then spawn and backs off to try again.
 */
export function createDesktopSpawn(deps: DesktopSpawnInput) {
  const { ctx, getHandlePetRoute, log, reportDownload, thumbUserRoot, getHasDesktopPet, desktopPetList, getTrayOn } =
    deps;

  let desktopModeEverActive = false;

  let helper: HelperProcess | undefined;

  let startRetryTimer: NodeJS.Timeout | undefined;

  let electronEnsure: Promise<void> | undefined;

  let disposed = false;

  let displayWarned = false;

  let noDesktopSkipped = false;

  let portWaitAttempts = 0;

  const inProcessHost = process.env.DSH_PET_IN_PROCESS === '1';

  const launchHelper = (electronPath: string | undefined): void => {
    if (inProcessHost) return; // Application mode: The window is created by this process and never spawn
    if (helper || disposed) return;
    // When there is no desktop pet: Only if "desktop mode has been enabled and the system tray is still open" is it worthwhile to persist the system tray, otherwise it will not start
    if (!getHasDesktopPet() && !(desktopModeEverActive && getTrayOn())) return;
    const port = typeof ctx.webServer?.port === 'number' ? ctx.webServer.port : 0;
    if (!port || port <= 0) {
      // webServer may not have finished listening (port is briefly 0 when OS allocates a port): delay retry.
      // Diagnostic log (issue #168): This retry was previously completely silent - the desktop pet "didn't even try"
      // and had no clue when the port was chronically unready. Only visibility is added here, and the retry rhythm and
      // number remain unchanged.
      portWaitAttempts += 1;
      if (portWaitAttempts === 1) {
        log.info(
          `[dsh-pet] webServer port not ready (port=${String(port)}); retrying desktop helper launch every 500ms`,
        );
      } else if (portWaitAttempts % 20 === 0) {
        log.warn(
          `[dsh-pet] webServer port still unavailable after ${(portWaitAttempts * 500) / 1000}s` +
            `(port=${String(port)}); desktop helper has not started`,
        );
      }
      if (!startRetryTimer) {
        startRetryTimer = setTimeout(() => {
          startRetryTimer = undefined;
          launchHelper(electronPath);
        }, 500);
        startRetryTimer.unref?.();
      }
      return;
    }
    portWaitAttempts = 0;
    // Use the listening address self-reported by the host, do not hardcode loopback: DSH rejects the wildcard address,
    // host is always a specific network card - only bind LAN IP to 127.0.0.1 and does not listen. Hardcoding will
    // cause the right-click "Open Website" to open a page that cannot be connected. getOrigin() is thrown when the
    // binding address cannot be expressed as URL (IPv6 with zone), and returns loopback at this time: the menu cannot
    // be opened, but it does not drag down Helper to pull up.
    let origin = `http://127.0.0.1:${port}`;
    try {
      origin = ctx.webServer.getOrigin();
    } catch {
      /* See above: Reserved loopback fallback */
    }
    // Right-click "Open Website" to hand over naked origin: DSH only accepts the startup token of this process in
    // `GET /` , and replaces the signature Cookie bound to authority. All other requests are 401, so origin is passed
    // instead of another address. Token-equivalent login state: only passed to the helper memory via the child process
    // environment variable, without persisting to disk or logging.
    const siteUrl = ctx.connection.authenticatedUrl(origin);
    // The desktop renderer also gets the finished configuration from the same handlePetRoute (each pet has a small
    // local window; through the pipeline, HTTP - DSH Desktop 2.0.3+ will block the bare HTTP request of the plugin
    // self-pull process, and the browser access gate will only allow requests with tokens)
    const configUrl = `${origin}${ROUTE_SEGMENT}/config`;
    helper = new HelperProcess(
      {
        electronPath,
        env: {
          DSH_PET_CONFIG_URL: configUrl,
          // Authenticated site URL (including this process startup token): only for the first item of "Open" of helper, it is not allowed to appear in any logs
          DSH_PET_SITE_URL: siteUrl,
          // The host form determines the direction and copy of the first item in the menu (the "open" item with the
          // same name, three forms and three semantics):
          // desktop = DSH desktop application → evoke the application main window ( helper go to dsh :// open )
          // standalone = Standalone mode → Local AI settings page
          // web = dsh web → DSH site
          DSH_PET_OPEN_TARGET: resolveOpenTarget(siteUrl, isDesktopHost()),
          DSH_PET_SCALE: '1',
          // Open the bridge protocol: main.js register dsh-pet-bridge scheme, and transfer the renderer request to the host through the pipeline
          DSH_PET_BRIDGE: '1',
          // Each desktop pet has a small local window: transparent transmission of the pet list ([{ id, size }])
          DSH_PET_PETS: JSON.stringify(desktopPetList()),
        },
        // bridge protocol processor = HTTP route is the same as handlePetRoute (the business logic is unique, and both
        // ends are naturally consistent); the form conversion is in ./bridge-response, and this module only transfers
        // the request.
        bridgeHandler: async (req) => {
          const result = await getHandlePetRoute()(req.url ?? '/', req.method ?? 'GET', req.body);
          return toBridgeResponse(req.id, result);
        },
      },
      log,
    );
    try {
      helper.start();
      desktopModeEverActive = true; // Helper will be retained even if the desktop pet is cleared thereafter: the system tray is permanent and can be switched back at any time
      log.info(`dsh-pet desktop helper started (config: ${configUrl})`);
    } catch (e) {
      log.warn(`dsh-pet desktop helper start failed: ${e instanceof Error ? e.message : String(e)}`);
      helper = undefined;
    }
  };

  const startHelper = (): void => {
    if (inProcessHost) return; // Application mode: no detection, no download Electron
    if (helper || electronEnsure || disposed) return;
    if (!getHasDesktopPet() && !(desktopModeEverActive && getTrayOn())) {
      // Diagnostic log (issue #168): This short-circuit does not log, which is the direct cause of "desktop mode
      // disappearing out of thin air: no process, no directory, no prompt". Use info instead of warn - this is normal
      // for pure web users; only type once to avoid screen swiping. It will also hit here after the system tray is
      // closed: no one needs that icon, and there is no point in leaving it empty.
      if (!noDesktopSkipped) {
        noDesktopSkipped = true;
        log.info(
          `[dsh-pet] No desktop pets (all display=web/none) and no tray required (tray=${getTrayOn()}); skipping the desktop helper`,
        );
      }
      return;
    }
    // No graphical display environment (Linux server/container): give up directly, no detection, no downloading, no
    // pulling up. Otherwise, Electron will "collapse when pulled up", and will be repeatedly restarted by the guard
    // loop and full of core dump.
    if (!hasGraphicalDisplay()) {
      if (!displayWarned) {
        displayWarned = true;
        log.warn(
          '[dsh-pet] No graphical display detected (DISPLAY/WAYLAND_DISPLAY empty); skipping desktop pets.' +
            'Browser pets remain available. For desktop mode on a server, configure Xvfb and set DSH_PET_DESKTOP_FORCE=1.',
        );
      }
      return;
    }
    const found = resolveElectronPath();
    if (found) {
      launchHelper(found);
      return;
    }
    // Diagnostic log (issue #168): Just reporting "not found" is not enough - the most common situation is that "the
    // file clearly exists", but it is not on the actual query path (DSH_HOME is inconsistent). Type out the actual
    // search path together.
    log.warn(
      `[dsh-pet] Electron executable not found: DSH_HOME=${dshHomeDir()}, searched=${defaultElectronExe()}` +
        `, DSH_PET_ELECTRON_PATH=${process.env.DSH_PET_ELECTRON_PATH ?? '(not set)'}`,
    );
    log.warn(`[dsh-pet] Downloading Electron to ${defaultElectronExe()} ...`);
    electronEnsure = ensureElectronDownload({
      // The entire download process is written into the working status bubble (the user does not have a console and can only rely on it to see the progress and failure reasons)
      onLog: ({ text, level, done }) =>
        reportDownload(text, level === 'warn' ? 'error' : done ? 'success' : 'working', done),
      // The same progress also persists to disk: the bubble is only visible when there is a pet displayed. When the desktop version Helper cannot get up, it has no carrier.
      logger: log,
    })
      .then((path) => {
        if (path) {
          launchHelper(path);
        } else {
          log.warn(
            '[dsh-pet] Electron download failed; desktop pet unavailable. Set DSH_PET_ELECTRON_PATH and restart, or retry later.',
          );
        }
      })
      .finally(() => {
        electronEnsure = undefined;
      });
  };

  const stopHelper = (reason = 'settings-change'): void => {
    if (startRetryTimer) {
      clearTimeout(startRetryTimer);
      startRetryTimer = undefined;
    }
    helper?.stop(reason);
    helper = undefined;
  };

  const stopHelperAndWait = async (reason: string): Promise<void> => {
    if (startRetryTimer) {
      clearTimeout(startRetryTimer);
      startRetryTimer = undefined;
    }
    const old = helper;
    helper = undefined;
    await old?.stopAndWait(reason);
  };

  const animSubdirFor = (ext: string): string => (ext === '.mov' ? 'mov' : 'webm');

  const assetRootFor = (ext: string): string => join(PACKAGE_ROOT, 'assets', animSubdirFor(ext));

  const userRootFor = (ext: string): string => join(thumbUserRoot, animSubdirFor(ext));

  const markDisposed = (): void => {
    disposed = true;
  };

  return { startHelper, stopHelper, stopHelperAndWait, markDisposed, assetRootFor, userRootFor };
}

/** Output of DesktopSpawn. */
export type DesktopSpawn = ReturnType<typeof createDesktopSpawn>;
