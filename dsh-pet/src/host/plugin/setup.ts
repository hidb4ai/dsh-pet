/**
 * Host environment assembly: log exit, user directory, configuration path and in-process store.
 *
 * Only create objects, calculate paths, and register optional services, without starting any loops or touching the
 * network; the two places that require ctx (log cleanup effect, petApi7340 services) are registered here together. It
 * must always be true: the log is only created once - when reusing logger attached to standalone, a second one must
 * not be created.
 * @module dsh-pet/src/host/plugin/setup
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths';
import { listBalanceProviders, registerBalanceProvider } from '../balance/index.ts';
import { listVoiceProviders, registerVoiceProvider } from '../voice/registry.ts';
import { listSpeechProviders, registerSpeechProvider } from '../voice/speech-registry.ts';
import { listChatMemoryProviders, registerChatMemoryProvider } from '../chat-memory-provider.ts';
import { migrateUserConfig, type ConfigPaths } from '../config.ts';
import { createFileLogger, isFileLogger, setDefaultLogger, type FileLogger, type LoggerLike } from '../log-file.ts';
import { MenuRegistry } from '../menu.ts';
import { PACKAGE_MEMES_DIR, PACKAGE_ROOT } from '../paths.ts';
import { PlaybackStore } from '../playback.ts';
import { resolveAsset } from '../http.ts';
import { PollStateStore } from '../state.ts';
import { WorkStatusStore } from '../work-status.ts';
import type { StandaloneWhisperPolicy } from '../whisper-policy.ts';

/** Host context required during assembly: only three capabilities: logger / effect / provide. */
export interface HostSetupContext {
  /** host log (may have been replaced by standalone into file logger). */
  readonly logger?: LoggerLike;
  /** Register the side effect that is automatically cleaned up with the plugin unmount. */
  effect(setup: () => (() => void) | void, label: string): void;
  /** Provide Cordis service to external parties. */
  provide(name: string, value: unknown): void;
}

/** The service provider and key used for standalone mode balance inquiry (provided by standaloneAi service of standalone). */
export interface StandaloneBalanceAuth {
  /** The balance service provider id selected on the settings page; an empty string means it is not selected. */
  provider: string;
  /** The key saved in the settings page; an empty string means it is not saved. */
  apiKey: string;
}

/** Assembly product: apply Object shared by subsequent logic and route layer. */
export interface HostSetup {
  /** The data root of this plugin (configuration and user assets converge here) */
  readonly userRoot: string;
  /** Plugin log export (file + terminal) */
  readonly log: FileLogger;
  /** Configure path set */
  readonly configPaths: ConfigPaths;
  /** User main configuration path */
  readonly userConfigPath: string;
  /** File pet directory */
  readonly petConfigDir: string;
  /** User animation directory */
  readonly thumbUserRoot: string;
  /** User meme directory */
  readonly memesUserRoot: string;
  /** Meme directory chain */
  readonly memeDirsFor: (assetRoot: string) => string[];
  /** Soft host optional service */
  readonly optionalService: (name: string) => unknown;
  /** Whisper authorization strategy in standalone mode */
  readonly standaloneAiPolicy: () => StandaloneWhisperPolicy | undefined;
  /** Balance voucher in standalone mode; DSH host is undefined → the balance is currentSelection and credential store. */
  readonly standaloneAiBalance: () => StandaloneBalanceAuth | undefined;
  /** polling snapshot */
  readonly state: PollStateStore;
  /** Third-party menu register table */
  readonly menuRegistry: MenuRegistry;
  /** Play record table */
  readonly playback: PlaybackStore;
  /** Working status snapshot */
  readonly workStatus: WorkStatusStore;
  /** Pinned session for external writing id */
  readonly EXTERNAL_WORK_SESSION: string;
  /** Advance external write sequence number */
  readonly nextExternalWorkSeq: () => number;
}

/**
 * Create host runtime object.
 * @param ctx - host context (the one apply received).
 * @returns log, path, store and two utility functions.
 */
