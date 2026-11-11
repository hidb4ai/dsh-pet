/**
 * Restart strategy: backoff interval, circuit breaker conditions, determination of "whether running is stable or not",
 * and readability of the crash scene (exit code meaning and handling suggestions).
 *
 * It does not start or stop the process, but only provides purely computational decisions and text for ./
 * child. It must always be true: the backoff is monotonous and does not decrease, and there will no longer be
 * automatic retries after the circuit breaker is broken.
 * @module dsh-pet/src/host/helper/restart
 */

/** Stop the upper limit of waiting for helper (ms): upgrade to SIGKILL if it exceeds it. */
export const HELPER_STOP_TIMEOUT_MS = 3000;

/** How long does it take for the process to exit after SIGKILL (ms); if it has not exited at the end, it will give up waiting and will never hang the caller indefinitely. */
export const HELPER_STOP_GRACE_MS = 1000;

/** Stable operation judgment threshold: Helper After continuous crash-free operation ≥ 3 minutes, the restart failure count is cleared to zero. */
export const HELPER_STABLE_MS = 3 * 60 * 1000;

/** Electron The exit code when the sandbox initialization fails is 0x80000003 (STATUS_BREAKPOINT); the two reporting methods of Node are normalized by `>>> 0`. */
const SANDBOX_INIT_FAILED_CODE = 0x80000003;

/** Only when exiting within this time window and there is no line of output, will the exit be regarded as "the sandbox cannot be started". */
const SANDBOX_FALLBACK_WINDOW_MS = 5000;

/**
 * Exponential backoff: wait for base × 2ⁿ after the n time (starting from 0) failure, capped at 30 s. Default base 750
 * ms, sequence 750 → 1500 → 3000 → … → 30000.
 */
export function restartBackoffDelayMs(consecutiveFailures: number, baseMs = 750): number {
  const MAX = 30_000;
  const raw = baseMs * 2 ** Math.max(0, consecutiveFailures);
  return Math.min(raw, MAX);
}

/** Circuit breaker judgment: It will no longer automatically restart after crashing ≥ limit (default 12, cumulative default backoff is about 3 minutes) times. */
export function shouldCircuitBreak(consecutiveFailures: number, limit = 12): boolean {
  return consecutiveFailures >= limit;
}

/** Stable operation judgment: The time since the last pull-up ≥ HELPER_STABLE_MS is regarded as a "successful operation" and the count can be cleared. */
export function helperRunIsStable(elapsedMs: number): boolean {
  return elapsedMs >= HELPER_STABLE_MS;
}

/** Windows NTSTATUS exit code → English description; only the category "the process was terminated by the system on the spot" is included, and the others are not included. */
const WINDOWS_EXIT_MEANINGS: Readonly<Record<number, string>> = {
  0xc0000005: 'access violation',
  [SANDBOX_INIT_FAILED_CODE]: 'breakpoint (sandbox initialization failed)',
  0xc0000135: 'missing DLL',
  0xc0000142: 'DLL initialization failed',
};

/**
 * Translate the child process exit code into a human sentence.
 *
 * Only the NTSTATUS form of Windows is recognized (unsigned value ≥ 0x80000000): The POSIX exit code is only 0–255
 * and will not hit this table. The input parameters recognize two reporting methods of Node at the same time -
 * `3221225477` and `-1073741819` point to the same `0xC0000005` .
 * @param code - child process exit code; null means terminated by signal.
 * @returns English description; undefined is returned when it is not included or code is null.
 */
function explainExitCode(code: number | null): string | undefined {
  if (code === null) return undefined;
  return WINDOWS_EXIT_MEANINGS[code >>> 0];
}

/**
 * Put together an "exit status" log fragment: `code=3221225477 (0xC0000005 access violation), signal=null` .
 *
 * The hexadecimal form and meaning only appear once here, and the crash log and the circuit breaker log are shared to
 * avoid drifting due to a copy of each.
 * @param code - exit code; null means terminated by signal.
 * @param signal - Termination signal; normal exit is null.
 * @returns can be directly spelled into a line of text in the log.
 */
export function describeExit(code: number | null, signal: NodeJS.Signals | null): string {
  return `code=${String(code)}${describeCodeDetail(code)}, signal=${String(signal)}`;
}

/** Bracket description of the exit code: Only hexadecimal is added when the shape is like NTSTATUS. When the meaning is not included, only hexadecimal is left. */
function describeCodeDetail(code: number | null): string {
  if (code === null) return '';
  const unsigned = code >>> 0;
  if (unsigned < 0x80000000) return '';
  const hex = `0x${unsigned.toString(16).toUpperCase()}`;
  const meaning = explainExitCode(code);
  return ` (${meaning ? `${hex} ${meaning}` : hex})`;
}

