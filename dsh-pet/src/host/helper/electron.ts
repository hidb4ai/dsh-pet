/**
 * Electron Locating and downloading: Find the installed binary. If it is missing, download and decompress it on
 * demand.
 *
 * It is not responsible for starting the process (owned by ./child); it returns undefined after logging failed
 * downloads, and is downgraded from caller to browser-only mode. Must always be true: parsing results only come from
 * explicit candidates, DSH_PET_ELECTRON_PATH and $DSH_HOME/electron; do not borrow the electron npm package in the
 * host installation directory (#297: that is the directory to be replaced when pnpm rearranges dependencies).
 * @module dsh-pet/src/host/helper/electron
 */
import { dirname, join, resolve } from 'node:path';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { type LoggerLike } from '../log-file.ts';
import { PACKAGE_ROOT } from '../paths.ts';
import type { HelperOptions } from './child.ts';

/** Package root: shares the same anchor point with other host modules (see ../paths.ts ), and cannot be counted as a separate copy of this file directory. */
export const packageRoot = PACKAGE_ROOT;

/** Default Helper entry point (runtime/electron-helper/main.js). */
export const defaultHelperMain = resolve(packageRoot, 'runtime', 'electron-helper', 'main.js');

/** Remote debugging port for desktop Helper: 0 = not open. When troubleshooting, change it locally to 9222, restart Helper and then use chrome :// inspect to connect. */
export const DESKTOP_DEBUG_PORT = 0;

/** Force the Chromium switch of XWayland: The positioning/always-on-top/click-through of the small window under Wayland native are not available. */
const OZONE_X11_SWITCH = '--ozone-platform=x11';

/**
 * Whether the Linux Wayland session should be forced to go to XWayland.
 *
 * It can only be forced when there is XWayland (`DISPLAY` exists); pure Wayland can only prompt the user to switch to
 * X11 session.
 * @param env - Read display environment variables; default process environment.
 * @param platform - running platform; default `process.platform` .
 * true when @returns requires and can force XWayland.
 */
export function shouldForceXWayland(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): boolean {
  return platform === 'linux' && Boolean(env.WAYLAND_DISPLAY) && Boolean(env.DISPLAY);
}

/**
 * Boot parameters for desktop Helper.
 *
 * The switch must be arranged before the Helper entry point script: Electron treats the parameters after the script
 * path as application parameters.
 * @param helperPath - Helper The absolute path of the entry point script.
 * @param options - `debugPort` remote debugging port (0 to close); `forceX11` whether to add `--ozone-platform=x11` .
 * @returns can be directly passed to the parameter array of spawn.
 */
export function helperLaunchArgs(
  helperPath: string,
  options: { debugPort?: number; forceX11?: boolean } = {},
): string[] {
  const debugPort = options.debugPort ?? DESKTOP_DEBUG_PORT;
  const switches: string[] = [];
  if (options.forceX11 === true) switches.push(OZONE_X11_SWITCH);
  if (debugPort > 0) switches.push('--remote-debugging-port=' + debugPort);
  return [...switches, helperPath];
}

