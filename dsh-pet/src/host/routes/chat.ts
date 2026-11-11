/**
 * Dialogue: / chat reads and writes the dialogue memory and calls the model to generate a reply.
 *
 * Do not assemble the prompt word (return to ./chat); the shape of the picture input parameter is checked with base64
 * and return to ./image-attachment. Dependency (PetRouteDeps) is passed in explicitly, and the module does not read
 * global information or create status.
 * @module dsh-pet/src/host/routes/chat
 */
import { readAllConfig, sliceMemoryRounds } from '../config.ts';
import { boundedHistory } from '../memory-context.ts';
import { chatMemoryConfigValid, DEFAULT_CHAT_MEMORY } from '../../shared/chat-memory-config.ts';
import { parseImageAttachment, type PetImageRef, type PetImageSink } from '../image-attachment.ts';
import type { PetRouteDeps, RouteInput } from './types.ts';
import type { RouteResult } from '../http.ts';
import { failResult, invalidJson, methodNotAllowed, okResult } from './result.ts';

/** Image admission conclusion; `ref` defaults to indicating that no image was included in this request. */
type ImageAdmission =
  { readonly ok: true; readonly ref?: PetImageRef } | { readonly ok: false; readonly res: RouteResult };

/** Dialog field: undefined is returned for misses, and response is returned for hits. */
export async function handleChatRoutes(deps: PetRouteDeps, input: RouteInput): Promise<RouteResult | undefined> {
  const { configPaths, log, memoryPath, memoryRounds, readMemory, requirePet } = deps;
  const { body, method, rest, url } = input;

  // The remaining history of the deleted pet: This pet is no longer in the configuration. GET /chat cannot read it,
  // so it cannot be cleared. GET lists (only the number and last time are given, but no text is given), DELETE is
  // cleared at one time.
  if (rest === 'chat/memory') {
    if (method !== 'GET' && method !== 'DELETE') return methodNotAllowed();
    try {
      if (method === 'DELETE') return okResult(await deps.deleteOrphans());
      return okResult({ ok: true, orphans: await deps.orphanHistory() });
    } catch (e) {
      return failResult('generate-error', e instanceof Error ? e.message : String(e));
    }
  }

  // Dialogue: GET /chat reads the latest memory window (truncate chatMemoryRounds rounds, read once, not polling),
  // POST /chat carries the history to generate replies and writes them into the memory, DELETE /chat deletes the
  // memory (by rounds or whole). The only reader and writer of memory is host (memory.json), and the browser and
  // desktop naturally share the same copy.
  if (rest === 'chat/powercontext' && deps.memoryStatus && deps.syncMemory) {
    if (method !== 'GET' && method !== 'POST') return methodNotAllowed();
    const who = requirePet(url.searchParams, () => readAllConfig(configPaths));
    if (!who.ok) return who.res;
    try {
      if (method === 'POST') await deps.syncMemory(who.petId);
      return okResult(await deps.memoryStatus(who.petId));
    } catch {
      return failResult('generate-error', '记忆状态暂不可用');
    }
  }

  if (rest === 'chat') {
    if (method !== 'GET' && method !== 'POST' && method !== 'DELETE') return methodNotAllowed();
    try {
      // `?rounds=` : GET exclusive viewing parameters - only determines how many rounds to read this time (it does not
      // write the memory, nor does it change how much subsequent dialogue is brought into the context, so POST does
      // not recognize it). Same situation as surface: parameter level verification is placed before disk reading.
      const roundsRaw = method === 'GET' ? url.searchParams.get('rounds') : null;
      let roundsOverride: number | null = null;
      if (roundsRaw !== null && roundsRaw.trim() !== '') {
        const n = Number(roundsRaw);
        if (!Number.isInteger(n) || n < 0 || n > 200) {
          return failResult('bad-request', 'rounds 必须是 0–200 的整数（不传则用配置）');
        }
        roundsOverride = n;
      }
      // `?ts=` (repeatable, exclusive to DELETE): Only the hit round is deleted. Default = clear the entire disk; also verified before reading the disk.
      let tsList: number[] | undefined;
      if (method === 'DELETE') {
        const parsed = parseTsList(url.searchParams.getAll('ts'));
        if (parsed === null) return failResult('bad-request', 'ts 必须是非负整数（毫秒时间戳）');
        tsList = parsed.length > 0 ? parsed : undefined;
      }
      // pet is required and must actually exist: an empty string will cause the persona/picture to be retrieved
      // according to the main entry, and the memory will create a new bucket based on the (non-existent) id, and the
      // reply will be written into `pets[""].say` that no one consumes, and ok:true will be returned. Lazy +
      // memoization: pet does not read the configuration at all when the string is empty; GET branch reuses the same
      // read.
      let cfgCache: Record<string, Record<string, unknown>> | undefined;
      const cfg = (): Record<string, Record<string, unknown>> => (cfgCache ??= readAllConfig(configPaths));
      // surface only checks POST: GET is for reading memory, DELETE is for storage management, it has nothing to do with which end the pet is displayed on
      const who = requirePet(url.searchParams, cfg, { surface: method === 'POST' });
      if (!who.ok) return who.res;
      const petId = who.petId;
      if (method === 'GET') {
        const mem = await readMemory();
        const rawMessages = mem[who.entry]?.[petId]?.messages;
        // When the memory file is valid JSON but messages is not an array, slice() will throw slice is not a
        // function: Process as empty history and record a line of log, so that the entire history interface will not
        // report an error because of a piece of bad data.
        const list = Array.isArray(rawMessages) ? rawMessages.filter((m) => m && typeof m.content === 'string') : [];
        if (rawMessages !== undefined && !Array.isArray(rawMessages)) {
          log.error(
            `[dsh-pet] Invalid memory structure (messages is not an array) pet=${petId}; treating history as empty: ${memoryPath}`,
          );
        }
        // Passed ? rounds = Just use the passed one (including 0 = empty history). If not passed, fallback to the configuration.
        const rounds = roundsOverride ?? memoryRounds(who.conf);
        // Same semantics as chatWithPet: rounds = 0 → empty history (slice (-0) will return the entire array, see above)
        const messages = sliceMemoryRounds(list, rounds);
        const memory = chatMemoryConfigValid(who.conf.chatMemory) ? who.conf.chatMemory : DEFAULT_CHAT_MEMORY;
        const context =
          memory.maxHistoryBytes > 0
            ? boundedHistory(list, memoryRounds(who.conf), memory.maxHistoryBytes)
            : sliceMemoryRounds(list, memoryRounds(who.conf));
        return okResult({ ok: true, messages, rounds, contextRounds: Math.floor(context.length / 2) });
      }
      if (method === 'DELETE') return okResult(await deps.deleteHistory(petId, tsList));
      return await postChat(deps, petId, body);
    } catch (e) {
      // Configuration guaranteed correct by readAllConfig (no more config-error branch); rest ( IO/LLM ) → generate-error
      return failResult('generate-error', e instanceof Error ? e.message : String(e));
    }
  }

  return undefined;
}

