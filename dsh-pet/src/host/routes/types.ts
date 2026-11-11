/**
 * The dependency contract of the route layer: `apply` is constructed once when mounting, and each route module is
 * read-only for consumption.
 *
 * Explicit dependency is the whole meaning of this layer - route no longer "grabs" variables from the closure of
 * `apply` , so each domain module can be read, modified, and tested independently, and there is no need to modify the
 * configuration when changing route. Not responsible for lifecycle: the creation and destruction of store belongs to
 * `apply` , route is only called.
 * @module dsh-pet/src/host/routes/types
 */
import type { ChatMemoryMessage } from '../chat.ts';
import type { ConfigPaths } from '../config.ts';
import type { RouteResult } from '../http.ts';
import type { PetImageRef } from '../image-attachment.ts';
import type { LockStore } from '../lock.ts';
import type { FileLogger } from '../log-file.ts';
import type { MenuRegistry } from '../menu.ts';
import type { PlaybackStore } from '../playback.ts';
import type { PoseStore } from '../pose.ts';
import type { SleepStore } from '../sleep.ts';
import type { PollStateStore } from '../state.ts';
import type { VoiceTarget } from '../surface.ts';
import type { TodoStore } from '../todo/store.ts';
import type { HearService } from '../voice/hear.ts';
import type { VoiceService } from '../voice/speak.ts';
import type { WorkStatusStore } from '../work-status.ts';

/** The input of a route call: URL has been parsed, `rest` is the path after removing the prefix and decoding. */
export interface RouteInput {
  /** Complete request URL (including query string). */
  readonly url: URL;
  /** Remaining path (decoded) after removing `/dsh-pet-7340/` prefix. */
  readonly rest: string;
  /** HTTP method (uppercase). */
  readonly method: string;
  /** Request body text; only PUT/POST has a value. */
  readonly body?: string;
  /** caller disconnect signal: the pending route is cleaned up in advance accordingly. */
  readonly signal?: AbortSignal;
}

/** Whisper generation results shared with conversations. */
export type GeneratedReply =
  | { ok: true; text: string; image?: string }
  | {
      ok: false;
      reason: 'provider-missing' | 'generate-error' | 'unknown-pet' | 'unknown-image';
      message?: string;
    };

/** Pet locating result: if hit, the layer and entry will be given; if not hit, a response that can be returned directly will be given. */
export type PetLookup =
  | {
      ok: true;
      petId: string;
      entry: string;
      conf: Record<string, unknown>;
      pet: Record<string, unknown>;
    }
  | { ok: false; res: RouteResult };

/** Single route processing function: undefined is returned on a miss, and a response is returned on a hit. */
export type RouteHandler = (deps: PetRouteDeps, input: RouteInput) => Promise<RouteResult | undefined>;

/**
 * All external capabilities required by the route layer.
 *
 * The fields are divided into three categories: read-only path and configuration, and action functions already in the
 * process store and `apply` . The only one with a side effect is `nextExternalWorkSeq` : it advances the external
 * write sequence number and returns the new value.
 */
