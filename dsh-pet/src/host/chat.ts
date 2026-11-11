/**
 * Dialogue generation (host side): Use DSH’s LLM unified abstraction layer (ctx.llm) to generate a reply.
 *
 * Responsible for combining historical memory, user input and persona into one generation request, and parsing
 * optional image tags. It is not responsible for memory reading, writing and persisting to disk, nor is it responsible
 * for writing bubbles - those at the route layer and the consumer sides at both ends. Depends on the meme
 * pool provided by ctx.llm, agentDefaultModel (same origin as whisper) and caller. This is always true: if the
 * candidate model fails, an explicit fallback must be left and traces must be left; if the generation fails, a
 * structured reason will be returned and no text will be falsified. See contracts API.md and openapi.yaml.
 *
 * @module dsh-pet/src/host/chat
 */

import { BlockAssembler, createAssistantMessage, createUserMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm';
import { actionInstruction, extractChatAction } from './chat-action.ts';
import type { PetImageRef } from './image-attachment.ts';
import { PET_CALL_IDENTITY, noTextReason } from './llm-call.ts';
import { supportsReasoningOff } from './llm-reasoning.ts';
import { defaultLog } from './log-file.ts';
import { extractChatImage, memeCatalog, type MemeEntry } from './memes.ts';
import { modelCandidates, modelLabel, type ModelRef } from './model-selection.ts';
import { historyStampOf } from './time-context.ts';
import { recalledContextText } from './memory-context.ts';

/** Generate failure reason (identical to the WhisperState failure branch of shared/whisper.ts). */
export type ChatGenerateResult =
  | { ok: true; text: string; image?: string; action?: string }
  | { ok: false; reason: 'provider-missing' | 'generate-error'; message?: string };

/** A message in memory: GET /chat The window entry returned is this. */
export interface ChatMemoryMessage {
  role: 'user' | 'assistant';
  content: string;
  ts: number;
  /** Pictures uploaded by users in this round (referenced in attachments, excluding the picture itself); only saved but not sent - historical playback does not include pictures. */
  image?: PetImageRef;
  /** The name of the meme assigned to AI in this round (not an entry object); when playing back the history, `[图:名称]` is backfilled to the model (without the image itself). */
  meme?: string;
  /** The action name performed by AI in this round (the name in animations.categories); backfill with `[动作:名称]` when playing back the history. */
  action?: string;
}

/** Single generation timeout (ms): Dialog waiting for LLM reply, 60 s is enough. */
const TIMEOUT_MS = 60_000;

/** The threshold for time prefixing historical messages (ms): continuous conversations within 30 minutes are not added to avoid adding a few more token to each sentence. */
const HISTORY_STAMP_GAP_MS = 30 * 60 * 1000;

/**
 * user The text of the historical message: When the time from now exceeds the threshold, `[10月31日 22:53]` is added in
 * front.
 *
 * Only mark user: user / assistant in the same round share the same ts, and one mark is enough; when marked on
 * assistant, the model will copy this line as its own speaking format (actually there have been replies starting with
 * `[11:54]` ). Continuous conversations within the threshold are not prefixed - otherwise a normal chat would turn
 * into a timestamp per sentence.
 *
 * @param message - historical messages (with ts).
 * @param nowMs - This time of generation (milliseconds), the entire batch of history shares one, to avoid taking the
 * clock one by one and causing time inconsistency in the same batch.
 * @returns returns the timestamp followed by the original text when a prefix is required, otherwise `content` is returned unchanged.
 */
function userHistoryTextOf(message: ChatMemoryMessage, nowMs: number): string {
  if (!Number.isFinite(message.ts)) return message.content;
  // Use > instead of >=: Exactly 30 minutes is still considered a continuous conversation; ts will have a negative time difference in the future (clock back), so naturally it will not be added
  if (!(nowMs - message.ts > HISTORY_STAMP_GAP_MS)) return message.content;
  const stamp = historyStampOf(message.ts, new Date(nowMs));
  return stamp === '' ? message.content : '[' + stamp + '] ' + message.content;
}

/**
 * Pictures/action marks backfilled in history (`[动作:名称]` and `[图:名称]` , each occupying one line, the order is fixed).
 *
 * Only the name is stored in the memory, and the marks in the text have been stripped off before persisting to disk;
 * without backfilling, the model cannot see which picture it has matched in previous rounds or what actions it has
 * performed. When the user says "change it", it does not even know what it is changing, and will only pick the same
 * picture repeatedly or answer questions that are wrong. Only backfill assistant: The attachment reference of user is
 * still not included (old pictures will not be resent to the model). The name may be an empty string (the memory file
 * has been modified manually) - empty values are not backfilled, and the plain text history remains unchanged word for
 * word.
 *
 * @param message - historical messages.
 * @returns returns `\n[动作:…]\n[图:…]` when backfilling is required, otherwise an empty string is returned.
 */
function historyMarkersOf(message: ChatMemoryMessage): string {
  if (message.role !== 'assistant') return '';
  const lines: string[] = [];
  if (typeof message.action === 'string' && message.action !== '') lines.push('[动作:' + message.action + ']');
  if (typeof message.meme === 'string' && message.meme !== '') lines.push('[图:' + message.meme + ']');
  return lines.length === 0 ? '' : '\n' + lines.join('\n');
}

/**
 * Picture drawing instructions: Attached after the text of user (immediately close to the answer position, it is
 * easier for the model to comply). Let the model choose instead of randomly selecting: the dialogue has real context
 * (user input + history), and the selection is suitable according to the context.
 */
function imageInstruction(pool: MemeEntry[]): string {
  return (
    '\n\n[配图] 回复结尾可选附一张表情包给用户看，从下列清单里挑最贴合当前语境的：\n' +
    memeCatalog(pool) +
    '\n挑中就在回复最后另起一行写 [图:名称]（名称原样照抄）；没有合适的就完全不要写这个标记。'
  );
}

/** The resolution of action instructions and action tags is in ./chat-action: they only serve the dialogue path and are separated from the decision-making layer of / anim. */

/** Input generated by a conversation. */
export interface ChatGenerateInput {
  /** Exact, bounded historical evidence for this request only. */
  readonly recalledContext?: string;
  /** host context (injected agentDefaultModel / llm). */
  readonly ctx: { agentDefaultModel: { currentSelection(): { provider: string; model: string } }; llm?: unknown };
  /** persona prompt word (whisperPrompt, sharing the same persona with whisper). */
  readonly system: string;
  /** Recent memory (in chronological order, user / assistant alternately). */
  readonly history: readonly ChatMemoryMessage[];
  /** The user just entered the words; the picture does not have any text description, and the context depends entirely on it. */
  readonly userText: string;
  /** Emoticon candidate pool; empty/default = plain text (commands and parsing are not involved). */
  readonly pool?: readonly MemeEntry[];
  /** List of actions that can be performed (transmitted when the dialogue linkage switch is turned on, from animations.categories); empty / default = neither injected nor parsed. */
  readonly actions?: readonly string[];
  /** Entry individually specified model (chatModel); Default/leave blank = only use the model of the current session. */
  readonly preferred?: ModelRef;
  /** Pictures attached to this round; default = plain text request, the data path is the same as before adding pictures. */
  readonly image?: PetImageRef;
}

/**
 * Generate a conversation reply.
 *
 * @param input - context, persona, history, user input, and optional image pool/specified model/image.
 * @returns reply text (+ picture name in the hit pool), or structuring failure (provider missing/generated error).
 */
export async function generateChat(input: ChatGenerateInput): Promise<ChatGenerateResult> {
  const { ctx, system, history, userText, preferred, image } = input;
  // The reading pool/verification function on the emoji side is signed as a variable array; make a copy here to avoid passing the reference of the caller array down.
  const pool: MemeEntry[] = [...(input.pool ?? [])];
  // The action list is also "empty = off": when the switch is turned off or categories is not assigned any action, neither command nor analysis is involved.
  const actions: string[] = [...(input.actions ?? [])];
  // Candidate chain: The configured model takes priority → the model of the current conversation fallback (when chatModel is left empty, only the latter is on the chain)
  const candidates = modelCandidates(ctx, preferred);
  if (candidates.length === 0) {
    return { ok: false, reason: 'provider-missing', message: '当前对话未配置模型' };
  }
  const llm = (ctx as { llm?: { stream(o: unknown): AsyncIterable<unknown> } }).llm;
  if (!llm || typeof llm.stream !== 'function') {
    return { ok: false, reason: 'generate-error', message: 'LLM 服务不可用' };
  }
  // Try in sequence: when the configured model fails (the credentials are deleted/the model is removed from the
  // shelves/the service provider does not match key), fallback to the model of the current conversation and try again
  // - that is the model that the user is currently using, and it is more meaningful to report an error. The fallback
  // copy has the same origin as the failed branch to avoid literal drift between the two places.
  let last: ChatGenerateResult = { ok: false, reason: 'generate-error', message: noTextReason(undefined) };
  for (const [i, sel] of candidates.entries()) {
    const result = await generateWith(ctx, {
      llm,
      sel,
      system,
      history,
      userText,
      pool,
      actions,
      image,
      recalledContext: input.recalledContext,
    });
    if (result.ok) return result;
    last = result;
    // fallback should leave traces: when the configured model does not take effect, the reason can be seen in the log (otherwise "I clearly configured A, why do I still use B" cannot be checked)
    if (i + 1 < candidates.length) {
      defaultLog(
        'warn',
        `dsh-pet: Chat generation failed with ${modelLabel(sel)} (${result.message ?? result.reason}); falling back to ${modelLabel(candidates[i + 1])}`,
      );
    }
  }
  return last;
}

/** One generation request for a single candidate model (a link in the candidate chain). */
interface GenerateOnce {
  readonly recalledContext?: string;
  readonly llm: { stream(o: unknown): AsyncIterable<unknown> };
  readonly sel: ModelRef;
  readonly system: string;
  readonly history: readonly ChatMemoryMessage[];
  readonly userText: string;
  readonly pool: MemeEntry[];
  readonly actions: string[];
  readonly image?: PetImageRef;
}

/** Run a dialogue generation with a certain provider/model (failure will return the structured reason as is, and will not be swallowed). */
async function generateWith(ctx: { llm?: unknown }, once: GenerateOnce): Promise<ChatGenerateResult> {
  const { llm, sel, system, history, userText, pool, actions, image } = once;
  // History → dsh-llm message: user via createUserMessage (plugin source), assistant via createAssistantMessage
  // (provider/model is just the role carrier of the message and does not involve adapter playback). The time prefix is
  // only added to user (the model will copy the format on its own side of assistant); the image/action mark is only
  // added to assistant.
  const nowMs = Date.now();
  const historyMessages = history.map((m) =>
    m.role === 'user'
      ? createUserMessage({
          content: [{ type: 'text', text: userHistoryTextOf(m, nowMs) }],
          source: { kind: 'user' },
        })
      : createAssistantMessage({
          content: [{ type: 'text', text: m.content + historyMarkersOf(m) }],
          source: { provider: sel.provider, model: sel.model },
        }),
  );

  const deadline = AbortSignal.timeout(TIMEOUT_MS);
  // It is only passed when the model declaration supports reasoning effort (including " off "), otherwise it is
  // omitted: if the model without reasoning metadata explicitly passes off, it will be judged as
  // UNSUPPORTED_REASONING_EFFORT by dsh-llm and folded into an empty stream (shown as "the model does not return
  // text").
  const supportsOff = await supportsReasoningOff(ctx, sel.provider, sel.model);
  // Picture/Action: Attach the command to the user text only if the respective list is not empty (empty = the function
  // is turned off). The order is fixed "pictures in front, actions in the back": pictures are existing behaviors, and
  // newly added actions come after it, without changing the position of the existing prompt words.
  const wantImage = pool.length > 0;
  const wantAction = actions.length > 0;
  const instruction = (wantImage ? imageInstruction(pool) : '') + (wantAction ? actionInstruction(actions) : '');
  const content: Record<string, unknown>[] = [
    ...(once.recalledContext ? [{ type: 'text', text: recalledContextText(once.recalledContext) }] : []),
    { type: 'text', text: instruction === '' ? userText : userText + instruction },
  ];
  // The picture blocks are arranged after the text blocks: the prompt words come first, and the pixels come later. It is easier for the model to follow the prompts to see the pictures.
  if (image !== undefined) content.push({ type: 'image', attachment: image });
  const options = {
    provider: sel.provider,
    model: sel.model,
    // Calling identity (see llm-call.ts): when it is missing, opencode-go returns 400
    sessionId: PET_CALL_IDENTITY,
    messages: [
      ...historyMessages,
      createUserMessage({
        // PetImageRef is consistent with the ImageAttachmentRef field of dsh-llm. The only difference is the branding
        // type (attachmentId is branded string); the plugin side does not quote the type package of @deepseek -
        // ai/dsh-attachment, and it is explicitly asserted once here.
        content: content as unknown as Parameters<typeof createUserMessage>[0]['content'],
        source: { kind: 'user' },
      }),
    ],
    system,
    // No explicit limit maxTokens: The same reason as whisper - the inference model counts thinking into the budget,
    // and the explicit small upper limit will truncate the text; if dsh-llm is not passed by the adapter
    // defaultMaxTokens fallback, the short reply output of the dialogue is still short.
    temperature: 1,
    // Unifiedly turn off deep thinking: no reasoning is required for chat conversations (same constraint as whisper; only model declaration supports time passing)
    ...(supportsOff ? { reasoningEffort: ReasoningEffortId('off') } : {}),
    signal: deadline,
  };

  const assembler = new BlockAssembler();
  try {
    for await (const chunk of llm.stream(options)) {
      assembler.push(chunk as Parameters<BlockAssembler['push']>[0]);
    }
  } catch (e) {
    return {
      ok: false,
      reason: 'generate-error',
      message: e instanceof Error ? e.message : String(e),
    };
  }
  const text = assembler
    .blocks()
    .filter((b) => b.type === 'text')
    .map((b) => ('text' in b ? (b as { text: string }).text : ''))
    .join('')
    .trim();
  if (!text) return { ok: false, reason: 'generate-error', message: noTextReason(assembler.finish) };
  if (!wantImage && !wantAction) return { ok: true, text };
  // Strip the action first and then the map: the two tags are independent of each other, and the order does not affect the result; invalid names of actions will also be stripped (see extractChatAction).
  const acted: { text: string; action?: string } = wantAction ? extractChatAction(text, actions) : { text };
  const picked: { text: string; image?: string } = wantImage
    ? extractChatImage(acted.text, pool)
    : { text: acted.text };
  return {
    ok: true,
    text: picked.text,
    ...(picked.image ? { image: picked.image } : {}),
    ...(acted.action ? { action: acted.action } : {}),
  };
}
