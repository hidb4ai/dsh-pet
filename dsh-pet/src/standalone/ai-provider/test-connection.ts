/**
 * "Test Connection" on the settings page: Use a minimum request to verify the address, model and key, and turn common
 * failures into actionable instructions.
 *
 * Do not reuse the formal channel: do not pollute the rate limiting window, busy status and pause mark, and the
 * timeout is also independent of 15 seconds. It does not determine whether the service has been released (returned to
 * ./create), nor does it verify whether the settings have been saved (the user may be filling in a form).
 * @module dsh-pet/src/standalone/ai-provider/test-connection
 */
import { DEFAULT_AI_SETTINGS, type StandaloneAiSettings } from '../ai-config.ts';
import { isAuthenticationFailure, isRateLimitFailure, sdkTextStream, type AiFetch } from '../ai-transport.ts';
import type { TestConnectionInput, TestConnectionResult } from './types.ts';

/** The capping time of the detection request: has nothing to do with the set timeout of the official channel, and is fixed at 15 seconds. */
const PROBE_TIMEOUT_MS = 15_000;
/** After receiving so many characters, it is considered connected and no longer waits for the model to finish speaking. */
const PROBE_MAX_CHARS = 40;

/** Three required prompts; fill in all and return null. */
function missingField(baseUrl: string, model: string, apiKey: string): string | null {
  if (!baseUrl) return '请先填写接口地址（Base URL）';
  if (!model) return '请先填写模型名称';
  if (!apiKey) return '请先填写 API 密钥';
  return null;
}

/** Translate detection failure into an actionable sentence; the original message is only exposed in the fallback branch. */
function describeFailure(error: unknown, controller: AbortController): string {
  if (controller.signal.aborted) return '连接超时（15 秒未响应）：请检查网络连通性或服务器状态';
  if (isAuthenticationFailure(error)) return '身份验证失败 (HTTP 401/403)：请检查 API 密钥是否正确';
  if (isRateLimitFailure(error)) return '请求受限或配额超限 (HTTP 429)：请检查 API 账户余额或调用频率';
  const raw = error instanceof Error ? error.message : String(error);
  if (raw.includes('404')) return '接口路径或模型不存在 (HTTP 404)：请检查接口地址（通常以 /v1 结尾）与模型名称';
  if (raw.includes('ECONNREFUSED') || raw.includes('fetch failed')) {
    return '无法连接到目标服务器：请检查地址与端口是否正确、服务器是否正在运行';
  }
  return `连接失败：${raw}`;
}

/**
 * Run a detection request.
 * @param fetcher - transmission implementation (production is fetch which is the official SDK).
 * @param current - Current saved settings: The default fields in the input are taken from here.
 * @param input - The value filled in by the user in the form.
 * @returns will provide a model reply if it succeeds; if it fails, message will explain where to change it.
 */
export async function testAiConnection(
  fetcher: AiFetch,
  current: StandaloneAiSettings,
  input: TestConnectionInput,
  signal?: AbortSignal,
): Promise<TestConnectionResult> {
  const protocol = input.protocol === 'anthropic' ? 'anthropic' : (input.protocol ?? current.protocol);
  const baseUrl = (input.baseUrl !== undefined ? input.baseUrl : current.baseUrl).trim();
  const model = (input.model !== undefined ? input.model : current.model).trim();
  const apiKey = (input.apiKey !== undefined && input.apiKey !== '' ? input.apiKey : current.apiKey).trim();
  const missing = missingField(baseUrl, model, apiKey);
  if (missing !== null) return { ok: false, message: missing };

  const settings: StandaloneAiSettings = {
    ...DEFAULT_AI_SETTINGS,
    protocol: protocol as 'openai-compatible' | 'anthropic',
    baseUrl,
    model,
    apiKey,
    maxTokens: 32,
    timeoutMs: PROBE_TIMEOUT_MS,
  };
  const controller = new AbortController();
  signal?.throwIfAborted();
  const cancel = (): void => controller.abort();
  signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const probe = sdkTextStream(
      settings,
      { system: '', messages: [{ role: 'user', content: 'hi' }] },
      controller.signal,
      fetcher,
    );
    let reply = '';
    for await (const chunk of probe) {
      if (chunk.refusal) return { ok: false, message: '模型拒绝回答该测试请求' };
      if (!chunk.text) continue;
      reply += chunk.text;
      if (reply.length >= PROBE_MAX_CHARS) break;
    }
    return reply.trim()
      ? { ok: true, message: '连接成功！模型响应正常。', reply: reply.trim() }
      : { ok: true, message: '连接成功！接口已成功响应。', reply: '(模型返回了空白内容)' };
  } catch (error) {
    signal?.throwIfAborted();
    const raw = error instanceof Error ? error.message : '';
    const reason = controller.signal.aborted
      ? 'timeout'
      : isAuthenticationFailure(error)
        ? 'authentication'
        : isRateLimitFailure(error)
          ? 'quota'
          : raw.includes('404')
            ? 'not_found'
            : raw.includes('ECONNREFUSED') || raw.includes('fetch failed')
              ? 'connection'
              : 'unknown';
    return { ok: false, reason, message: describeFailure(error, controller) };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  }
}
