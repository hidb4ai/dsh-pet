/**
 * Generate channel: run a request into a sequence of text increments, keeping the busy status and quota limit during
 * the process.
 *
 * Do not assemble requests (returned to ./request), do not define limits (returned to ./limits), and ignore service
 * lifecycle (returned to ./create). Failures will be summarized into a fixed copy: SDK errors may contain addresses,
 * request headers or text, and can only be entered into cause and logs. It must always be true: there is only one
 * request in transit at the same time; the controller must be released and the transmission must be closed before
 * returning or throwing an error.
 * @module dsh-pet/src/standalone/ai-provider/stream
 */
import { isAuthenticationFailure, isRateLimitFailure, sdkTextStream, type AiTransportEvent } from '../ai-transport.ts';
import { MAX_EVENTS, MAX_OUTPUT_CHARS } from './limits.ts';
import { abortable, parseRequest } from './request.ts';
import type { AiRuntime } from './types.ts';

/** Fixed text written by this layer: only these can be revealed to the caller as they are. */
const OWN_MESSAGES: readonly string[] = [
  'Standalone AI could not answer this request.',
  'Standalone AI returned no text.',
  'Standalone AI response exceeds limits.',
];

/** Convert transport layer exceptions into visible errors; if authentication fails, the bit will be set to pause and wait for the user to save the settings again. */
function normalizeFailure(runtime: AiRuntime, controller: AbortController, error: unknown): Error {
  if (isAuthenticationFailure(error)) {
    runtime.paused = true;
    runtime.logger.warn('Standalone AI authentication failed; save settings again to resume.');
    return new Error('Standalone AI authentication failed. Check credentials and save settings again.', {
      cause: error,
    });
  }
  if (controller.signal.aborted) {
    return new Error('Standalone AI request cancelled or timed out.', { cause: error });
  }
  if (isRateLimitFailure(error)) {
    return new Error('Standalone AI provider rate limit reached. Please wait.', { cause: error });
  }
  if (error instanceof Error && OWN_MESSAGES.includes(error.message)) return error;
  runtime.logger.warn('Standalone AI request failed.');
  return new Error('Standalone AI request failed. Check the endpoint and model settings.', { cause: error });
}

/**
 * Generate function.
 * @param runtime - Shared running state (readiness determination, rate limiting window, in-transit controller).
 * @returns accepts the DSH request object and produces an asynchronous sequence of text increments.
 */
export function createTextStream(
  runtime: AiRuntime,
): (options: unknown) => AsyncIterable<{ type: 'text'; text: string }> {
  return async function* stream(options) {
    if (!runtime.ready()) throw new Error('Standalone AI is not ready. Configure and enable the model first.');
    const settings = runtime.store.current();
    const { request, signal: callerSignal } = parseRequest(options, settings.model);
    if (callerSignal?.aborted) throw new Error('Standalone AI request cancelled.');
    if (runtime.active) throw new Error('Standalone AI is busy. Please wait.');
    const controller = new AbortController();
    runtime.active = controller;
    const abort = () => controller.abort();
    callerSignal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, settings.timeoutMs);
    const iterator = sdkTextStream(settings, request, controller.signal, runtime.fetcher)[Symbol.asyncIterator]();
    let emitted = 0;
    let events = 0;
    try {
      while (true) {
        const part: IteratorResult<AiTransportEvent> = await abortable(iterator.next(), controller.signal);
        // During the streaming process, the settings may be saved and the service may be released. Please reconfirm each time.
        if (controller.signal.aborted || !runtime.ready()) throw new Error('Standalone AI request cancelled.');
        if (part.done) break;
        // There should also be an upper limit on the number of events to prevent the peer from holding up the process with a large number of empty blocks.
        if (++events > MAX_EVENTS) throw new Error('Standalone AI response exceeds limits.');
        if (part.value.refusal) throw new Error('Standalone AI could not answer this request.');
        const text = part.value.text;
        if (!text) continue;
        emitted += text.length;
        if (emitted > MAX_OUTPUT_CHARS) throw new Error('Standalone AI response exceeds limits.');
        yield { type: 'text', text };
      }
      if (emitted === 0) throw new Error('Standalone AI returned no text.');
    } catch (error) {
      throw normalizeFailure(runtime, controller, error);
    } finally {
      clearTimeout(timer);
      callerSignal?.removeEventListener('abort', abort);
      controller.abort();
      if (runtime.active === controller) runtime.active = undefined;
      // return() may wait for pending reads; only observes results, never blocks cancellation.
      void iterator.return?.().catch(() => runtime.logger.debug('Standalone AI transport closed.'));
    }
  };
}