/**
 * Resolving `?ts=` from DELETE (repeatable).
 *
 * @param raws - the original values of all `ts` in the query string.
 * @returns timestamp array after deduplicate; when any value is not a non-negative integer, `null` is returned (caller
 * is converted to bad-request).
 */
function parseTsList(raws: readonly string[]): number[] | null {
  const out: number[] = [];
  for (const raw of raws) {
    const n = Number(raw);
    // Empty string cannot be used as 0: Number ('') === 0 will silently delete the round of ts =0
    if (raw.trim() === '' || !Number.isInteger(n) || n < 0) return null;
    out.push(n);
  }
  return [...new Set(out)];
}

/**
 * POST /chat: Parse the text and optional images, and pass them to the dialogue layer to generate a reply.
 *
 * @param deps - route dependency.
 * @param petId - Verified existence of pet id.
 * @param body - The original text of the request body; if it is not a valid JSON, 400 will be returned.
 * @returns has the same shape as before adding the picture: Successfully only brings `text` (there is also `image` in
 * the picture).
 */
async function postChat(deps: PetRouteDeps, petId: string, body: string | undefined): Promise<RouteResult> {
  let parsed: Record<string, unknown>;
  try {
    parsed = (JSON.parse(body ?? 'null') as Record<string, unknown> | null) ?? {};
  } catch {
    return invalidJson();
  }
  const text = typeof parsed.text === 'string' ? parsed.text.trim() : '';
  if (!text) return failResult('bad-request', '消息为空');
  if (text.length > 2000) return failResult('bad-request', '消息过长（限 2000 字）');
  // By default, the picture directly returns an empty conclusion. The following call is the same as before adding the picture (this is the key point of the regression test)
  const admitted = await admitImage(deps, parsed.attachment);
  if (!admitted.ok) return admitted.res;
  return okResult(await deps.chatWithPet(petId, text, admitted.ref));
}

/**
 * Verify the image input parameters and hand them to the host attachment service for persist to disk.
 *
 * @param deps - route dependency (the accessory service is soft-fetched through optionalService, not inject).
 * @param raw - The original value of `attachment` in the request body; `undefined` means that the image was not
 * transmitted.
 * @returns Image reference that has been persisted to disk, or a failure response that can be returned directly.
 */
async function admitImage(deps: PetRouteDeps, raw: unknown): Promise<ImageAdmission> {
  if (raw === undefined) return { ok: true };
  const parsed = parseImageAttachment(raw);
  if (!parsed.ok) return { ok: false, res: failResult('bad-request', parsed.message) };
  const sink = deps.optionalService('attachments') as PetImageSink | undefined;
  // There is no attachment service in standalone mode: the picture capability is directly unavailable and no false storage is performed (see API.md for the contract)
  if (typeof sink?.saveImages !== 'function') {
    return { ok: false, res: failResult('bad-request', '当前模式不支持图片（缺少附件服务）') };
  }
  const maxBytes = sink.imageLimits?.maxImageBytes;
  if (maxBytes !== undefined && parsed.bytes.length > maxBytes) {
    return { ok: false, res: failResult('bad-request', `图片过大（上限 ${maxBytes} 字节，请压缩或降低分辨率）`) };
  }
  try {
    const [ref] = await sink.saveImages([{ data: parsed.bytes, mediaType: parsed.mediaType }]);
    if (ref === undefined) return { ok: false, res: failResult('generate-error', '附件服务未返回图片引用') };
    return { ok: true, ref };
  } catch (e) {
    // The storage failure is not a parameter problem of the caller: return generate-error to avoid being regarded as bad-request and debug the direction.
    return { ok: false, res: failResult('generate-error', e instanceof Error ? e.message : String(e)) };
  }
}
