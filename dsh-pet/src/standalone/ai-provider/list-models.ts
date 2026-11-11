/** Standalone mode "pull model": request a model list from the configured endpoint according to the protocol, read-only respond once, do not cache or persist to disk. */
import type { StandaloneAiSettings } from '../ai-config.ts';
import type { AiFetch } from '../ai-transport.ts';
import type { DiscoveredModel, ModelDiscoveryInput, ModelDiscoveryResult } from './types.ts';
import { localModelKey, sameModelEndpoint } from '../../shared/memory-presets.ts';

/** It is found that the capped time of the request is shorter than the official channel. The user waits on the settings page to see the result. */
const DISCOVERY_TIMEOUT_MS = 10_000;
/** The upper limit of the response body: the full list of OpenRouter is about 300 KB, leaving a margin without being hindered by an oversized response. */
const MAX_DISCOVERY_BYTES = 1_000_000;
/** The upper limit of the number of entries in a single page; the upper limit of the limit parameter of Anthropic is 1000. */
const PAGE_LIMIT = 1000;

/** Operational instructions corresponding to the failure classification; the response body and key will not be included in the copy. */
const FAILURE_TEXT: Record<string, string | undefined> = {
  input: '请先填写接口地址与 API 密钥',
  auth: '身份验证失败 (HTTP 401/403)：请检查 API 密钥是否正确',
  'rate-limit': '请求受限或配额超限 (HTTP 429)：请检查账户余额或调用频率',
  'not-found': '该地址下没有模型列表 (HTTP 404)：请检查地址是否以 /v1 结尾',
  contract: '端点返回的不是模型列表：请确认协议选择与服务商一致',
  timeout: '连接超时（10 秒未响应）：请检查网络连通性或服务器状态',
  network: '无法连接到目标服务器：请检查地址与端口是否正确',
  http: '接口返回了错误状态：请检查地址与凭据',
};

/** Determine whether a value is an ordinary object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Assembling a failed result; the copy only comes from the classification table or the fixed instructions given by the caller. */
function failure(code: string, message?: string): ModelDiscoveryResult {
  return { ok: false, code, message: message ?? FAILURE_TEXT[code] ?? FAILURE_TEXT.http ?? '' };
}

/** Parse and verify the endpoint: only accept the HTTP ( S ) address without account, query and fragment, and return the prefix with the trailing slash removed. */
function parseEndpoint(value: string): string | undefined {
  if (/[\s\\]/.test(value)) return undefined;
  try {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash) return undefined;
    if (!['http:', 'https:'].includes(url.protocol)) return undefined;
    return (url.origin + url.pathname).replace(/\/+$/, '');
  } catch {
    return undefined;
  }
}

/**
 * Candidate list address: First follow the protocol convention, and then click "Does the address contain a version
 * number?" for error tolerance.
 * @param protocol - Normalized protocol.
 * @param base - The verified endpoint prefix without the trailing slash.
 * @returns Addresses in order of attempts.
 */
function candidateUrls(protocol: string, base: string): string[] {
  const versioned = /\/v\d+$/.test(base);
  if (protocol === 'anthropic') return [`${versioned ? base : `${base}/v1`}/models?limit=${PAGE_LIMIT}`];
  return versioned ? [`${base}/models`] : [`${base}/models`, `${base}/v1/models`];
}

