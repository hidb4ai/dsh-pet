/**
 * persona assemble (host side, pure logic): The system prompt word shared by whisper and dialogue is only spelled
 * here.
 *
 * Four paragraphs, in fixed order: persona text (instance whisperPrompt → entry whisperPrompt → empty string), name
 * declaration, time background (timeContextOf is currently calculated, not cached), and historical time description
 * (only added when the conversation has a history). It does not touch IO or read the clock. Date is passed in by the
 * caller; it is not responsible for fetching fields and initiating generation (petSystemPrompt of index.ts only does
 * "fetch fields → call here"). It must always be true: The assemble point is unique - do not open placeholder
 * configuration for the name and time, otherwise it will equal the appearance of a second assemble point.
 * @module dsh-pet/src/host/persona
 */
import { timeContextOf } from './time-context.ts';

/**
 * Description of historical time: user messages in history are appended with the `[月日 时:分]` prefix to let the model
 * know which moments can be used to calculate spans.
 *
 * The wording limits the prefix to "time stamp in the conversation record" rather than "reply format"; the prefix is
 * only marked on user messages - when marked on assistant, the model will copy it into its own speech format (there
 * have been replies starting with `[11:54]` ).
 */
const HISTORY_TIMES_LINE =
  '【历史】对话记录里，主人的话前面标着 [月日 时:分]，那是那句话发生的时刻；它只是记录里的时间标注，不是你的说话格式。判断“多久以前”“隔了几天”时按它换算，别把隔了很久的话当成刚说过的。你的回复直接从正文开始，不要写时间、不要加方括号前缀。';

/**
 * The final persona text of a pet (excluding name and time): instance whisperPrompt → entry whisperPrompt → empty
 * string.
 *
 * The semantics are substitution rather than concatenate: two personas taking effect at the same time will cause the
 * model to receive two identities. The instance-level value combiner has been filtered, and trim null check is still
 * here - petPersona is also an exported function, and it cannot be assumed that the caller has gone away from the
 * combiner.
 */
export function petPersona(conf: Record<string, unknown>, pet: Record<string, unknown>): string {
  const own = pet.whisperPrompt;
  if (typeof own === 'string' && own.trim() !== '') return own;
  const entry = conf.whisperPrompt;
  return typeof entry === 'string' ? entry : '';
}

/** Input parameters of composeSystemPrompt */
export interface SystemPromptParts {
  /** Persona text that has fallen back to the effective value (result of petPersona; empty string = no persona, only name + time) */
  prompt: string;
  /** Display name (pets []. name; missing/empty is treated as id) */
  name: string;
  /** pet id (fallback when name is empty; both are empty = the entire name declaration is omitted) */
  id: string;
  /** Generate this moment (new Date() for production, fixed date for test) */
  now: Date;
  /** Whether the historical message has a time prefix; the default is false (whisper has no history, and the [history] segment should not appear) */
  historyTimes?: boolean;
}

/**
 * Spell out the final system prompt word: persona text + name statement + time background + (during conversation)
 * historical time description.
 *
 * Boundary: When prompt is empty, no leading line break is left; when neither name nor id can be obtained, the entire
 * name statement is omitted; when now is invalid (NaN), timeContextOf returns an empty string, and the time background
 * and [history] are not added to the entire line (rather than add NaN Spell in the prompt words; when there is no time
 * background, the "now" of [history] cannot be compared, and leaving it alone will only contradict itself).
 */
export function composeSystemPrompt(parts: SystemPromptParts): string {
  const name = String(parts.name || parts.id);
  const nameLine = name ? '你的名字是“' + name + '”。' : '';
  const lines = [parts.prompt, nameLine].filter((line) => line !== '');
  const time = timeContextOf(parts.now);
  if (time) {
    lines.push(time);
    // [History] Follow the time background: The whole sentence refers to "now", which does not hold true without time background.
    if (parts.historyTimes === true) lines.push(HISTORY_TIMES_LINE);
  }
  return lines.join('\n');
}
