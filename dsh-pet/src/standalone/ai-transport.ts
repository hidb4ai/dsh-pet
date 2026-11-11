/**
 * Standalone mode model transport layer: encapsulates streaming calls of OpenAI compatible and Anthropic protocols.
 *
 * It is not responsible for setting validation and rate limiting (see ai-provider), nor is it responsible for
 * selecting models. Must always be true: requests can only be sent to the endpoint inferred from the configuration;
 * the authentication header is reconstructed by this layer and never relies on credentials inferred by SDK from the
 * environment or configuration directory.
 * @module dsh-pet/src/standalone/ai-transport
 */
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import type { StandaloneAiSettings } from './ai-config.ts';

/** The shape of fetch is convenient for testing and replacement. */
export type AiFetch = typeof globalThis.fetch;
/** A plain text message. */
export interface AiTextMessage {
  role: 'user' | 'assistant';
  content: string;
}
/** System prompts and message sequence for a request. */
export interface AiRequest {
  system: string;
  messages: AiTextMessage[];
}
/** Transfer event: only text increment and reject flag. */
export type AiTransportEvent = { text?: string; refusal?: boolean };
/** Silence logger for SDK to avoid writing request details to the log. */
const quiet = { debug() {}, info() {}, warn() {}, error() {} };

/**
 * Reconstruct fetch wrapper of request target and authentication header.
 * @param settings - off-the-shelf configuration.
 * @param fetcher - underlying fetch.
 * @returns is only allowed to configure the endpoint through fetch .
 */
export function isolatedFetch(settings: Readonly<StandaloneAiSettings>, fetcher: AiFetch): AiFetch {
  // The endpoint is deduced from the configuration. The address spelled out by SDK must be hit one by one, otherwise it will be rejected.
  const base = settings.baseUrl.replace(/\/+$/, '');
  const expected = base + (settings.protocol === 'anthropic' ? '/v1/messages' : '/chat/completions');
  return async (url, init) => {
    const beta =
      settings.protocol === 'anthropic' &&
      new URL(base).origin === 'https://api.anthropic.com' &&
      settings.model === 'claude-opus-5-5';
    const urlStr = String(url);
    const validOpenAi =
      settings.protocol === 'openai-compatible' &&
      (urlStr === expected || urlStr === base + '/chat/completions' || urlStr === base + '/v1/chat/completions');
    const validAnthropic =
      settings.protocol === 'anthropic' &&
      (urlStr === expected + (beta ? '?beta=true' : '') ||
        urlStr === base + '/messages' ||
        urlStr === base + '/v1/messages' + (beta ? '?beta=true' : ''));
    if (!validOpenAi && !validAnthropic) throw new Error('Unexpected standalone AI endpoint.');
    // All headers are reconstructed by this layer: SDK may inherit custom authentication headers from the environment even if an explicit key has been given.
    const headers = new Headers({ 'content-type': 'application/json', accept: 'application/json' });
    if (settings.protocol === 'anthropic') {
      headers.set('x-api-key', settings.apiKey);
      headers.set('anthropic-version', '2023-06-01');
      if (new URL(base).origin === 'https://api.anthropic.com' && settings.model === 'claude-opus-5-5') {
        // Server-side fallback beta is enabled only for first-party Opus, third-party endpoints should not receive this header.
        headers.set('anthropic-beta', 'server-side-fallback-2026-07-01');
      }
    } else headers.set('authorization', `Bearer ${settings.apiKey}`);
    return fetcher(url, { method: 'POST', body: init?.body, headers, signal: init?.signal, redirect: 'error' });
  };
}

/**
 * Call the official SDK according to the protocol, and output text increment and rejection events.
 * @param settings - off-the-shelf configuration.
 * @param request - Normalized request.
 * @param signal - Cancel signal.
 * @param fetcher - underlying fetch.
 * @returns Asynchronous sequence of text increments.
 * Thrown when the @throws endpoint does not match or the SDK call fails.
 */
export async function* sdkTextStream(
  settings: Readonly<StandaloneAiSettings>,
  request: AiRequest,
  signal: AbortSignal,
  fetcher: AiFetch,
): AsyncIterable<AiTransportEvent> {
  // SDK’s built-in retries and logs will bypass the boundary control of this layer and be turned off.
  const shared = {
    apiKey: settings.apiKey,
    baseURL: settings.baseUrl.replace(/\/+$/, ''),
    maxRetries: 0,
    timeout: settings.timeoutMs,
    fetch: isolatedFetch(settings, fetcher),
    logger: quiet,
    logLevel: 'off' as const,
  };
  if (settings.protocol === 'openai-compatible') {
    const client = new OpenAI({ ...shared, organization: null, project: null, webhookSecret: null });
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      ...(request.system ? [{ role: 'system' as const, content: request.system }] : []),
      ...request.messages,
    ];
    const stream = await client.chat.completions.create(
      { model: settings.model, messages, stream: true, max_tokens: settings.maxTokens, n: 1 },
      { signal },
    );
    for await (const event of stream) {
      const delta = event.choices.find((choice) => choice.index === 0)?.delta;
      if (delta?.refusal) yield { refusal: true };
      if (delta?.content) yield { text: delta.content };
    }
    return;
  }
  // Explicitly blanking authToken blocks SDK from resolving credentials from the environment, OAuth, or configuration directories.
  const client = new Anthropic({ ...shared, authToken: null, webhookKey: null });
  const opus = settings.model === 'claude-opus-5-5';
  const firstParty = new URL(settings.baseUrl).origin === 'https://api.anthropic.com';
  const parameters = {
    model: settings.model,
    max_tokens: settings.maxTokens,
    system: request.system,
    messages: request.messages,
    stream: true as const,
    ...(opus ? { thinking: { type: 'adaptive' as const }, output_config: { effort: 'low' as const } } : {}),
  };
  const stream =
    opus && firstParty
      ? await client.beta.messages.create(
          { ...parameters, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' },
          { signal },
        )
      : await client.messages.create(parameters, { signal });
  for await (const event of stream) {
    if (event.type === 'message_delta' && event.delta.stop_reason === 'refusal') yield { refusal: true };
    // Only forward incremental text: Repeated forwarding of accumulated content and thinking blocks will cause the caller to get duplicate text.
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') yield { text: event.delta.text };
  }
}

/** Determine whether authentication failed. */
export function isAuthenticationFailure(error: unknown): boolean {
  return (
    error instanceof OpenAI.AuthenticationError ||
    error instanceof OpenAI.PermissionDeniedError ||
    error instanceof Anthropic.AuthenticationError ||
    error instanceof Anthropic.PermissionDeniedError
  );
}
/** Determining whether rate limiting failed. */
export function isRateLimitFailure(error: unknown): boolean {
  return error instanceof OpenAI.RateLimitError || error instanceof Anthropic.RateLimitError;
}
