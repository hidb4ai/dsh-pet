/**
 * Standalone mode log export: persist to disk if a file is given, otherwise write-only console.
 *
 * The file logger of reuse host side in file mode - this logger will be hung on the fake ctx.logger, and the plugin
 * will share the same file outlet accordingly to avoid the two buffers from stepping on each other. It does not
 * determine the level and format (returned to ../host/log-file), and it does not determine whether it should be
 * recorded.
 * @module dsh-pet/src/standalone/logger
 */
import { createFileLogger } from '../host/log-file.ts';
import type { StandaloneLogger } from './context.ts';

/** Option to create standalone mode logger. */
export interface StandaloneLoggerOptions {
  /** persist to disk file; if not given, write-only console. */
  file?: string;
}

/** Creating a standalone mode logger. */
export function createStandaloneLogger(options: StandaloneLoggerOptions = {}): StandaloneLogger {
  if (options.file) {
    return createFileLogger({
      file: options.file,
      base: console,
      debugEnabled: process.env.DSH_PET_LOG_DEBUG === '1',
    });
  }
  const stamp = (): string => new Date().toISOString().replace('T', ' ').slice(0, 19);
  const write = (level: string, message: string): void => {
    console.log(`[dsh-pet-standalone ${stamp()}] ${level} ${message}`);
  };
  return {
    info: (message) => write('INFO ', message),
    warn: (message) => write('WARN ', message),
    error: (message) => write('ERROR', message),
    debug: (message) => {
      if (process.env.DSH_PET_STANDALONE_DEBUG === '1') write('DEBUG', message);
    },
  };
}
