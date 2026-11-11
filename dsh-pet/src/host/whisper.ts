/**
 * whisper generation (host side): Use DSH’s LLM unified abstraction layer (ctx.llm) to generate a sentence.
 *
 * Responsible for putting together a minimalist "say a word" request and collecting the streaming text; not putting
 * together the service provider's endpoints or touching the credentials. It is not responsible for orchestrating and
 * writing bubbles - periodic scheduling and persist to disk are all handled by other modules on the host side. Rely on
 * ctx.llm, agentDefaultModel (same origin as the dialogue) and caller randomly selected pictures. This is always true:
 * if the candidate model fails, an explicit fallback must be left and traces must be left; if the generation fails, a
 * structured reason will be returned and no text will be falsified. See contracts API.md and openapi.yaml.
 *
 * @module dsh-pet/src/host/whisper
 */

import { BlockAssembler, createUserMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm';
import { PET_CALL_IDENTITY, noTextReason } from './llm-call.ts';
import { supportsReasoningOff } from './llm-reasoning.ts';
import { defaultLog } from './log-file.ts';
import { modelCandidates, modelLabel, type ModelRef } from './model-selection.ts';

/** Generate failure reason (identical to the WhisperState failure branch of shared/whisper.ts). */
export type WhisperGenerateResult =
  | { ok: true; text: string; image?: string }
  | { ok: false; reason: 'provider-missing' | 'generate-error'; message?: string };

/** Single generation timeout (ms): whisper does not need long output, 30 s is enough. */
const TIMEOUT_MS = 30_000;

/** whisper command: plain text (as-is request without pictures). */
const USER_TEXT = '随便说一句日常碎碎念，一句就好，20 字以内。';

/** Sleep talking command: mumble something while sleeping. It belongs to the same "functional command" as the whisper command and does not enter the configuration (there is only persona in the configuration). */
const SLEEP_TALK_TEXT = '你正在睡觉，随便嘟囔一句梦话，一句就好，20 字以内；含糊、半梦半醒，不要清醒地回应任何人。';

/** External export of sleep talking instructions: caller passes in instruction of generateWhisper to avoid copying another copy. */
export const SLEEP_TALK_INSTRUCTION = SLEEP_TALK_TEXT;

/**
 * Whisper command: When adding an emoticon, ask the model to cooperate with the painting and say a word.
 *
 * Make it clear that "the text is still one sentence": the picture is a supplement, not a model describing the picture
 * itself. The pictures are randomly selected by the caller instead of being selected by the model: whisper has no
 * context to rely on (persona is fixed, no user input), and the model selection can only be done blindly, which adds
 * another layer of risk of illusion.
 */
function userTextWithMeme(meme: { name: string; desc: string }): string {
  return (
    '随便说一句日常碎碎念，一句就好，20 字以内。\n' +
    '这次会配一张表情包一起显示，图的内容是：' +
    meme.name +
    '（' +
    meme.desc +
    '）。\n' +
    '请让这句话和这张图的情绪/场景自然契合，像是配合画面说出来的；不要描述画面本身。'
  );
}

/** One-time generation request: persona is required, the rest are optional. The parameter change object is to no longer attach the fifth parameter to the function signature. */
export interface WhisperRequest {
  /** persona system prompt word (whisperPrompt). */
  system: string;
  /** Picture (passed in when turning on picture; default = plain text whisper). When the generation is successful, it will be brought back as it is, and the client will display the picture accordingly. */
  meme?: { name: string; desc: string };
  /** Entry individually specified model (whisperModel); Default/leave blank = only use the model of the current session. */
  preferred?: ModelRef;
  /** Function command (whisper command SLEEP_TALK_INSTRUCTION); default = whisper command. */
  instruction?: string;
}

/**
 * Generate a sentence using the specified (or current conversation's) provider/model.
 * @param ctx - host context (injected agentDefaultModel / llm).
 * @param request - persona, optional drawings, optional models and instructions.
 * @returns generated text (+ images), or structuring failure (provider missing/generated incorrectly).
 */
export async function generateWhisper(
  ctx: { agentDefaultModel: { currentSelection(): { provider: string; model: string } }; llm?: unknown },
  request: WhisperRequest,
): Promise<WhisperGenerateResult> {
  // Candidate chain: The configured model takes priority → the model of the current conversation fallback (when whisperModel is left empty, only the latter is on the chain)
  const candidates = modelCandidates(ctx, request.preferred);
  if (candidates.length === 0) {
    return { ok: false, reason: 'provider-missing', message: '当前对话未配置模型' };
  }
  // ctx.llm is a core service but remains defensive: explicitly fails when missing (silent skipping is determined by the upper layer)
  const llm = (ctx as { llm?: { stream(o: unknown): AsyncIterable<unknown> } }).llm;
  if (!llm || typeof llm.stream !== 'function') {
    return { ok: false, reason: 'generate-error', message: 'LLM 服务不可用' };
  }
  // Try in sequence: when the configured model fails (the credentials are deleted/the model is removed from the
  // shelves/the service provider does not match key), fallback to the model of the current conversation and try again
  // - that is the model that the user is currently using, and it is more meaningful to report an error. The fallback
  // copy has the same origin as the failed branch to avoid literal drift between the two places.
  let last: WhisperGenerateResult = { ok: false, reason: 'generate-error', message: noTextReason(undefined) };
  for (const [i, sel] of candidates.entries()) {
    const result = await generateWith(ctx, llm, sel, request);
    if (result.ok) return result;
    last = result;
    // fallback should leave traces: when the configured model does not take effect, the reason can be seen in the log (otherwise "I clearly configured A, why do I still use B" cannot be checked)
    if (i + 1 < candidates.length) {
      defaultLog(
        'warn',
        `dsh-pet: Whisper generation failed with ${modelLabel(sel)} (${result.message ?? result.reason}); falling back to ${modelLabel(candidates[i + 1])}`,
      );
    }
  }
  return last;
}

/** Run a generation with a certain provider/model (a link in the candidate chain; if it fails, the structured reason will be returned as is and will not be swallowed). */
async function generateWith(
  ctx: { llm?: unknown },
  llm: { stream(o: unknown): AsyncIterable<unknown> },
  sel: ModelRef,
  request: WhisperRequest,
): Promise<WhisperGenerateResult> {
  const deadline = AbortSignal.timeout(TIMEOUT_MS);
  // It is only passed when the model declaration supports reasoning effort (including " off "), otherwise it is
  // omitted: if the model without reasoning metadata explicitly passes off, it will be judged as
  // UNSUPPORTED_REASONING_EFFORT by dsh-llm and folded into an empty stream (shown as "the model does not return
  // text").
  const supportsOff = await supportsReasoningOff(ctx, sel.provider, sel.model);
  const options = {
    provider: sel.provider,
    model: sel.model,
    // Calling identity (see llm-call.ts): when it is missing, opencode-go returns 400
    sessionId: PET_CALL_IDENTITY,
    messages: [
      createUserMessage({
        content: [
          { type: 'text', text: request.instruction ?? (request.meme ? userTextWithMeme(request.meme) : USER_TEXT) },
        ],
        source: { kind: 'user' },
      }),
    ],
    system: request.system,
    // No explicit limit maxTokens: The inference model will include thinking into the budget, and the explicit small
    // limit will only truncate the text and report "Model did not return text"; do not pass the fallback by dsh-llm
    // according to the adapter defaultMaxTokens (default 32768), and the whisper short command output is still short.
    temperature: 1,
    // Unifiedly turn off deep thinking: whisper does not require reasoning, just a casual sentence (only model declaration supports time passing)
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
  return request.meme ? { ok: true, text, image: request.meme.name } : { ok: true, text };
}
