/**
 * AI setup model in standalone mode: verification, desensitization and assembly of finished configuration.
 *
 * Responsible for verifying the caller patch to the finished configuration, and keeping the key only in the local
 * configuration file; not responsible for model requests (see ai-provider), nor for file permissions and atomic writes
 * (see ai-storage). It must always be true: only the desensitized view is returned externally, and the settings in the
 * memory are not updated when persistence fails.
 * @module dsh-pet/src/standalone/ai-config
 */
import { z } from 'zod';
import { readAiSettings, writeAiSettings } from './ai-storage.ts';

/**
 * Optional service providers for balance query. An empty string means no query. `deepseek-account` is not among them:
 * it reads the login status of DSH. There is no account service in standalone mode. If you choose it, you will only
 * get credential-missing.
 */
export const BALANCE_PROVIDERS = ['', 'deepseek-official', 'opencode-go', 'commandcode'] as const;

/** Externally visible setting view: the key is only represented by hasKey; whether AI is available only depends on whether the address, model and key are complete. */
export interface StandaloneAiPublicSettings {
  /** Interface protocol, only supports OpenAI compatible and Anthropic. */
  protocol: 'openai-compatible' | 'anthropic';
  /** Service provider interface address. If empty, it means it has not been configured yet. */
  baseUrl: string;
  /** The model identification is passed to the service provider as it is. */
  model: string;
  /** Which service provider interface should be used for balance query? An empty string means no query. Independent of baseUrl, balance definition for standalone mode reuse host side. */
  balanceProvider: (typeof BALANCE_PROVIDERS)[number];
  /** Legacy fields compatible with old configuration files no longer participate in any scheduling; they are retained only to allow old files to continue to pass strict verification. */
  automaticWhispers: boolean;
  /** Compatibility with legacy fields from old configuration files; whisper cycle only source is `eventsRefreshSec.whisper` of pet configuration. */
  whisperIntervalSec: number;
  /** The output upper limit of a single reply (max_tokens of the write request); the page is no longer exposed, and the stored value or default value is used. */
  maxTokens: number;
  /** Single request timeout, unit is milliseconds. */
  timeoutMs: number;
  /** Whether the key has been saved, the key itself will not be returned. */
  hasKey: boolean;
}
/** Internal out-of-the-box configuration: Replace plaintext keys on public view, and enable bits reserved for file compatibility only. */
export type StandaloneAiSettings = Omit<StandaloneAiPublicSettings, 'hasKey'> & {
  apiKey: string;
  /** Compatible with the legacy fields of the old configuration file, they are always true; false in the old file will be overwritten after being read. */
  enabled: boolean;
};

/** Default resolved configuration; AI remains off when not configured. */
export const DEFAULT_AI_SETTINGS: Readonly<StandaloneAiSettings> = Object.freeze({
  protocol: 'openai-compatible',
  baseUrl: '',
  model: '',
  balanceProvider: '',
  enabled: true,
  automaticWhispers: false,
  whisperIntervalSec: 300,
  maxTokens: 1024,
  timeoutMs: 30_000,
  apiKey: '',
});

/** Only empty or clean HTTP or HTTPS addresses are accepted; accounts, query parameters, and fragments are not allowed. */
function safeEndpoint(value: string): boolean {
  if (!value) return true;
  if (value !== value.trim() || /[\s\\]/.test(value)) return false;
  try {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash || value.includes('?') || value.includes('#')) {
      return false;
    }
    return ['http:', 'https:'].includes(url.protocol);
  } catch {
    return false;
  }
}

/** Check the control character to prevent invisible characters from being written into the configuration. */
function containsControlChar(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if ((code >= 0 && code <= 31) || code === 127) return true;
  }
  return false;
}