/** The respective authentication headers of the two protocols; the plaintext key only appears at this layer, and the error copy will not carry it. */
function authHeaders(protocol: string, apiKey: string): Record<string, string> {
  if (protocol === 'anthropic') {
    return { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', accept: 'application/json' };
  }
  return { authorization: `Bearer ${apiKey}`, accept: 'application/json' };
}

/** Unify the array or "key → entry" mapping into an array. Both are common ways of writing compatible gateways. */
function asList(value: unknown): unknown[] | undefined {
  if (Array.isArray(value)) return value;
  if (isRecord(value)) {
    const values = Object.values(value);
    return values.length > 0 ? values : undefined;
  }
  return undefined;
}

/** Find the entry array from the one-page response, identifying three locations: `data`, `data.models` and `models`. */
function findListing(payload: unknown): unknown[] | undefined {
  if (!isRecord(payload)) return undefined;
  const direct = asList(payload.data);
  if (direct) return direct;
  if (isRecord(payload.data)) {
    const nested = asList(payload.data.models);
    if (nested) return nested;
  }
  return asList(payload.models);
}

/** Normalize to "id + display name", discard entries without id and press id deduplicate, keeping the order given by the endpoints. */
function normalize(entries: readonly unknown[]): DiscoveredModel[] {
  const seen = new Set<string>();
  const models: DiscoveredModel[] = [];
  for (const entry of entries) {
    if (!isRecord(entry) || typeof entry.id !== 'string') continue;
    const id = entry.id.trim();
    if (id === '' || seen.has(id)) continue;
    seen.add(id);
    const label = [entry.name, entry.display_name].find((value) => typeof value === 'string' && value.trim() !== '');
    const capability = [entry.type, entry.task, entry.domain].filter((value) => typeof value === 'string').join(' ');
    const marker = (capability || id).toLowerCase();
    let kind: DiscoveredModel['kind'];
    if (/embed|\bbge-|\be5-/.test(marker)) kind = 'embedding';
    else if (/rerank|image|video|audio|tts|whisper|dall-e/.test(marker)) kind = 'other';
    else if (/chat|llm|vlm|gpt-|claude|deepseek|kimi|glm/.test(marker)) kind = 'generation';
    models.push({ id, name: typeof label === 'string' ? label.trim() : id, ...(kind ? { kind } : {}) });
  }
  return models;
}

/** Ask an address for a list; non-404 failures are directly finalized, and 404 is handed over to the caller for the next candidate. */
async function requestList(
  fetcher: AiFetch,
  url: string,
  headers: Record<string, string>,
  controller: AbortController,
): Promise<ModelDiscoveryResult> {
  let response: Response;
  try {
    response = await fetcher(url, { method: 'GET', headers, signal: controller.signal, redirect: 'error' });
  } catch {
    return failure(controller.signal.aborted ? 'timeout' : 'network');
  }
  if (!response.ok) {
    await response.body?.cancel();
    const code = response.status === 401 || response.status === 403 ? 'auth' : 'http';
    return failure(response.status === 404 ? 'not-found' : response.status === 429 ? 'rate-limit' : code);
  }
  let text: string;
  try {
    if (!response.body) return failure('contract');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > MAX_DISCOVERY_BYTES) return failure('contract');
        chunks.push(chunk.value);
      }
      text = Buffer.concat(chunks).toString('utf8');
    } finally {
      await reader.cancel();
    }
  } catch {
    return failure('contract');
  }
  if (text.length > MAX_DISCOVERY_BYTES) return failure('contract', '端点返回的模型列表过大，请改用支持分页的地址');
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    return failure('contract');
  }
  const entries = findListing(payload);
  return entries ? { ok: true, models: normalize(entries) } : failure('contract');
}

/**
 * Use drafts (or saved values) in the form to pull endpoints to declare available models.
 * @param fetcher - Transport implementation, test replaceable to isolate network.
 * @param current - Saved settings: The default fields in the input are taken from here.
 * @param input - The value filled in by the user in the form; an empty character string is considered unfilled.
 * When @returns succeeds, the model is given in order of endpoints; when it fails, code is stable and message can be
 * displayed directly.
 */
export async function discoverModels(
  fetcher: AiFetch,
  current: StandaloneAiSettings,
  input: ModelDiscoveryInput,
): Promise<ModelDiscoveryResult> {
  const protocol =
    input.protocol === 'anthropic' || input.protocol === 'openai-compatible' ? input.protocol : current.protocol;
  const rawBase = (input.baseUrl !== undefined ? input.baseUrl : current.baseUrl).trim();
  const apiKey = (
    input.apiKey ||
    (protocol === current.protocol && sameModelEndpoint(rawBase, current.baseUrl) ? current.apiKey : '') ||
    localModelKey(rawBase)
  ).trim();
  if (rawBase === '') return failure('input', '请先填写接口地址（Base URL）');
  if (apiKey === '') return failure('input', '请先填写 API 密钥');
  const base = parseEndpoint(rawBase);
  if (base === undefined) return failure('input', '接口地址必须是 HTTP(S) 地址，且不能含账号、查询参数或片段');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DISCOVERY_TIMEOUT_MS);
  try {
    let last = failure('http');
    // Only change to the next candidate when 404: Other failures indicate that the address is correct, but there is a problem with the credentials or service, and there is no point in trying another spelling.
    for (const url of candidateUrls(protocol, base)) {
      const attempt = await requestList(fetcher, url, authHeaders(protocol, apiKey), controller);
      if (attempt.ok || attempt.code !== 'not-found') return attempt;
      last = attempt;
    }
    return last;
  } finally {
    clearTimeout(timer);
  }
}