/** Only basic file verification is done: the binary format is not verified, and the candidate is not actually launched. */
function isNonEmptyFile(path: string): boolean {
  try {
    const stat = statSync(path);
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}

/**
 * Parse the Electron executable file and select the first existing and non-empty candidate according to priority:
 * explicit candidate → DSH_PET_ELECTRON_PATH → $DSH_HOME/electron (download landing path). Only recognize its own
 * landing path: do not detect the npm global directory / Program Files / / usr/bin, nor borrow the electron npm
 * package in the host installation directory - running Helper will lock it, and pnpm cannot be replaced as a whole
 * when rearranging dependencies (#297). When neither exists, ensureElectronDownload() downloads it asynchronously in
 * the process (not the spawn child process to avoid process.execPath pointing to host exe in Electron host and
 * crashing).
 */
export function resolveElectronPath(candidates: Array<string | undefined> = []): string | undefined {
  const seen = new Set<string>();
  const list: string[] = [];
  const push = (value: string | undefined | null): void => {
    if (!value || seen.has(value)) return;
    seen.add(value);
    list.push(value);
  };
  for (const value of candidates) push(value);
  if (process.env.DSH_PET_ELECTRON_PATH) push(process.env.DSH_PET_ELECTRON_PATH);
  push(defaultElectronExe());
  return list.find(isNonEmptyFile);
}

/**
 * Determine whether the current environment can really run the Electron graphics window.
 *
 * Linux In a non-display environment (server/container/pure CLI), Electron can be downloaded and spawn, but it crashes
 * when initializing the graphics stack; with the daemon loop, it becomes "pull up → crash → restart" every second,
 * each core dump is about 14 MB, and it can pile up to dozens in a few hours GB fills the disk, so it must be judged
 * before pulling up. Only those that are "clearly unable to run" are blocked: win32 / darwin are released (macOS
 * without DISPLAY will also go to WindowServer), linux requires one of DISPLAY or WAYLAND_DISPLAY. Escape port
 * DSH_PET_DESKTOP_FORCE =1 is mandatory to skip and is used in scenarios such as Xvfb/remote desktop where
 * "environment variables are not set but can actually be displayed".
 */
export function hasGraphicalDisplay(): boolean {
  if (process.platform !== 'linux') return true;
  if (process.env.DSH_PET_DESKTOP_FORCE === '1') return true;
  return Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
}

/** $DSH_HOME (default ~/. dsh); test and standalone mode share this derivation. */
export function dshHomeDir(): string {
  const userProfile = process.env.USERPROFILE || process.env.HOME || '';
  return process.env.DSH_HOME || join(userProfile, '.dsh');
}

// Electron official release package differs according to platform/architecture: win32 decompresses electron.exe + bulk
// files, darwin is Electron.app (the executable file is in Contents/MacOS/Electron), and linux is electron single
// file.

/** Current platform identification (win32 / darwin / linux). */
const PLAT = process.platform;

/** $DSH_HOME/electron The relative path of the executable file in the landing directory (by platform). */
const ELECTRON_REL =
  PLAT === 'win32'
    ? 'electron.exe'
    : PLAT === 'darwin'
      ? join('Electron.app', 'Contents', 'MacOS', 'Electron')
      : 'electron';

/**
 * Electron runtime landing directory ($DSH_HOME/electron) - the target for downloading and decompressing, and also the
 * directory that users are allowed to clean up in the "unmount and storage" settings page. Both parsing
 * (resolveElectronPath / defaultElectronExe) and downloading must go here: the same directory literal is written again
 * elsewhere, if one part is changed and the other is not changed, the settings page will display a path that never
 * exists.
 */
export function electronLandingDir(): string {
  return join(dshHomeDir(), 'electron');
}

/** Electron implementation path: $DSH_HOME/electron/<executable file by platform>. */
export function defaultElectronExe(): string {
  return join(electronLandingDir(), ELECTRON_REL);
}

/**
 * Read the version number in the Electron installation directory.
 *
 * The official compressed package comes with a `version` file at the same level as the executable file (such as
 * `43.3.0` ). Reading it is much cheaper than spawn and `--version` again. "Which version" is the only key information
 * that cannot be seen from the exit code when troubleshooting crashes, so the log must be brought.
 * @param electronExe - Electron Absolute path to the executable file.
 * @returns version number; when the file is missing or the content does not resemble the version number, undefined
 * (caller omits this paragraph and does not make it up).
 */
export function readElectronVersion(electronExe: string): string | undefined {
  try {
    const version = readFileSync(join(dirname(electronExe), 'version'), 'utf8').trim();
    return /^\d+\.\d+\.\d+/.test(version) ? version : undefined;
  } catch {
    return undefined;
  }
}

/** Option to download Electron in-process. */
export interface EnsureElectronOptions {
  /** Electron version number (default 43.3.0, can be overwritten by DSH_PET_ELECTRON_VERSION). */
  version?: string;
  /** Download image (default npmmirror, can be overwritten by DSH_PET_ELECTRON_MIRROR). */
  mirror?: string;
  /** Single download timeout (default 10 minutes). */
  timeoutMs?: number;
  /**
   * User-facing log export (into desktop pet work bubble). Separate from console: console leaves the original English
   * text for terminal/CLI troubleshooting, here is a short sentence output for "DSH desktop users without a console".
   * This function only outputs text and does not recognize state.
   */
  onLog?: (event: ElectronDownloadLog) => void;
  /** persist to disk log export (unified logger injected by host, see ./log-file); if not transmitted, it will return console. */
  logger?: LoggerLike;
}

/** A download log: `text` for users to see; `level='warn'` = failed path; `done` = this download has been cleanup (success or failure). */
export interface ElectronDownloadLog {
  text: string;
  level: 'info' | 'warn';
  done: boolean;
}

/**
 * In-process download and decompression of Electron to $DSH_HOME/electron.
 *
 * Not spawn child process: CLI node and Electron are available in host (DSH Desktop), and also avoid the crash caused
 * by process.execPath pointing to host exe in host. If it already exists, it will be returned as is; if it fails, it
 * will return undefined (DSH and the browser overlay will not be affected).
 */
export async function ensureElectronDownload(options: EnsureElectronOptions = {}): Promise<string | undefined> {
  const version = options.version || process.env.DSH_PET_ELECTRON_VERSION || '43.3.0';
  const mirror = options.mirror || process.env.DSH_PET_ELECTRON_MIRROR || 'https://npmmirror.com/mirrors/electron/';
  const timeoutMs = options.timeoutMs ?? 10 * 60 * 1000;
  const targetDir = electronLandingDir();
  const exe = defaultElectronExe();
  if (isNonEmptyFile(exe)) return exe;

  // The download log defaults to console; the host will pass in its own unified logger - the desktop version does not
  // have a console, and the direct output of console is equivalent to loss (ctx.logger is not mapped to the terminal
  // in some hosts).
  const sink = options.logger ?? console;
  const log = (message: string): void => sink.info?.(`[dsh-pet] ${message}`);
  const warn = (message: string): void => sink.warn?.(`[dsh-pet] ${message}`);
  // Two exits for the same thing (see EnsureElectronOptions.onLog): console original text + a sentence for users to
  // read. The text is deliberately divided into two sets - version number/path/time consumption, which are
  // useful to developers, but are noise to users, and are not combined into the same sentence.
  const info = (consoleText: string, text: string, done = false): void => {
    log(consoleText);
    options.onLog?.({ text, level: 'info', done });
  };
  const fail = (consoleText: string, text: string): void => {
    warn(consoleText);
    options.onLog?.({ text, level: 'warn', done: true });
  };
  const startedAt = Date.now();

  if (existsSync(exe)) {
    info(`Electron cache is empty or not a regular file: ${exe}`, 'Electron 缓存无效，准备重新下载');
  }
  info(`Electron not found, downloading v${version} (${PLAT}-${process.arch}) ...`, `正在下载 Electron ${version}`);

  try {
    // Directory creation may also fail (insufficient permissions, file with the same name, etc.), downgrading to the browser pet in the same way as download failure.
    mkdirSync(targetDir, { recursive: true });
    // Official @electron / get download: responsible for URL assemble, mirroring, SHA256 verification (sumchecker),
    // download cache (the same version is only downloaded once, and the cache will be returned in seconds after
    // hitting the cache). The timeout is passed to fetch using AbortController.
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(new Error(`Electron download timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
    timer.unref?.();
    let nextLogAt = Date.now() + 3000;
    try {
      // Loading on demand: static import will be nailed into the startup path of each product together with a list of
      // dependencies got/fs-extra, but this path will not be executed in independent application mode.
      const { downloadArtifact } = await import('@electron/get');
      const zipPath = await downloadArtifact({
        version: `v${version}`,
        artifactName: 'electron',
        // platform/arch is not passed: @electron / get is automatically inferred using the host platform and
        // architecture (getHostArch also handles the special case of arm → armv7l, which is more accurate than
        // explicitly passing process.arch)
        mirrorOptions: { mirror: mirror.replace(/\/$/, '') + '/' },
        downloadOptions: {
          signal: controller.signal,
          quiet: true, // Turn off @electron / get's own progress bar (stdout takes the host log and does not enter the bridge protocol)
          getProgressCallback: async (progress: { transferred: number; total: number | null }) => {
            const now = Date.now();
            if (!progress.total || now < nextLogAt) return;
            nextLogAt = now + 3000;
            const doneMb = (progress.transferred / 1024 / 1024).toFixed(1);
            const totalMb = (progress.total / 1024 / 1024).toFixed(1);
            const percent = Math.min(100, Math.floor((progress.transferred / progress.total) * 100));
            info(`downloading ${doneMb}MB / ${totalMb}MB`, `Electron 下载 ${percent}% · ${doneMb}/${totalMb}MB`);
          },
        },
      });
      const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
      info(`download complete (${seconds}s), extracting to ${targetDir} ...`, `下载完成（${seconds}s），正在解压`);
      // Use the official extract-zip for decompression (the same model as the official electron 43 installation): pure
      // Node + native binding, consistent across platforms, correctly handle symlink and file permissions, and do not
      // require system unzip/tar/powershell. Must be dynamic import: This package is the N-API native module. The
      // precompiled product does not have Android target. The static import will be throw during the module evaluation
      // period, so that users who only want to use Web mode will fail to activate the entire entry; after on-demand
      // loading, failure will only fall into this function. catch.
      const { default: extract } = await import('@electron-internal/extract-zip');
      await extract(zipPath, { dir: targetDir });
      if (!isNonEmptyFile(exe)) {
        throw new Error(`Electron zip extracted, but ${ELECTRON_REL} is missing, empty or not a regular file`);
      }
      const readySeconds = ((Date.now() - startedAt) / 1000).toFixed(1);
      info(`ready in ${readySeconds}s: ${exe}`, `Electron 就绪（${readySeconds}s），正在启动桌宠`, true);
      return exe;
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    fail(`ensure failed: ${reason}`, `Electron 下载失败：${reason}`);
    warn('desktop pet unavailable. Set DSH_PET_ELECTRON_PATH to an existing Electron, or retry later.');
    return undefined;
  }
}

/**
 * Default startup method: Electron executable file + Helper entry point script.
 * An error is thrown when @throws Electron cannot be parsed (the caller is downgraded to a browser pet accordingly).
 */
export function defaultLaunch(options: HelperOptions = {}): { command: string; args: string[] } {
  const electronPath = resolveElectronPath([options.electronPath]);
  if (!electronPath) {
    throw new Error('dsh-pet: cannot resolve Electron executable. Set DSH_PET_ELECTRON_PATH or install electron.');
  }
  const helperPath = options.helperPath || defaultHelperMain;
  return { command: electronPath, args: helperLaunchArgs(helperPath, { forceX11: shouldForceXWayland() }) };
}
