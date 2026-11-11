/**
 * Request parsing and cancellation: Collect external input into a verified object and make the model call abortable.
 *
 * Does not initiate network requests; only responsible for parsing and connecting AbortSignal to Promise. Must always
 * be true: parsing failure must have a clear error and no partial result is returned.
 * @module dsh-pet/src/standalone/ai-provider/request
 */
import { type AiRequest } from '../ai-transport.ts';
import { MAX_INPUT_CHARS, inputSchema, textBlock } from './limits.ts';

/**
 * Converg caller input to plain text message.
 * @param options - caller request.
 * @param model - The currently selected model.
 * @returns Normalized request with optional cancellation signal.
 * @throws Thrown when the input is out of bounds, the character sequence is invalid, or the model does not match.
 */
export function parseRequest(options: unknown, model: string): { request: AiRequest; signal?: AbortSignal } {
  const parsed = inputSchema.safeParse(options);
  if (!parsed.success || parsed.data.model !== model)
    throw new Error('Invalid standalone AI model selection or input.');
  const { data } = parsed;
  const messages = data.messages
    .map((message) => ({
      role: message.role,
      content:
        typeof message.content === 'string'
          ? message.content
          : message.content
              .map((block) => {
                // Non-text block with DSH source metadata does not enter the request: the service provider should only see the text.
                if (typeof block !== 'object' || block === null || !('type' in block) || block.type !== 'text')
                  return '';
                const result = textBlock.safeParse(block);
                if (!result.success) throw new Error('Invalid standalone AI text input.');
                return result.data.text;
              })
              .join(''),
    }))
    .filter((message) => message.content.trim().length > 0);
  const system = data.system ?? '';
  const size = system.length + messages.reduce((sum, message) => sum + message.content.length, 0);
  if (
    size > MAX_INPUT_CHARS ||
    messages.length === 0 ||
    messages[0].role !== 'user' ||
    messages[messages.length - 1]?.role !== 'user'
  ) {
    throw new Error('Standalone AI input is empty or exceeds limits.');
  }
  return { request: { system, messages }, signal: data.signal };
}

/** Allow pending reads to respond to cancellation. */
export function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error('Standalone AI request cancelled.'));
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new Error('Standalone AI request cancelled.'));
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
