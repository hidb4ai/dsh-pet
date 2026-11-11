/**
 * Standalone mode standalone for `@deepseek-ai/dsh-llm` : message factory, text block assemble and reasoning flag.
 *
 * There is no model backend in standalone mode, these are implemented only to allow the static import module graph to
 * be loaded. The shape must be consistent with the DSH contract: when the model is explicitly written in the
 * configuration, the generation side will actually go here. Only effective in standalone mode builds, pointed to by
 * alias.
 * @module dsh-pet/src/standalone/shims/dsh-llm
 */

/** Minimal shape of message: only role, content and source. */
export interface StandaloneLlmMessage {
  role: 'user' | 'assistant';
  content: unknown;
  source: unknown;
}

/** Create user message. */
export function createUserMessage(input: { content: unknown; source: unknown }): StandaloneLlmMessage {
  return { role: 'user', content: input.content, source: input.source };
}

/** Create assistant message. */
export function createAssistantMessage(input: { content: unknown; source: unknown }): StandaloneLlmMessage {
  return { role: 'assistant', content: input.content, source: input.source };
}

/** Text block shape. */
export interface StandaloneTextBlock {
  type: 'text';
  text: string;
}

/** Streaming text assemble: only collects text blocks, standalone mode will only have empty streams. */
export class BlockAssembler {
  /** Collected text fragments. */
  private readonly chunks: string[] = [];

  /** Collect a block of text; other types are ignored. */
  push(chunk: unknown): void {
    if (chunk !== null && typeof chunk === 'object' && (chunk as { type?: unknown }).type === 'text') {
      const text = (chunk as { text?: unknown }).text;
      if (typeof text === 'string') this.chunks.push(text);
    }
  }

  /** Return the current assemble result. */
  blocks(): StandaloneTextBlock[] {
    const text = this.chunks.join('');
    return text === '' ? [] : [{ type: 'text', text }];
  }
}

/** reasoning effort Identity factory: Returns the incoming value unchanged. */
export function ReasoningEffortId(id: string): string {
  return id;
}
