/**
 * The external shape of the independent AI service: service capabilities and dependencies during creation.
 *
 * Pure type, no implementation. Must always be true: fields are all readonly, caller must not overwrite service
 * internal state.
 * @module dsh-pet/src/standalone/ai-provider/types
 */
import { type createAiConfig, type StandaloneAiPublicSettings, type StandaloneAiSettings } from '../ai-config.ts';
import { type AiFetch } from '../ai-transport.ts';
import { type StandaloneLogger } from '../context.ts';
import { type BalanceResult } from '../../host/balance/index.ts';

/** Set storage: return shape of `createAiConfig`. */
export type AiStore = ReturnType<typeof createAiConfig>;

/** Input of "Test Connection": Any item defaults to the current setting. */
export interface TestConnectionInput {
  protocol?: string;
  baseUrl?: string;
  model?: string;
  apiKey?: string;
}

/** The result of "Test Connection": message is the reason for failure. */
export interface TestConnectionResult {
  ok: boolean;
  message: string;
  reply?: string;
  reason?: 'authentication' | 'quota' | 'not_found' | 'connection' | 'timeout' | 'unknown';
}

/** Input of "Pull Model": If any item is defaulted, the current settings will be used; empty character strings are regarded as unfilled. */
export interface ModelDiscoveryInput {
  protocol?: string;
  baseUrl?: string;
  apiKey?: string;
}

/** An optional model for endpoint declarations. */
export interface DiscoveredModel {
  id: string;
  name: string;
  /** Omission means the service is undeclared and unrecognized; unknown capabilities are not considered supported as verified. */
  kind?: 'generation' | 'embedding' | 'other';
}

/** The result of "Pull model": when it fails, code is stable and message can be displayed directly. */
export type ModelDiscoveryResult =
  { ok: true; models: DiscoveredModel[] } | { ok: false; code: string; message: string };

/**
 * Generate running state shared by channel and connection test: variable fields are concentrated in the assembly root,
 * and submodules read-only write their own share.
 *
 * `ready()` is the only available judgment for the whole service (not released, not paused, not being saved, and the
 * settings are complete). The two sub-modules must be asked again every time they are requested.
 */
export interface AiRuntime {
  readonly store: AiStore;
  readonly logger: StandaloneLogger;
  readonly fetcher: AiFetch;
  ready(): boolean;
  /** Released: All subsequent requests and saves will be rejected. */
  disposed: boolean;
  /** Set after authentication failure or saving failure, and will be released only after saving is successful. */
  paused: boolean;
  /** Saving in progress: no request can be initiated during this period. */
  saving: boolean;
  /** Controller requested in transit; non-empty means busy. */
  active: AbortController | undefined;
}

/** External shape of standalone mode AI service. */
export interface StandaloneAiService {
  /** The currently selected service provider and model; the model is empty when it is not ready. */
  currentSelection(): { provider: string; model: string };
  /** Return the only standalone service provider when ready. */
  listProviders(): Array<{ id: string; name: string }>;
  /** Return the current model when ready, otherwise it is empty. */
  listModels(provider: string): Promise<Array<{ id: string; name: string }>>;
  /** Verify whether the requested model is the currently configured one. */
  resolveModelInfo(
    provider?: string,
    model?: string,
    signal?: AbortSignal,
  ): Promise<undefined | { id: string; name: string }>;
  /** Return text increments in an asynchronous sequence. */
  stream(options: unknown): AsyncIterable<{ type: 'text'; text: string }>;
  /** Get the current settings after desensitization. */
  getSettings(): StandaloneAiPublicSettings;
  /** Internal setup transaction only; includes credentials and must never be serialized in HTTP responses. */
  connectionForSetup(): Pick<StandaloneAiSettings, 'protocol' | 'baseUrl' | 'model' | 'apiKey'>;
  /** Verify and save the settings. After success, the suspension caused by authentication failure will be released. */
  saveSettings(input: unknown): Promise<StandaloneAiPublicSettings>;
  /** Verify address, model and key with one minimum request. */
  testConnection(input: TestConnectionInput, signal?: AbortSignal): Promise<TestConnectionResult>;
  /** Pull the endpoint declaration available models according to the protocol; when it fails, code is stable and message can be displayed directly. */
  discoverModels(input: ModelDiscoveryInput): Promise<ModelDiscoveryResult>;
  /** Query the balance according to the service provider selected in the settings; when no key is selected or the key is missing, an explicit failure is returned and numbers are never forged. */
  queryBalance(): Promise<BalanceResult>;
  /** The service provider and key used for balance query; it is used for balance polling on the host side and does not enter the external setting view. */
  balanceAuth(): { provider: string; apiKey: string };
  /** Are all conditions for initiating the request met? */
  isReady(): boolean;
  /** Terminate in-flight request and release service. */
  dispose(): void;
}

/** Injectable transport, test replacement only; production uses official SDK. */
export interface StandaloneAiDependencies {
  /** Replace fetch to isolate the network. */
  fetch?: AiFetch;
}