/** The field contract of the resolved configuration: the length, range and character set are determined here at once. */
const fields = {
  protocol: z.enum(['openai-compatible', 'anthropic']),
  baseUrl: z.string().max(2048).refine(safeEndpoint),
  model: z
    .string()
    .trim()
    .max(200)
    .refine((s) => !containsControlChar(s)),
  /** Service provider for balance inquiry; an empty string means no inquiry. */
  balanceProvider: z.enum(BALANCE_PROVIDERS),
  /** Only reserved for compatibility with old files: always write true when saving, availability is determined by address, model and key. */
  enabled: z.boolean(),
  automaticWhispers: z.boolean(),
  whisperIntervalSec: z.number().int().min(60).max(86400),
  maxTokens: z.number().int().min(128).max(4096),
  timeoutMs: z.number().int().min(1000).max(60_000),
  apiKey: z
    .string()
    .max(4096)
    .refine((s) => !containsControlChar(s) && !/\s/.test(s)),
};
/** Complete verification of persist to disk contents. */
const persistedSchema = z.object(fields).strict();
/** The patch verification submitted on the settings page allows an additional clear key tag. */
const patchSchema = persistedSchema.partial().extend({ clearApiKey: z.boolean().optional() }).strict();

/**
 * Verify unknown input and merge into the previous resolved configuration.
 * @param input - The patch given by the caller may only contain some fields.
 * @param previous - The last finished configuration, used as a baseline for unprovided fields.
 * @returns The new resolved configuration after verification and merging.
 * The @throws field is out of bounds, or clear and write keys appear at the same time.
 */
export function validateSettings(input: unknown, previous: Readonly<StandaloneAiSettings>): StandaloneAiSettings {
  try {
    const patch = patchSchema.parse(input);
    // When clear and write appear at the same time, the intention is unclear and it is directly rejected.
    if (patch.clearApiKey && patch.apiKey) throw new Error('Conflicting key changes');
    const { clearApiKey, ...values } = patch;
    const apiKey = clearApiKey ? '' : values.apiKey || previous.apiKey;
    // The half-filled configuration is only temporarily unavailable and should not be rejected even for saving; the enable bit no longer has semantic meaning and will always be written back to true.
    return persistedSchema.parse({ ...previous, ...values, apiKey, enabled: true });
  } catch {
    throw new Error('Invalid standalone AI settings.');
  }
}

/** Remove the key and enable bit, only retain whether the key has been saved. */
function redact(settings: Readonly<StandaloneAiSettings>): StandaloneAiPublicSettings {
  const { apiKey, enabled, ...publicFields } = settings;
  // The enable bit is only reserved for old files and does not enter the external view; it is explicitly discarded after destructuring, otherwise lint will be treated as an unused variable.
  void enabled;
  return { ...publicFields, hasKey: apiKey.length > 0 };
}

/** When setting the storage read-write facade, the caller can only get the desensitized view. */
export interface AiConfigStore {
  /** Get the current resolved configuration (including key, used by this process only). */
  current(): Readonly<StandaloneAiSettings>;
  /** Get the masked view for setting page and route response. */
  publicSettings(): StandaloneAiPublicSettings;
  /** Verify and persist the patch, and return the new desensitized view. */
  save(input: unknown): Promise<StandaloneAiPublicSettings>;
}

/**
 * Creating settings store from native configuration.
 * @param home - DSH_HOME.
 * @returns settings storage.
 * @throws Thrown when the configuration file is unsafe or unreadable.
 */
export function createAiConfig(home: string): AiConfigStore {
  let settings: Readonly<StandaloneAiSettings> = DEFAULT_AI_SETTINGS;
  try {
    const loaded = readAiSettings(home);
    // The old configuration file does not have suffixed fields. The default value must be set first and then verified; otherwise, the strict verification will reject the entire file after the upgrade, and the standalone mode cannot be started.
    if (loaded !== undefined)
      settings = Object.freeze(
        validateSettings(persistedSchema.parse({ ...DEFAULT_AI_SETTINGS, ...loaded }), DEFAULT_AI_SETTINGS),
      );
  } catch {
    // The read failure indicates that the file permissions cannot be confirmed and would rather fail overall.
    throw new Error('Cannot securely load standalone AI settings.');
  }
  return {
    current: () => settings,
    publicSettings: () => redact(settings),
    async save(input) {
      const next = validateSettings(input, settings);
      try {
        writeAiSettings(home, next);
      } catch {
        throw new Error('Cannot securely save standalone AI settings.');
      }
      // Replace the settings in the memory only after the disk writing is successful.
      settings = Object.freeze(next);
      return redact(settings);
    },
  };
}
