/**
 * Helper subprocess itself: pull up, pipe communication, stop and wait for exit.
 *
 * Do not decide when to restart (return to ./restart), do not resolve the Electron path (return to ./electron). This
 * must always be true: the old and new processes never overlap, and the pipe must not be written to after stop.
 * @module dsh-pet/src/host/helper/child
 */
import { mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { BRIDGE_PREFIX } from './bridge.ts';
import type { BridgeHandler, BridgeRequest, BridgeResponse } from './bridge.ts';
import { defaultHelperMain, defaultLaunch, dshHomeDir, readElectronVersion, shouldForceXWayland } from './electron.ts';
import {
  HELPER_STABLE_MS,
  HELPER_STOP_TIMEOUT_MS,
  waitForChildExit,
  RESTART_BASE_MS_DEFAULT,
  RESTART_MAX_FAILURES_DEFAULT,
  crashLoopAdvice,
  describeExit,
  envPositiveInt,
  helperOutputIsMeaningful,
  helperRunIsStable,
  restartBackoffDelayMs,
  shouldCircuitBreak,
  shouldFallbackToNoSandbox,
} from './restart.ts';

/** Runtime identity in the log: ` · electron=<path> (<version>)`; only the path is left when the version cannot be read. */
function electronIdentity(electronExe: string): string {
  const version = readElectronVersion(electronExe);
  return ` · electron=${electronExe}${version ? ` (${version})` : ''}`;
}

/** Options for constructing HelperProcess; all optional, defaultLaunch and $DSH_HOME are selected by default. */
export interface HelperOptions {
  electronPath?: string;
  helperPath?: string;
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string | undefined>;
  restartDelayMs?: number;
  /** bridge protocol processor: Every request of renderer (configuration/balance/whisper/asset, etc.) is answered by it */
  bridgeHandler?: BridgeHandler;
}

/** Minimum log interface (host passes console or unified logger); the same shape as log-file and LoggerLike. */
type Logger = {
  info?: (message: string) => void;
  warn?: (message: string) => void;
  error?: (message: string) => void;
  debug?: (message: string) => void;
};

/**
 * Environment variables used by spawn helper (pure function, can be tested independently).
 *
 * `ELECTRON_RUN_AS_NODE` must be deleted: The host itself may be a Electron application (DSH Desktop), and its env may
 * contain this variable. The transparent transmission as it is will cause the child process to start in pure Node mode
 * - `require('electron')` directly MODULE_NOT_FOUND, helper It crashes, the guard loop restarts, and finally the
 * meltdown occurs. Desktop mode no longer appears at all, without any user-visible prompts. Why is it deleted instead
 * of empty: Electron only checks whether this variable exists. The actual measurement is to set `''` directly to abort
 * (exit 134), and to set `'0'` / `'false'` / `'1'` to pure Node mode; during runtime, set delete It's too late, the
 * module loader is set when the process starts.
 */
export function helperSpawnEnv(hostPid: number, extra?: Record<string, string | undefined>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, DSH_PET_HOST_PID: String(hostPid), ...extra };
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

/**
 * Assemble argv of helper; `--no-sandbox` must be ranked before the app path, otherwise Electron will treat it as an
 * application parameter.
 *
 * Electron only recognizes the command line, and there is no environment variable or configuration file to express
 * "disable sandbox"; customized command will not be injected, which is not the real Electron (test avatars and user
 * scripts are excluded by this).
 * @param baseArgs - Default startup parameters, the first item is the main.js path.
 * @param opts - `sandboxFallback` has degraded to `--no-sandbox` ; `customCommand` has its own executable file for
 * caller.
 * @returns can be directly handed over to the new array of spawn; it has the same value as `baseArgs` when it is not
 * rolled back.
 */
export function helperLaunchArgs(
  baseArgs: readonly string[],
  opts: { sandboxFallback: boolean; customCommand: boolean },
): string[] {
  return opts.sandboxFallback && !opts.customCommand ? ['--no-sandbox', ...baseArgs] : [...baseArgs];
}

/** The lifecycle of a Helper child process: startup, protocol reading and writing, stopping, crash and restart. */
export class HelperProcess {
  declare readonly options: HelperOptions;
  declare readonly logger: Logger;
  declare private child?: import('node:child_process').ChildProcess;
  declare private stopping: boolean;
  declare private restartTimer?: NodeJS.Timeout;
  /** Continuous crash count (cleared after stable operation for ≥3 minutes; triggering fuse when reaching the upper limit) */
  declare private restartFailures: number;
  /** The timestamp of the latest start() (stability judgment criterion) */
  declare private lastStartAt: number;
  /** stdout is buffered by line (protocol lines are split by \ n). Use declare + constructor assignment to avoid class fields being degraded to external helper */
  declare private stdoutBuffer: string;
  /** The last runtime identity (executable file path and version) that was pulled up: it must be included in the crash and circuit breaker logs */
  declare private launchIdentity: string;
  /** Have you already switched to `--no-sandbox` due to "sandbox initialization failure" (only returned once) */
  declare private hasSandboxFallbackApplied: boolean;
  /** Has the current child process written non-blank stdout/stderr: There is an output indicating that JS has been run, and you cannot rely on the sandbox to exit in seconds. */
  declare private hasChildOutput: boolean;

  constructor(options: HelperOptions = {}, logger: Logger = console) {
    this.options = options;
    this.logger = logger;
    this.child = undefined;
    this.stopping = false;
    this.restartTimer = undefined;
    this.restartFailures = 0;
    this.lastStartAt = 0;
    this.stdoutBuffer = '';
    this.launchIdentity = '';
    this.hasSandboxFallbackApplied = false;
    this.hasChildOutput = false;
  }

  /** Start a child process; when an existing child process is running or stopping, it directly returns to the existing handle. */
  start(): import('node:child_process').ChildProcess | undefined {
    if (this.child || this.stopping) return this.child;
    this.lastStartAt = Date.now();
    const helperPath = this.options.helperPath || defaultHelperMain;
    const launch = this.options.command
      ? { command: this.options.command, args: this.options.args || [helperPath] }
      : defaultLaunch(this.options);
    const command = launch.command;
    const args = helperLaunchArgs(this.options.args || launch.args, {
      sandboxFallback: this.hasSandboxFallbackApplied,
      customCommand: Boolean(this.options.command),
    });
    // Wayland native window cannot be positioned/always-on-top/click-through, only XWayland can save it; when using pure Wayland, it is clearly stated that it is not available, so don’t let the user guess.
    if (!this.options.command && shouldForceXWayland()) {
      this.logger.info?.('dsh-pet desktop helper: Wayland session; forcing XWayland (--ozone-platform=x11)');
    } else if (!this.options.command && process.platform === 'linux' && process.env.WAYLAND_DISPLAY) {
      this.logger.warn?.(
        'dsh-pet desktop helper: Wayland without XWayland cannot position, pin or pass clicks through desktop windows; use an X11 session',
      );
    }
    this.hasChildOutput = false;
    // The version is only read here once: the exit code when crashing can explain "how it died", but cannot explain "which version it died from", and that is the entry point for troubleshooting
    this.launchIdentity = electronIdentity(command);

    // cwd must fall outside the package directory: Windows is not allowed to rename or delete the current directory of
    // the live process, otherwise pnpm cannot overwrite rename with node_modules/dsh-pet. Helper side resource
    // analysis has nothing to do with CWD, so $DSH_HOME is used.
    const cwd = this.options.cwd || dshHomeDir();
    mkdirSync(cwd, { recursive: true }); // cwd of spawn does not exist and will directly ENOENT
    const child = spawn(command, args, {
      cwd,
      // DSH_PET_HOST_PID: Give the host's own pid to helper so that it can determine "whether the host is still there"
      // (every 2 s on the helper side
      // kill ( pid , 0) once, ESRCH will exit on its own). Place it at the only spawn point, and all callers can get
      // it. macOS/Linux is a must: libuv on Windows will put the child process into the job object with
      // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, and the host will be killed as soon as it exits the kernel; POSIX does not
      // have this layer of fallback, and helper will always remain. The environment variables are uniformly
      // constructed from helperSpawnEnv: it will delete ELECTRON_RUN_AS_NODE that will hijack the Electron startup
      // mode.
      env: helperSpawnEnv(process.pid, this.options.env),
      stdio: ['pipe', 'pipe', 'pipe'], // stdin also requires: bridge protocol response writeback (main.js request comes up via stdout)
      windowsHide: true,
    });
    this.child = child;
    // "Start successfully" can be written immediately after spawn returns, but the process may be crashing at that
    // time: there is "started" followed by "exited" in the log of #244. Wait until the stability threshold is reached
    // and it is still alive to add a line, so that the two can be distinguished.
    const stableTimer = setTimeout(() => {
      if (this.child === child && !this.stopping) {
        this.logger.info?.(`dsh-pet desktop helper stable for ${HELPER_STABLE_MS / 60_000}m${this.launchIdentity}`);
      }
    }, HELPER_STABLE_MS);
    stableTimer.unref?.();
    child.once('error', (error) => {
      this.logger.error?.(`dsh-pet desktop helper failed to start: ${error.message}${this.launchIdentity}`);
      // spawn fails (ENOENT / EACCES) and only error is sent but not exit: You cannot leave a child process that is
      // not running to block every subsequent start; and the living process reports an error (for example, kill fails)
      // and must continue to wait for its exit.
      if (child.pid === undefined && this.child === child) {
        this.child = undefined;
        clearTimeout(stableTimer);
        this.scheduleRestart();
      }
    });
    child.once('exit', (code, signal) => {
      if (this.child !== child) return;
      this.child = undefined;
      clearTimeout(stableTimer);
      if (!this.stopping) {
        // Special form of sandbox initialization failure: instant exit, no output, exit code 0x80000003 → Change --
        // no-sandbox and try again immediately. It must be ranked before "log + retreat": this round does not count as
        // a crash, and the retreat and circuit breaker quota should not be consumed.
        if (this.applySandboxFallback(code)) return;
        this.logger.warn?.(
          `dsh-pet desktop helper exited (${describeExit(code, signal)})${this.launchIdentity}; restarting`,
        );
        this.scheduleRestart();
      }
    });
    child.stdout.on('data', (chunk) => {
      // Electron may write two newline bytes before aborting in a low-integrity environment. Whitespace is not
      // evidence that JavaScript ran; otherwise it would incorrectly block the sandbox fallback from issue #286.
      const text = String(chunk);
      if (helperOutputIsMeaningful(text)) this.hasChildOutput = true;
      this.onStdoutChunk(text);
    });
    child.stderr.on('data', (chunk) => {
      const line = String(chunk).trim();
      if (helperOutputIsMeaningful(line)) {
        this.hasChildOutput = true;
        this.logger.warn?.(`[dsh-pet desktop helper] ${line}`);
      }
    });
    child.stdin?.on('error', () => {
      /* EPIPE, etc.: Writeback fails silently during process exit/restart (next round of start reconstruction pipeline) */
    });
    return child;
  }

  /** stdout Buffering by line: `dsh-pet-bridge:` prefixed entire line = protocol request, rest = log line. */
  private onStdoutChunk(chunk: string): void {
    this.stdoutBuffer += chunk;
    let nl: number;
    while ((nl = this.stdoutBuffer.indexOf('\n')) >= 0) {
      const line = this.stdoutBuffer.slice(0, nl);
      this.stdoutBuffer = this.stdoutBuffer.slice(nl + 1);
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith(BRIDGE_PREFIX)) {
        void this.handleBridgeLine(trimmed);
        continue;
      }
      this.logger.debug?.(`[dsh-pet desktop helper] ${trimmed}`);
    }
  }

  /**
   * Process a protocol request: hand it over to host bridgeHandler, and press id POST to return to the callback server
   * of main.js (cb is carried by the request line; stdin - Electron main process cannot receive piped stdin)
   */
  private async handleBridgeLine(line: string): Promise<void> {
    const child = this.child;
    if (!child?.stdin || !this.options.bridgeHandler) return;
    let req: BridgeRequest;
    try {
      req = JSON.parse(line.slice(BRIDGE_PREFIX.length)) as BridgeRequest;
    } catch {
      this.logger.warn?.('[dsh-pet desktop helper] Ignoring an invalid bridge protocol line');
      return;
    }
    if (typeof req.id !== 'number') return;
    try {
      // bridgeHandler returns complete BridgeResponse (including id); fallback 500 in case of exception
      const resp = await this.options.bridgeHandler(req);
      this.sendBridgeResponse(req, resp);
    } catch (e) {
      this.sendBridgeResponse(req, {
        id: req.id,
        status: 500,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify({ error: `bridge handler error: ${e instanceof Error ? e.message : String(e)}` }),
      });
    }
  }

  /** Send the response back to main.js: Prioritize POST to cb carried in the request line (local callback server); if there is no cb, write back stdin (compatible with lower versions). */
  private sendBridgeResponse(req: BridgeRequest, resp: BridgeResponse): void {
    const cb = typeof req.cb === 'string' && /^https?:[/][/]/.test(req.cb) ? req.cb : '';
    if (cb) {
      void fetch(cb, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(resp),
      }).catch(() => {
        /* callback failed (main.js has exited, etc.): the requesting end will time out and downgrade, and it will be silent here. */
      });
      return;
    }
    const child = this.child;
    if (!child?.stdin || child.stdin.destroyed) return;
    try {
      child.stdin.write(BRIDGE_PREFIX + JSON.stringify(resp) + '\n');
    } catch {
      /* ignore */
    }
  }

  /**
   * Stop helper: Send SIGTERM and return immediately, without waiting for it to exit. Use this to exit the host/plugin
   * unmount path - the host will be gone immediately (Windows has job objects, POSIX has helper's own host-liveness
   * fallback). Scenarios that require immediate restart after stopping must use stopAndWait(), otherwise the old and
   * new processes will overlap briefly.
   */
  stop(reason = 'plugin-disposed'): void {
    this.stopping = true;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = undefined;
    this.logger.debug?.(`dsh-pet desktop helper stopping (${reason})`);
    const child = this.child;
    if (!child) return;
    child.kill();
  }

  /**
   * Stop helper and wait for it to actually exit: only sending SIGTERM once and then spawn to the new process will not
   * work - Electron will close the window and destroy it after receiving SIGTERM. The GPU/animation synthesizer is
   * asynchronous (starting from a few hundred ms), the old window (old size) has not disappeared, and the new window
   * has been drawn. "Two pets" will briefly appear on the desktop. Therefore: ① Set `stopping` first (completed by
   * stop()), and the daemon logic must not misjudge this active stop as a crash to automatically restart; ② Just wait
   * for `exit` , not wait `close` - stdio pipe is closed much earlier than the process actually exits; ③ Timeout
   * (default 3 s) upgrade SIGKILL, and then give 1 s grace. Give up waiting before exiting. Configuration saving must
   * not be hung indefinitely.
   */
  async stopAndWait(reason = 'plugin-disposed', timeoutMs = HELPER_STOP_TIMEOUT_MS): Promise<void> {
    this.stop(reason);
    const child = this.child;
    if (!child) return;
    await waitForChildExit(child, timeoutMs, () => {
      this.logger.warn?.(`dsh-pet desktop helper did not exit within ${timeoutMs}ms; sending SIGKILL (${reason})`);
      try {
        child.kill('SIGKILL');
      } catch {
        /* Already logged out */
      }
    });
  }

  /** Special crash when sandbox initialization fails → Use `--no-sandbox` instead and try again immediately, not counting backoff and circuit breaker quotas. */
  private applySandboxFallback(code: number | null): boolean {
    const applied = shouldFallbackToNoSandbox({
      code,
      sawOutput: this.hasChildOutput,
      ranMs: Date.now() - this.lastStartAt,
      alreadyApplied: this.hasSandboxFallbackApplied,
      customCommand: Boolean(this.options.command),
      // The "preserve sandbox" switch set by the user at the GPU sandbox level: automatic downgrade must not exceed the explicit setting.
      sandboxOptOut: process.env.DSH_PET_GPU_SANDBOX === '1',
    });
    if (!applied) return false;
    this.hasSandboxFallbackApplied = true;
    this.logger.warn?.(
      `dsh-pet desktop helper exited during Chromium sandbox initialization (${describeExit(code, null)});` +
        `retrying once with --no-sandbox${this.launchIdentity}`,
    );
    this.start();
    return true;
  }

  private scheduleRestart(): void {
    if (this.restartTimer || this.stopping) return;
    // Exponential backoff (starting from 750 ms, 2 x, capped at 30 s) + circuit breaker (stops restarting after 12
    // consecutive crashes about 3 minutes); both thresholds can be configured (DSH_PET_RESTART_BASE_MS /
    // DSH_PET_RESTART_MAX_FAILURES), stable operation ≥3 minutes to clear.
    if (helperRunIsStable(Date.now() - this.lastStartAt)) {
      this.restartFailures = 0;
    } else {
      this.restartFailures += 1;
    }
    if (shouldCircuitBreak(this.restartFailures, this.resolveMaxFailures())) {
      // Meltdown is the last opportunity that users can see: just saying "meltdown" and the DISPLAY suggestion of
      // Linux is equivalent to letting Windows users neither know which version is dead, nor get the next step to
      // follow (#244 scene).
      this.logger.error?.(
        `dsh-pet desktop helper crashed ${this.restartFailures} consecutive times; circuit breaker tripped, ` +
          `no more restarts${this.launchIdentity}; suggested action: ${crashLoopAdvice(process.platform)}`,
      );
      return;
    }
    const base = this.resolveRestartBaseMs();
    // The count is "how many times has it crashed" (starting from 1), and the delay is calculated based on "how many times it has been retried" (starting from 0), so subtract 1: the first crash, etc. base.
    const delay = restartBackoffDelayMs(this.restartFailures - 1, base);
    this.logger.warn?.(
      `dsh-pet desktop helper exited; restarting in ${Math.round(delay)}ms ` +
        `(attempt ${this.restartFailures}, consecutive-crash limit ${this.resolveMaxFailures()})`,
    );
    this.restartTimer = setTimeout(() => {
      this.restartTimer = undefined;
      this.start();
    }, delay);
    this.restartTimer.unref?.();
  }

  /** Backoff base value: DSH_PET_RESTART_BASE_MS (ms, >0) adjustable, default 750. */
  private resolveRestartBaseMs(): number {
    return envPositiveInt(process.env.DSH_PET_RESTART_BASE_MS, RESTART_BASE_MS_DEFAULT);
  }

  /** Fuse threshold: DSH_PET_RESTART_MAX_FAILURES (times, >0) adjustable, default 12. */
  private resolveMaxFailures(): number {
    return envPositiveInt(process.env.DSH_PET_RESTART_MAX_FAILURES, RESTART_MAX_FAILURES_DEFAULT);
  }
}