/**
 * Suggestions for handling the problem when the circuit breaker is broken.
 *
 * The causes of Windows and Linux are completely different: "Configure DISPLAY" on Windows is an invalid suggestion
 * (it has misled users who installed virtual monitors). The only thing that can work is changing the runtime or
 * pointing to a ready-made executable file; Linux only talks about the display environment.
 * @param platform - process platform; passed in by caller, this function does not read the global situation.
 * @returns A user-oriented suggestion text (including copyable environment variable names).
 */
export function crashLoopAdvice(platform: NodeJS.Platform): string {
  const raise = 'Alternatively, increase DSH_PET_RESTART_MAX_FAILURES and restart.';
  if (platform === 'win32') {
    return (
      'Try another Electron version: remove the directory shown by electron= in the log, set DSH_PET_ELECTRON_VERSION, and restart. ' +
      `Or set DSH_PET_ELECTRON_PATH to a working local electron.exe. ${raise}`
    );
  }
  if (platform === 'linux') {
    return `Check DISPLAY / WAYLAND_DISPLAY. Without a display, use Xvfb and set DSH_PET_DESKTOP_FORCE=1. ${raise}`;
  }
  return `Set DSH_PET_ELECTRON_PATH to a working local Electron executable. ${raise}`;
}

/**
 * Is it worth trying again using `--no-sandbox` instead.
 *
 * The judgment must be tightened, otherwise the real crash will be converted into "changing parameters": exit code 0
 * x80000003, stdout/stderr without a line, exit within 5 s, try only once, customize command without guessing. A
 * machine that cannot build a sandbox is a deterministic failure. Retrying 12 times will only flush the same line of
 * logs 12 times and then fuse; if it is really broken (there is output/running for a while), it will still retreat and
 * fuse, and will not be covered up. The host side has made a narrow switch for the GPU process sandbox. This article
 * deals with the earlier stage when JS was not even running yet.
 * @param input - Exit the scene this time; `sandboxOptOut` is given by the caller according to the environment, and
 * the pure function does not read the global situation.
 * @returns true means that next time start() should add `--no-sandbox` at the front of the parameter.
 */
export function shouldFallbackToNoSandbox(input: {
  code: number | null;
  sawOutput: boolean;
  ranMs: number;
  alreadyApplied: boolean;
  customCommand: boolean;
  sandboxOptOut: boolean;
}): boolean {
  if (input.alreadyApplied || input.customCommand || input.sandboxOptOut) return false;
  if (input.code === null || input.code >>> 0 !== SANDBOX_INIT_FAILED_CODE) return false;
  if (input.sawOutput) return false;
  return input.ranMs < SANDBOX_FALLBACK_WINDOW_MS;
}

/**
 * Does the output of the child process count as "the process is really running": pure blank does not count.
 *
 * Electron will write 2 bytes `\r\n` to stdout before abort in a low integrity environment; treating it as output will
 * make the fallback of {@link shouldFallbackToNoSandbox} never trigger (#286).
 * @param chunk - This pipeline data.
 * @returns is true when there is still content after removing the leading and trailing blanks.
 */
export function helperOutputIsMeaningful(chunk: string): boolean {
  return Boolean(chunk.trim());
}

/** Backoff base value (ms): The default value is 750, which is consistent with the old version of first delay, and DSH_PET_RESTART_BASE_MS is adjustable. */
export const RESTART_BASE_MS_DEFAULT = 750;

/** Meltdown threshold (number of consecutive crashes): Default 12, DSH_PET_RESTART_MAX_FAILURES adjustable. */
export const RESTART_MAX_FAILURES_DEFAULT = 12;

/** Non-negative integer env parsing (invalid/no fallback default), shared by restart parameter reading. */
export function envPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Wait for the child process to actually exit: Already exited (exitCode / signalCode has a value) → resolve
 * immediately, no monitoring; just wait for `exit` , `close` only means the stdio pipe is closed, much earlier than
 * the process actually exits; call onTimeout() on timeoutMs (caller upgrade SIGKILL), and then give
 * HELPER_STOP_GRACE_MS grace; if the grace does not exit until the end, resolve - the caller must not be hung
 * indefinitely.
 */
export function waitForChildExit(
  child: import('node:child_process').ChildProcess,
  timeoutMs: number,
  onTimeout: () => void,
): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    let giveUpTimer: NodeJS.Timeout | undefined;
    const done = (): void => {
      clearTimeout(killTimer);
      if (giveUpTimer) clearTimeout(giveUpTimer);
      child.removeListener('exit', done);
      resolve();
    };
    const killTimer = setTimeout(() => {
      onTimeout();
      giveUpTimer = setTimeout(done, HELPER_STOP_GRACE_MS);
      giveUpTimer.unref?.();
    }, timeoutMs);
    killTimer.unref?.();
    child.once('exit', done);
  });
}
