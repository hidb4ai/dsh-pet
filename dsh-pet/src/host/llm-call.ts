/**
 * The calling identity of all LLM calls of this plugin, and the reason for "no text".
 *
 * It is not responsible for sending requests, selecting models, and assembling messages—that is the business of each
 * module on the generation side; here only two shared things are given to all calls: a stable calling identity, and a
 * text that translates the reason for stream termination into human language. Must always be true: the identity
 * character string does not change, the adapter relies on it to generate the provider vector, and the peer may reject
 * the request based on it.
 * @module dsh-pet/src/host/llm-call
 */

/**
 * Calling identity: The adapter generates the carrier required by the service provider based on this (opencode-go will
 * be translated into `x-opencode-session` request header, if this header is missing, the route will return 400). The
 * value only needs to be stable and does not need to be a real session id.
 */
export const PET_CALL_IDENTITY = 'dsh-pet';

/**
 * When there is no text, the reason to be displayed is given according to the flow termination reason.
 * @param finish - stream termination block (`BlockAssembler.finish`; dsh-llm. The adapter throw error is folded here
 * and is not thrown in the stream).
 * @returns The upper-level copy after "Dialogue failed:".
 */
export function noTextReason(finish: unknown): string {
  const { kind, failure } = (finish ?? {}) as { kind?: unknown; failure?: unknown };
  if (kind === 'aborted') return '生成已取消';
  if (kind === 'max-tokens') return '输出达到上限，未产出正文';
  if (kind !== 'error') return '模型未返回文本';
  const { message, code } = (failure ?? {}) as { message?: unknown; code?: unknown };
  if (typeof message === 'string' && message.trim() !== '') return message;
  if (typeof code === 'string' && code.trim() !== '') return code;
  return '未提供失败原因';
}
