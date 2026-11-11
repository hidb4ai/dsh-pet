/**
 * Quota and request schema: number of characters, number of events, rate window and zod shape.
 *
 * Pure declarations and constants, no logic. It must always be true: the upper limit can only be tightened but not
 * relaxed; changing schema must synchronize the model experience section of README.
 * @module dsh-pet/src/standalone/ai-provider/limits
 */
import { z } from 'zod';

/** Fake ctx with provider ID in model selector. */
export const PROVIDER = 'standalone';

/** The upper limit of the total characters input in a single time. */
export const MAX_INPUT_CHARS = 32_768;

/** The upper limit of the total characters output in a single time. */
export const MAX_OUTPUT_CHARS = 16_384;

/** The upper limit of flow events for a single response. */
export const MAX_EVENTS = 4096;

/** Text Block Contract. */
export const textBlock = z.object({ type: z.literal('text'), text: z.string().max(MAX_INPUT_CHARS) });

/** Message Contract: Only characters and restricted content are retained. */
const messageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.union([z.string().max(MAX_INPUT_CHARS), z.array(z.unknown()).max(128)]),
});

/** Request contract: The service provider is fixed and the model must be consistent with the current selection. */
export const inputSchema = z.object({
  provider: z.literal(PROVIDER),
  model: z.string().max(200),
  system: z.string().max(MAX_INPUT_CHARS).optional(),
  messages: z.array(messageSchema).min(1).max(64),
  signal: z.custom<AbortSignal>((value) => value instanceof AbortSignal).optional(),
});