export function createHostSetup(ctx: HostSetupContext): HostSetup {
  // User data root: Configuration and user assets are unified here (the expansion package creates its own directory according to <plugin id>)
  const dshHome = resolveDshHome();

  const userRoot = join(dshHome, 'dsh-pet');

  // Unified log export (single file, truncated by size, see ./log-file): Desktop version DSH has no console,
  // ctx.logger write-only stdout is equivalent to discarding troubleshooting information; base retains terminal
  // output. standalone must reuse when its own file logger is mounted on ctx.logger, otherwise the buffering and
  // truncation of the two loggers will write the same file and step on each other.
  const reusedLog = isFileLogger(ctx.logger) ? ctx.logger : undefined;

  const log =
    reusedLog ??
    createFileLogger({
      file: join(userRoot, 'logs.txt'),
      base: ctx.logger,
      debugEnabled: process.env.DSH_PET_LOG_DEBUG === '1',
    });

  // Pure modules (./config, ./chat, ./whisper) cannot get ctx.logger, use this default export persist to disk
  setDefaultLogger(log);

  // It is only responsible for cleanup when it is created by itself: logger of reuse is managed by standalone/app lifecycle, and the plugin unmount should not turn it off.
  if (!reusedLog) {
    ctx.effect(
      () => () => {
        void log.flush();
        log.dispose();
      },
      'dsh-pet: log file',
    );
  }

  /**
   * Softly retrieve the optional service provided by the host (`ctx.get(name, required)` semantics of DSH: undefined
   * is returned if missing, not thrown).
   *
   * `ctx.xxx` cannot be read directly: ctx of DSH is strictly getter. Services that have not been written into inject
   * will throw an exception instead of returning undefined - standaloneAi / shutdownApp unique to standalone mode are
   * not entered into inject, and naked reading will whisper tick each tick. On error, /quit returns 500 instead of
   * {canQuit:false}. fake ctx in the test does not have get, just set fallback as an attribute to read.
   */
  const optionalService = (name: string): unknown => {
    const get = (ctx as { get?: (n: string, required?: boolean) => unknown }).get;
    if (typeof get === 'function') return get.call(ctx, name, false);
    return (ctx as unknown as Record<string, unknown>)[name];
  };

  /** Whisper authorization policy in standalone mode (optional capability): DSH host is undefined → fallback to only see pet.whisperEnabled. */
  const standaloneAiPolicy = (): StandaloneWhisperPolicy | undefined =>
    optionalService('standaloneAi') as StandaloneWhisperPolicy | undefined;

  /** Balance voucher in standalone mode (optional capability): DSH in the host is undefined → fallback to the model service provider with credential store. */
  const standaloneAiBalance = (): StandaloneBalanceAuth | undefined => {
    const service = optionalService('standaloneAi') as { balanceAuth?: () => StandaloneBalanceAuth } | undefined;
    return service?.balanceAuth?.();
  };

  // User main configuration (editable layer) and file pet directory; configuration reading/merging goes to
  // readAllConfig (./config). The main configuration is JSONC (main-config.jsonc) - the same name and format as the
  // default config.jsonc in the package: "Synchronization" writes the original text with annotations, and the
  // extension truthfully reflects the content (main-config.json read-only fallback + start migration)
  const userConfigPath = join(userRoot, 'main-config.jsonc');

  const legacyUserConfigPath = join(userRoot, 'main-config.json');

  const petConfigDir = join(userRoot, 'pet');

  // Configuration path set (only input for readAllConfig: built-in default + user main configuration + file pet directory)
  const configPaths: ConfigPaths = {
    defaultFile: join(PACKAGE_ROOT, 'assets', 'config.jsonc'),
    userFile: userConfigPath,
    legacyUserFile: legacyUserConfigPath,
    petDir: petConfigDir,
  };

  // One-time migration for old users: main-config.json → main-config.jsonc (rename, the content will be unchanged; if
  // the new file already exists, the old file will not be moved). The failure does not affect the operation - the read
  // side has a fallback for the old path.
  migrateUserConfig(configPaths, (msg) => log.info('[dsh-pet] ' + msg));

  // User animation directory (thumb takes priority over the asset in the package when playing; webm puts main-animation/webm/, mov (macOS customized) puts main-animation/mov/)
  const thumbUserRoot = join(userRoot, 'main-animation');

  // User meme directory (whisper/pictures accompanying conversations: take priority over assets/memes in the package, no need to change the package when adding pictures)
  const memesUserRoot = join(userRoot, 'memes');

  /**
   * The meme directory chain has the same ownership semantics as the animation asset (/ thumb): if
   * `pet/<asset-root>-memes/` exists, only check it; otherwise, the user directory takes precedence and the fallback in the
   * package is given. The pool (readMemePool) and route (/pic/memes) must use the same function, otherwise the name
   * route that can be selected in the pool cannot be obtained, and the bubble map will be broken. The asset root comes
   * from the URL segment and must pass through resolveAsset first to avoid the backslash decoded by %5 C on Windows
   * from escaping the user root.
   */
  const memeDirsFor = (assetRoot: string): string[] => {
    const own = resolveAsset(petConfigDir, assetRoot + '-memes');
    if (own !== undefined && existsSync(own)) return [own];
    return [memesUserRoot, PACKAGE_MEMES_DIR];
  };

  // Polling status (/state): The only data source for frontend 1 s polling (balance/work status/notifications/pet
  // talk). All writes go to state.writeSection / writePet (unified updates to counter).
  const state = new PollStateStore();

  // The third-party right-click menu register table: process memory state, does not persist to disk, and will be empty
  // after restart. The register table writes sections.menu of S; the click event does not enter S - it is a trigger,
  // not a state, and it is consumed when reading / menu/events.
  const menuRegistry = new MenuRegistry();

  // External Cordis service (host side): It has the same name as petApi7340 on the page side, but it belongs to two
  // containers and is neither visible nor overwritten by each other. Only expose register (return the logout function,
  // cooperate with ctx.effect to automatically clean up when unmounting) and list (for troubleshooting); do not expose
  // unregister: logout returns the value to prevent any plugin from being able to log out other people's provider.
  ctx.provide('petApi7340', {
    balance: {
      register: registerBalanceProvider,
      list: listBalanceProviders,
    },
    // Voice: The third party registers its own synthesis implementation. If it is not empty, synthesis will use it,
    // and if it is empty, it will use the built-in edge. Similarly, only register (return disposer) and list are
    // given, but unregister is not given.
    voice: {
      register: registerVoiceProvider,
      list: listVoiceProviders,
    },
    // Identification: A slot that is symmetrical to synthesis; after registering / voice/hear, just use it and no longer look at the speechToText that comes with the host.
    speech: {
      register: registerSpeechProvider,
      list: listSpeechProviders,
    },
    // Memory: The third party registers its own long-term memory backend (single slot); only gives register and list, logs out and returns the value.
    memory: {
      register: registerChatMemoryProvider,
      list: listChatMemoryProviders,
    },
  });

  // Playback record table (issue #122 item 3): state machine driven by renderer report + waiter. It has nothing to do
  // with S: the playback record is a per-caller resource (only the caller that initiated the playback request cares
  // and has a lifecycle). Inserting 1 s global broadcast will make each window pay traffic for each function.
  const playback = new PlaybackStore();

  // Working status linkage snapshot (/work-status endpoint response, browser 1 s polling): state = current active
  // status (null = idle),
  // task = Current task details. Both state and task are stored by session - the global single value will cause the
  // details of a task to be displayed along with all subsequent session activities (issue #59). The bubble text
  // is not here: the browser reads the configuration events.workStatusTexts. In-process memory state: Restart and
  // return to idle; updated every time there is an actual state change in session events.
  const workStatus = new WorkStatusStore();

  /** External write slot: fixed session id, the last writer takes effect; no multi-writer arbitration/lease/session management is performed */
  const EXTERNAL_WORK_SESSION = 'api';

  let externalWorkSeq = 0;

  /** Advance the external write sequence number and return the new value: Each time an external write occurs, advance one beat, and the front end will judge whether it is a new write based on this. */
  const nextExternalWorkSeq = (): number => (externalWorkSeq += 1);

  return {
    userRoot,
    log,
    configPaths,
    userConfigPath,
    petConfigDir,
    thumbUserRoot,
    memesUserRoot,
    memeDirsFor,
    optionalService,
    standaloneAiPolicy,
    standaloneAiBalance,
    state,
    menuRegistry,
    playback,
    workStatus,
    EXTERNAL_WORK_SESSION,
    nextExternalWorkSeq,
  };
}
