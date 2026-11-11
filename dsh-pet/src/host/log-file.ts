/**
 * Unified log persist to disk - The desktop version does not have a console, and all logs must have a file export.
 *
 * Background: `ctx.logger` write-only hosts stdout in the main process; when the node version runs `dsh` , it is in
 * the terminal, but the DSH desktop application does not have a terminal, and the logs are all lost (when the desktop
 * Helper crashes, the user only sees "the pet is missing"). We are not responsible for log content and format
 * decisions. Performance is the reason for its existence: the call is only done once push, and append can be batched
 * after accumulating enough records or at a certain point; the size check is only done once stat after flush (each
 * stat will become dozens of system calls per second); it is silent when writing to the disk fails - no more logs can
 * be logged if the log fails; there is an upper limit on memory (the oldest is lost after exceeding it). Batch
 * submission is written synchronously, so when exiting and dispose, you only need to add the text "out of buffer, not
 * yet submitted", and there is no need to guess whether the asynchronous write has been completed (the asynchronous IO
 * in exit will not be executed at all). A single file is truncated according to size and multiple copies are not
 * rotated: when it exceeds maxBytes, only the tail keepBytes is retained.
 * @module dsh-pet/src/host/log-file
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/** Log level (consistent with the fourth level of `ctx.logger` of DSH). */
export type LogLevel = 'info' | 'warn' | 'error' | 'debug';

/** The minimum interface consistent with the `ctx.logger` usage of DSH (each method can be defaulted). */
export interface LoggerLike {
  info?(message: string): void;
  warn?(message: string): void;
  error?(message: string): void;
  debug?(message: string): void;
}

/** File log export: Add a persist to disk handle and identity tag on top of LoggerLike. */
export interface FileLogger extends Required<LoggerLike> {
  /** Log file path (host determines whether it can be reused based on this to avoid two logger writing the same file) */
  readonly file: string;
  /** Identity mark: `isFileLogger` Use it to identify "This logger is already a file export" */
  readonly isFileLogger: true;
  /**
   * Write buffer to disk (and do size check). Safe to call repeatedly; concurrency calls share the same write. caller
   * should await it before the process exits.
   */
  flush(): Promise<void>;
  /** Stop the timer and rewrite the uncommitted log synchronously; subsequent recording will still persist to disk directly. */
  dispose(): void;
}

/** Determine whether an object is already a file logger created by this module (standalone/app will hang it on ctx.logger). */
export function isFileLogger(value: unknown): value is FileLogger {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { isFileLogger?: unknown; flush?: unknown; file?: unknown };
  return candidate.isFileLogger === true && typeof candidate.flush === 'function' && typeof candidate.file === 'string';
}

/** Options for createFileLogger; all optional, see constants below for default values. */
export interface FileLoggerOptions {
  /** Absolute path of the log file (the parent directory will be automatically created if it does not exist) */
  file: string;
  /** Original terminal/host logger: The log is forwarded to it at the same time, and it is still visible in the node version of the terminal. */
  base?: LoggerLike;
  /** Upper limit of single file, default 1 MiB */
  maxBytes?: number;
  /** The tail size retained after exceeding the upper limit, default 512 KiB */
  keepBytes?: number;
  /** Timing flush interval, default 1000 ms */
  flushIntervalMs?: number;
  /** flush immediately after saving enough, default 64 */
  flushThreshold?: number;
  /** The maximum number of buffered items in the memory (the oldest is exceeded), the default is 1000 */
  maxPending?: number;
  /** Whether the debug level persists to disk, the default is off (`DSH_PET_LOG_DEBUG=1` is on) */
  debugEnabled?: boolean;
  /** Time source (for test injection) */
  now?: () => Date;
}

/** The upper limit of a single file: 1 MiB. */
export const LOG_MAX_BYTES = 1024 * 1024;
/** Tail retained after truncation: 512 KiB. */
export const LOG_KEEP_BYTES = 512 * 1024;
/** Timing flush interval. */
export const LOG_FLUSH_MS = 1000;
/** flush immediately after saving enough. */
export const LOG_FLUSH_LINES = 64;
/** Memory buffer limit. */
export const LOG_MAX_PENDING = 1000;

