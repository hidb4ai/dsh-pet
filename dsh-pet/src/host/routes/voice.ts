/**
 * Speech routes: `/voice/speak` for synthesis, `/voice/hear` for recognition and `/voice/voices` for available voices.
 *
 * The speech service owns validation, queuing and caching. This layer checks methods/JSON and maps results to HTTP
 * responses.
 * See openapi.yaml for field contracts.
 * @module dsh-pet/src/host/routes/voice
 */
import type { RouteResult } from '../http.ts';
import type { PetRouteDeps, RouteInput } from './types.ts';
import { failResult, invalidJson, methodNotAllowed, okResult } from './result.ts';

/** Return a voice-route response, or undefined when the path does not match. */
export async function handleVoiceRoutes(deps: PetRouteDeps, input: RouteInput): Promise<RouteResult | undefined> {
  const { body, method, rest, signal } = input;

  if (rest === 'voice/voices') {
    if (method !== 'GET') return methodNotAllowed();
    return okResult({ ok: true, voices: deps.voice.listVoices() });
  }

  if (rest === 'voice/speak') {
    if (method !== 'POST') return methodNotAllowed();
    let parsed: unknown;
    try {
      parsed = JSON.parse(body ?? 'null');
    } catch {
      return invalidJson();
    }
    const result = await deps.voice.speak(parsed);
    if (!result.ok) return failResult(result.reason, result.message);
    return { kind: 'file', file: result.file, contentType: 'audio/mpeg' };
  }

  // The inverse of /voice/speak: audio in, text out. The host provider validates formats; this layer forwards the result.
  if (rest === 'voice/hear') {
    if (method !== 'POST') return methodNotAllowed();
    let parsed: unknown;
    try {
      parsed = JSON.parse(body ?? 'null');
    } catch {
      return invalidJson();
    }
    const result = await deps.speech.hear(parsed, signal);
    if (!result.ok) return failResult(result.reason, result.message);
    return okResult({ ok: true, text: result.text });
  }

  return undefined;
}