export interface PetRouteDeps {
  /** Managed by the DSH plugin lifecycle; standalone mode uses its own preparation entry point. */
  readonly memorySetup?: import('../../standalone/setup.ts').SetupService;
  /** Optional for older embedding hosts; the shipped host provides both. */
  readonly memoryStatus?: (petId: string) => Promise<unknown>;
  readonly syncMemory?: (petId: string) => Promise<void>;
  readonly listMemories?: (
    petId: string,
    cursor?: string,
  ) => Promise<import('../../shared/memory-library.ts').MemoryPage>;
  readonly inspectMemory?: (
    petId: string,
    id: string,
  ) => Promise<import('../../shared/memory-library.ts').MemoryEvidence>;
  readonly changeMemory?: (
    petId: string,
    change: import('../../shared/memory-library.ts').MemoryChange,
  ) => Promise<void>;
  /** Configuration paths: bundled defaults, user configuration and pet-pack directory. */
  readonly configPaths: ConfigPaths;
  /** Third-party right-click menu register table (process memory state). */
  readonly menuRegistry: MenuRegistry;
  /** Polling snapshot (sole data source for frontend 1 s polling). */
  readonly state: PollStateStore;
  /** Backlog (single JSON file, read-write serial). */
  readonly todos: TodoStore;
  /** Working status linkage snapshot. */
  readonly workStatus: WorkStatusStore;
  /** Fixed session id for external writing. */
  readonly EXTERNAL_WORK_SESSION: string;
  /** Return a lock response immediately when another session owns the pet. */
  readonly surfaceBlocked: (
    cfg: Record<string, Record<string, unknown>>,
    petId: string,
    params: URLSearchParams,
  ) => RouteResult | null;
  /** Same as above, judge according to petId. */
  readonly lockBlocked: (petId: string, params: URLSearchParams) => RouteResult | null;
  /** User main configuration path. */
  readonly userConfigPath: string;
  /** Request to reload desktop Helper: Whether to really restart, how to serialize and back off is decided by the desktop side (the caller only expresses the intention). */
  readonly requestRestart: () => Promise<void>;
  /** Press `?pet=` to locate the pet; missing parameters/unknown pets give a response that can be returned directly. */
  readonly requirePet: (
    params: URLSearchParams,
    cfg: () => Record<string, Record<string, unknown>>,
    opts?: { surface?: boolean },
  ) => PetLookup;
  /** Play record list. */
  readonly playback: PlaybackStore;
  /** User data root. */
  readonly userRoot: string;
  /** Lock occupied. */
  readonly lock: LockStore;
  /** Sleeping state (sleep/wake up driven by /sleep and /wake). */
  readonly sleep: SleepStore;
  /** Sleep gate: reject and play the reject line when sleeping and not holding the lock; release back to null. */
  readonly sleepBlocked: (petId: string, params: URLSearchParams) => RouteResult | null;
  /** Plugin log export (file + terminal). */
  readonly log: FileLogger;
  /** Minimal structure of host context: route only uses logger and llm services. */
  readonly ctx: { logger?: { warn?(message: string): void }; llm?: unknown };
  /** File pet directory (`pet/`). */
  readonly petConfigDir: string;
  /** Write the latest working status into the polling snapshot. */
  readonly publishWorkStatus: () => void;
  /** Advance the external write sequence number and return the new value (the front end determines whether it is a new beat based on this). */
  readonly nextExternalWorkSeq: () => number;
  /** Meme directory chain (same set of ownership semantics as / thumb). */
  readonly memeDirsFor: (assetRoot: string) => string[];
  /** Attitude report and storage. */
  readonly pose: PoseStore;
  /** Soft retrieval of host optional service (returns undefined if missing). */
  readonly optionalService: (name: string) => unknown;
  /** User animation directory. */
  readonly thumbUserRoot: string;
  /** User meme directory. */
  readonly memesUserRoot: string;
  /** Refresh balance (manual indicates user active trigger). */
  readonly refreshBalance: (manual?: boolean) => Promise<void>;
  /**
   * Generate a whisper using an explicit pool image when supplied; otherwise choose randomly or use text only
   * according to configuration.
   * Routes with `?surface=` pass voiceTo. For kind=whisper, voiceWhisperEnabled controls speech playback.
   */
  readonly publishWhisper: (
    petId: string,
    image?: string,
    voiceTo?: VoiceTarget,
    kind?: 'whisper' | 'manual',
  ) => Promise<GeneratedReply>;
  /** Read dialogue memory file. */
  readonly readMemory: () => Promise<Record<string, Record<string, { messages: ChatMemoryMessage[] }>>>;
  /** Dialogue memory file path. */
  readonly memoryPath: string;
  /** The number of rounds reserved for a single conversation. */
  readonly memoryRounds: (conf: Record<string, unknown>) => number;
  /** Chat with a local pet. Omitting image keeps the original text-only data path. */
  readonly chatWithPet: (petId: string, text: string, image?: PetImageRef) => Promise<GeneratedReply>;
  /** Delete pet chat history: omit ts to clear all rounds, or delete only the matching user/assistant pair. */
  readonly deleteHistory: (
    petId: string,
    ts?: readonly number[],
  ) => Promise<{ ok: true; removed: number } | { ok: false; reason: 'unknown-pet'; message: string }>;
  /** The remaining memory bucket of a deleted pet (this pet is no longer in the configuration). */
  readonly orphanHistory: () => Promise<{ entry: string; petId: string; messages: number; lastTs: number }[]>;
  /** Clear the history of all deleted pets. */
  readonly deleteOrphans: () => Promise<{ ok: true; pets: number; messages: number }>;
  /** User animation directory (by extension). */
  readonly userRootFor: (ext: string) => string;
  /** Animation directory in the package (by extension). */
  readonly assetRootFor: (ext: string) => string;
  /** Speech synthesis service (verification, queuing, caching and upstream calls are all included). */
  readonly voice: VoiceService;
  /** Speech recognition service; the host returns unsupported when voice input is not enabled. */
  readonly speech: HearService;
}
