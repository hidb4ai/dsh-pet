/** 设置页可读取的本机记忆状态；模型配置中不包含凭据。 */
import type { ChatMemoryConfig } from './chat-memory-config.ts';

/** 用户填写的公开模型参数；密钥通过单独的写请求提交。 */
export interface MemorySetupModels {
  baseUrl: string;
  model: string;
  embeddingBaseUrl: string;
  embeddingModel: string;
  embeddingDimension: number;
}

/** 本机记忆管理界面的轮询快照。 */
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
  /** 只同步记忆字段，避免覆盖页面中尚未保存的其他设置。 */
  binding?: { chatMemory: ChatMemoryConfig; chatMemoryRounds: number };
}
