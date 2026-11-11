/** Settings page readable native memory state; credentials not included in model configuration. */
import type { ChatMemoryConfig } from './chat-memory-config.ts';

/** Public model parameters filled in by user; key submitted via separate write request. */
export interface MemorySetupModels {
  baseUrl: string;
  model: string;
  embeddingBaseUrl: string;
  embeddingModel: string;
  embeddingDimension: number;
  /** The fixed dimension model can not send dimensions but still verify the actual output length. */
  embeddingSendDimensions?: boolean;
}

/** Polling snapshot of the native memory management interface. */
export interface MemorySetupStatus {
  available: boolean;
  stage: string;
  errorCode?: string;
  busy: boolean;
  canCancel: boolean;
  startedAt?: number;
  memoryReady: boolean;
  memoryEnabled: boolean;
  memoryRunning: boolean;
  configured: boolean;
  canRetry: boolean;
  retryDraft: boolean;
  models?: MemorySetupModels;
  serverUrl?: string;
  /** Only synchronize memory fields to avoid overwriting other unsaved settings in the page. */
  binding?: { chatMemory: ChatMemoryConfig; chatMemoryRounds: number };
}
