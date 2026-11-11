/**
 * Standalone mode stand-in for `@deepseek-ai/dsh-home-paths` .
 *
 * Directly transpose the plugin's own dshHomeDir to avoid the second set of DSH_HOME conventions. Therefore,
 * standalone mode and DSH run in the same home directory. Only effective in standalone mode builds, pointed to by
 * alias.
 * @module dsh-pet/src/standalone/shims/dsh-home-paths
 */

/** The transposition plugin's own home directory is parsed to ensure the same conventions as running in DSH. */
export { dshHomeDir as resolveDshHome } from '../../host/helper-process.ts';
