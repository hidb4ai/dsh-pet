/**
 * Public exits for desktop Helper process: location, startup, pipeline protocol and restart strategy.
 *
 * Only re-export, no logic; sub-modules are separated according to the reason of change./helper/. This must always be
 * true: the Helper capability can only be used outside the module through this file, and the process cannot be
 * bypassed.
 * @module dsh-pet/src/host/helper-process
 */
export {
  defaultElectronExe,
  defaultHelperMain,
  defaultLaunch,
  dshHomeDir,
  electronLandingDir,
  ensureElectronDownload,
  hasGraphicalDisplay,
  packageRoot,
  readElectronVersion,
  resolveElectronPath,
} from './helper/electron.ts';
export type { ElectronDownloadLog, EnsureElectronOptions } from './helper/electron.ts';
export { BRIDGE_PREFIX } from './helper/bridge.ts';
export type { BridgeHandler, BridgeRequest, BridgeResponse } from './helper/bridge.ts';
export {
  HELPER_STABLE_MS,
  HELPER_STOP_GRACE_MS,
  HELPER_STOP_TIMEOUT_MS,
  crashLoopAdvice,
  describeExit,
  helperRunIsStable,
  restartBackoffDelayMs,
  shouldCircuitBreak,
  shouldFallbackToNoSandbox,
} from './helper/restart.ts';
export { HelperProcess, helperLaunchArgs, helperSpawnEnv } from './helper/child.ts';