/**
 * Desensitization before persist to disk: the token is equivalent to the login state, and cannot be written into the
 * file just because "a line of logs is conveniently recorded". Only deal with several forms that are known to appear
 * in the log, and would rather accidentally damage (code the value) than miss it.
 */
export function redactSensitive(text: string): string {
  return text
    .replace(/(x-dsh-pet-token["'\s:=]+)[A-Za-z0-9_-]{16,}/gi, '$1***')
    .replace(/(token["'\s:=]+)[A-Za-z0-9_-]{32,}/gi, '$1***')
    .replace(/(#token=)[A-Za-z0-9_-]{16,}/g, '$1***')
    .replace(/(DSH_PET_SITE_URL=)\S+/g, '$1***');
}

/** Retain the last `keepBytes` bytes. Truncation may split a multibyte character, which is acceptable for this log-only buffer. */
export function tailForTrim(content: Buffer, keepBytes: number): Buffer {
  if (content.length <= keepBytes) return content;
  return content.subarray(content.length - keepBytes);
}

/** The final form of a line of log: `<ISO time> [level] message` (the line breaks in the text are retained to make the stack readable). */
export function formatLogLine(level: LogLevel, message: string, now: Date): string {
  return `${now.toISOString()} [${level}] ${message}\n`;
}

/** Create a file log outlet: the log is forwarded to `base` at the same time, and persist to disk is processed according to the batch size and size limit. */
export function createFileLogger(options: FileLoggerOptions): FileLogger {
  const file = options.file;
  const maxBytes = options.maxBytes ?? LOG_MAX_BYTES;
  const keepBytes = Math.max(0, Math.min(options.keepBytes ?? LOG_KEEP_BYTES, maxBytes));
  const flushMs = options.flushIntervalMs ?? LOG_FLUSH_MS;
  const threshold = Math.max(1, options.flushThreshold ?? LOG_FLUSH_LINES);
  const maxPending = Math.max(threshold, options.maxPending ?? LOG_MAX_PENDING);
  const debugEnabled = options.debugEnabled ?? false;
  const now = options.now ?? (() => new Date());

  let pending: string[] = [];
  let dropped = 0;
  /** Text that has left pending and has not yet been submitted to the file; exit and dispose rely on it to be rewritten. */
  let activeChunk = '';
  let flushing: Promise<void> | null = null;
  let disposed = false;
  /** The directory is only created once (when flush is created for the first time); it will not be retried after failure, and the log will be downgraded silently. */
  let dirReady: Promise<void> | null = null;
  const ensureDir = (): Promise<void> =>
    (dirReady ??= mkdir(dirname(file), { recursive: true })
      .then(() => undefined)
      .catch(() => undefined));

  /** Take away the current buffer (including overflow prompt); after taking it out, pending is empty, and the text is kept by the caller. */
  const takePending = (): string => {
    const note = dropped > 0 ? formatLogLine('warn', `日志缓冲溢出，丢弃 ${dropped} 条`, now()) : '';
    const chunk = note + pending.join('');
    pending = [];
    dropped = 0;
    return chunk;
  };

  /** Submit activeChunk synchronously; after submission, this batch of text has nothing to do with memory, and the exit path will not be written repeatedly. */
  const commit = (): void => {
    const chunk = activeChunk;
    activeChunk = '';
    if (!chunk) return;
    try {
      appendFileSync(file, chunk, 'utf8');
    } catch {
      /* Disk writing fails silently: the log system cannot bring down the host due to disk problems */
    }
  };

  /** Exit the supplementary writing shared with dispose; the first run directory may not exist yet, so create the directory synchronously first. */
  const flushSync = (): void => {
    activeChunk += takePending();
    if (!activeChunk) return;
    try {
      mkdirSync(dirname(file), { recursive: true });
    } catch {
      /* If directory creation fails, subsequent writing will also fail and become silent. */
    }
    commit();
  };

  const push = (level: LogLevel, message: string): void => {
    if (level === 'debug' && !debugEnabled) return;
    // Forwarding to the original logger must be in its own try: Host logger throwing errors cannot affect persist to disk, let alone recursive logging.
    try {
      options.base?.[level]?.(message);
    } catch {
      /* Ignore: The log export itself is not allowed to become the source of the fault. */
    }
    pending.push(formatLogLine(level, redactSensitive(String(message)), now()));
    if (pending.length > maxPending) {
      // Discard the oldest batch: preserve memory during log storms, and also preserve the latest scene
      dropped += pending.length - maxPending;
      pending.splice(0, pending.length - maxPending);
    }
    // The exit cleanup of app after dispose will also record logs. At this time, there is no timer and exit hook, and only persist to disk can be synchronized.
    if (disposed) flushSync();
    else if (pending.length >= threshold) void flush();
  };

  const flush = async (): Promise<void> => {
    // Loop instead of "wait once and return": When the caller calls flush during the writing process, there may be
    // later lines in the buffer, and waiting for the current write to disk will keep them in the memory (shown as "the
    // last few logs are missing").
    for (;;) {
      if (flushing) {
        await flushing;
        continue;
      }
      if (pending.length === 0) return;
      activeChunk = takePending();
      flushing = (async () => {
        await ensureDir();
        commit();
        try {
          // Place the size check after flush, flush at most once for each stat: This is the key to "not touching the disk every time"
          const info = await stat(file);
          if (info.size > maxBytes) {
            const content = await readFile(file);
            // If dispose occurs during reading, the rewritten log is not in the snapshot, and overwriting it with old content will erase it.
            if (!disposed) await writeFile(file, tailForTrim(content, keepBytes));
          }
        } catch {
          /* Failure of truncation does not affect subsequent writing (flush will try again next time) */
        }
      })().finally(() => {
        flushing = null;
      });
      await flushing;
    }
  };

  const timer = setInterval(() => {
    void flush();
  }, flushMs);
  // Do not prevent the process from exiting: the host will exit when it needs to, and the last batch will be completed synchronously by the following exit hook.
  timer.unref?.();

  // Asynchronous IO in exit will not be executed and can only be rewritten synchronously; no truncation - it is not worth reading the file again on the exit path
  const onExit = (): void => flushSync();
  process.once('exit', onExit);

  return {
    file,
    isFileLogger: true,
    info: (message: string) => push('info', message),
    warn: (message: string) => push('warn', message),
    error: (message: string) => push('error', message),
    debug: (message: string) => push('debug', message),
    flush,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      clearInterval(timer);
      // Remove the hook first and then rewrite it synchronously: exit fallback is not needed after writing, and the logs recorded thereafter are persisted to disk by the disposed branch of push
      process.removeListener('exit', onExit);
      flushSync();
    },
  };
}

/**
 * Convenience wrapping on unattended paths (debug level controlled by environment variables). It is used by processes
 * such as `src/app/main.ts` that do not have `ctx.logger` (see the console wrapper of the app main process).
 */
export function createPlainFileLogger(file: string, base?: LoggerLike): FileLogger {
  return createFileLogger({
    file,
    base,
    debugEnabled: process.env.DSH_PET_LOG_DEBUG === '1',
  });
}

/**
 * Module-level default export - for pure modules that cannot get `ctx.logger` (./config, ./chat, ./whisper).
 *
 * These modules are pure functions, and there should not be a logger in the signature for an warning, but their warn is
 * also the only clue that desktop users can see. The host is `setDefaultLogger(log)` at the beginning of apply, and
 * then directly `defaultLog('warn', ...)` ; when there is no logger in a single test or very early stage, it returns
 * to console, and the behavior remains unchanged.
 */
let defaultLogger: LoggerLike | null = null;

/** Called by the host (apply / standalone / app) after getting the unified logger; null is passed to reset (for testing). */
export function setDefaultLogger(logger: LoggerLike | null): void {
  defaultLogger = logger;
}

/** Write a module-level log; return console when logger is not unified (debug is still controlled by environment variables). */
export function defaultLog(level: LogLevel, message: string): void {
  const sink = defaultLogger?.[level];
  if (sink) {
    sink.call(defaultLogger, message);
    return;
  }
  if (level === 'debug') {
    if (process.env.DSH_PET_LOG_DEBUG === '1') console.debug(message);
    return;
  }
  if (level === 'info') console.info(message);
  else if (level === 'warn') console.warn(message);
  else console.error(message);
}
