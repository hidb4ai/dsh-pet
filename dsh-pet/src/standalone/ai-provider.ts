/**
 * Public export of standalone mode AI service: Create service with dependency shape.
 *
 * Only re-export; the limit and schema are in ./ai-provider/limits, and the request resolution is in ./
 * ai-provider/request. This must always be true: there is a hard upper limit for input and output. If it is exceeded,
 * it will be truncated or rejected, and it will never be transmitted transparently.
 * @module dsh-pet/src/standalone/ai-provider
 */
export type { StandaloneAiDependencies, StandaloneAiService } from './ai-provider/types.ts';
export { createStandaloneAi } from './ai-provider/create.ts';
