/**
 * Standalone mode sets the verification and whitelist of the interface: shared by the HTTP layer and single-process
 * entry point.
 *
 * Does not rely on any model backend, making it easy to test when there is no AI client; it is not responsible for
 * persistence. Must always be true: only known fields are allowed, the key will never appear in the whitelist output.
 * @module dsh-pet/src/standalone/settings
 */
import type { ModelDiscoveryInput, ModelDiscoveryResult } from './ai-provider/types.ts';
import { z } from 'zod';

/** Set the external shape of the service without binding the specific model backend. */
export interface StandaloneSettingsService {
  /** Read current settings. */
  getSettings(): unknown;
  /** Save settings and return to new view. */
  saveSettings(input: unknown): Promise<unknown>;
  /** Optional: Verify the connection with a single request. */
  testConnection?(input: {
    protocol?: string;
    baseUrl?: string;
    model?: string;
    apiKey?: string;
  }): Promise<{ ok: boolean; message: string; reply?: string }>;
  /** Optional: Pull endpoint declaration available models. */
  discoverModels?(input: ModelDiscoveryInput): Promise<ModelDiscoveryResult>;
  /** Optional: Check the balance according to the saved service provider and key. */
  queryBalance?(): Promise<unknown>;
}

/** Verification of interface addresses: only clean HTTP or HTTPS addresses are allowed, and credentials are not put into URL. */
const endpoint = z
  .string()
  .max(2048)
  .refine((value) => {
    if (value === '') return true;
    try {
      const url = new URL(value);
      return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash;
    } catch {
      return false;
    }
  }, '接口地址必须是 HTTP(S) 地址，且不能含账号、查询参数或片段');
/** Contract for setting patches: Unknown fields are always rejected. */
const settingsSchema = z
  .object({
    protocol: z.enum(['openai-compatible', 'anthropic']).optional(),
    baseUrl: endpoint.optional(),
    model: z.string().max(200).optional(),
    /** Length only; the value enumeration is checked by the persistence verification of ai-config.ts to avoid writing a list in two places. */
    balanceProvider: z.string().max(40).optional(),
    apiKey: z.string().max(8192).optional(),
    clearApiKey: z.boolean().optional(),
    automaticWhispers: z.boolean().optional(),
    whisperIntervalSec: z.number().int().min(60).max(86400).optional(),
    maxTokens: z.number().int().min(128).max(4096).optional(),
    timeoutMs: z.number().int().min(1000).max(60000).optional(),
  })
  .strict();

/** Verification settings patch. */
export function validateSettings(input: unknown): z.infer<typeof settingsSchema> {
  const result = settingsSchema.safeParse(input);
  if (!result.success)
    throw new Error(
      'Invalid settings: check the protocol, endpoint, interval (at least 60 seconds) and output limit (128-4096)',
    );
  return result.data;
}

/** Whitelist of fields that can appear in responses. */
const publicNames = [
  'protocol',
  'baseUrl',
  'model',
  'balanceProvider',
  'automaticWhispers',
  'whisperIntervalSec',
  'maxTokens',
  'timeoutMs',
  'hasKey',
] as const;
/** Filter out public setting fields. */
export function publicSettings(input: unknown): Record<string, unknown> {
  if (input === null || typeof input !== 'object') return {};
  const record = input as Record<string, unknown>;
  return Object.fromEntries(
    publicNames
      .filter((name) => Object.prototype.hasOwnProperty.call(record, name))
      .map((name) => [name, record[name]]),
  );
}
