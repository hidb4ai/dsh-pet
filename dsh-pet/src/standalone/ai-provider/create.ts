/**
 * Assembly root of the independent AI service: initializes settings storage, maintains ready and paused states,
 * connects channel generation and connection testing to the facade.
 *
 * The request is not parsed (returned to ./request), the quota is not defined (returned to ./limits), and the channel
 * details are not written (returned to ./stream and ./test-connection). Must always be true: overall failure when
 * setting read-insecure does not enable old credentials in the environment.
 * @module dsh-pet/src/standalone/ai-provider/create
 */
import { type StandaloneLogger } from '../context.ts';
import { createAiConfig, type StandaloneAiPublicSettings } from '../ai-config.ts';
import type { AiRuntime, AiStore, StandaloneAiDependencies, StandaloneAiService } from './types.ts';
import { PROVIDER } from './limits.ts';
import { discoverModels } from './list-models.ts';
import { queryStandaloneBalance } from './balance.ts';
import { createTextStream } from './stream.ts';
import { testAiConnection } from './test-connection.ts';

/**
 * Save settings: When flying solo, abort the request in transit first. If it fails, it will be paused and will be
 * restored after the next save is successful.
 * @throws When the service has been released, another save is in progress, or storage layer verification/persist to
 * disk fails.
 */
async function saveSettings(runtime: AiRuntime, store: AiStore, input: unknown): Promise<StandaloneAiPublicSettings> {
  if (runtime.disposed) throw new Error('Standalone AI is disposed.');
  if (runtime.saving) throw new Error('Standalone AI settings are being saved.');
  runtime.saving = true;
  // Abort requests in transit during saving to prevent old settings from continuing to generate output.
  runtime.active?.abort();
  try {
    const result = await store.save(input);
    if (!runtime.disposed) runtime.paused = false;
    return result;
  } catch (error) {
    runtime.paused = true;
    throw error;
  } finally {
    runtime.saving = false;
  }
}

/**
 * Creating standalone mode AI service.
 * @param home - DSH_HOME.
 * @param logger - log export.
 * @param dependencies - Test injected transmissions and clocks.
 * @returns AI Service.
 * @throws Thrown when the settings cannot be read safely.
 */
export function createStandaloneAi(
  home: string,
  logger: StandaloneLogger,
  dependencies: StandaloneAiDependencies = {},
): StandaloneAiService {
  let store: AiStore;
  try {
    store = createAiConfig(home);
  } catch {
    logger.error('Cannot securely load standalone AI settings.');
    // When the persistence is damaged or the permissions are insecure, the old credentials in the environment cannot be enabled. It would rather fail overall.
    throw new Error('Cannot securely load standalone AI settings.');
  }
  const runtime: AiRuntime = {
    store,
    logger,
    fetcher: dependencies.fetch ?? globalThis.fetch.bind(globalThis),
    disposed: false,
    paused: false,
    saving: false,
    active: undefined,
    ready(): boolean {
      return (
        !runtime.disposed &&
        !runtime.paused &&
        !runtime.saving &&
        !!store.current().model &&
        !!store.current().baseUrl &&
        !!store.current().apiKey
      );
    },
  };
  const modelOf = (): string => store.current().model;

  return {
    currentSelection: () => ({ provider: PROVIDER, model: runtime.ready() ? modelOf() : '' }),
    listProviders: () => (runtime.ready() ? [{ id: PROVIDER, name: 'Standalone AI' }] : []),
    listModels: async (provider) =>
      runtime.ready() && provider === PROVIDER ? [{ id: modelOf(), name: modelOf() }] : [],
    resolveModelInfo: async (provider = PROVIDER, model = modelOf(), signal) =>
      runtime.ready() && !signal?.aborted && provider === PROVIDER && model === modelOf()
        ? { id: model, name: model }
        : undefined,
    stream: createTextStream(runtime),
    getSettings: () => store.publicSettings(),
    connectionForSetup: () => {
      const { protocol, baseUrl, model, apiKey } = store.current();
      return { protocol, baseUrl, model, apiKey };
    },
    saveSettings: (input) => saveSettings(runtime, store, input),
    isReady: () => runtime.ready(),
    balanceAuth: () => ({ provider: store.current().balanceProvider, apiKey: store.current().apiKey }),
    testConnection: (input, signal) =>
      runtime.disposed
        ? Promise.resolve({ ok: false, message: '服务已关闭' })
        : testAiConnection(runtime.fetcher, store.current(), input, signal),
    discoverModels: (input) =>
      runtime.disposed
        ? Promise.resolve({ ok: false, code: 'input', message: '服务已关闭' })
        : discoverModels(runtime.fetcher, store.current(), input),
    queryBalance: async () =>
      runtime.disposed
        ? { ok: false, provider: '', reason: 'unsupported' }
        : queryStandaloneBalance(store.current().balanceProvider, store.current().apiKey),
    dispose() {
      runtime.disposed = true;
      runtime.active?.abort();
    },
  };
}
