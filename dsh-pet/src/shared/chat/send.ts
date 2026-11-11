/**
 * Conversation sending: Give the input sentence to host `POST /chat` , and only the success or failure will be
 * acknowledged. The text display does not go here - the replies are all read from `/state` and `pets.<id>.say` .
 * @module dsh-pet/src/shared/chat/send
 */

/** An image sent with the message: `data` is canonical base64 (without the data : prefix). */
export interface ChatAttachment {
  readonly mediaType: string;
  readonly data: string;
}

/** Send receipt: This type only declares ok used by the consumer, and the text display will always be pets.<id>.say/state. */
export type ChatSendState =
  | { ok: true }
  | { ok: false; reason: 'provider-missing' | 'generate-error' | 'config-error' | 'bad-request'; message?: string };

/** The conversation must wait for LLM to generate a reply, which is twice as relaxed as whisper (30 s) */
const SEND_TIMEOUT_MS = 60_000;

/**
 * Send a conversation (carry the memory to the host to generate a reply and write it into the memory). If the network
 * or parsing fails, an error will be explicitly thrown. The caller determines the error reporting method and will
 * never forge a silent reply.
 *
 * @param baseUrl - The complete conversation address of `?pet=&surface=` is included.
 * @param text - User input text (the host will trim and verify the upper limit of 2000 words).
 * @param attachment - an optional picture; when not transmitted, the request body is only `text` , which is
 * word-for-word consistent with the old version.
 * @returns success, or failure reason and copy after normalization.
 * When the @throws response is not a JSON object.
 */
export async function sendChat(baseUrl: string, text: string, attachment?: ChatAttachment): Promise<ChatSendState> {
  const res = await fetch(baseUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(attachment ? { text, attachment } : { text }),
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
  });
  const raw: unknown = await res.json().catch(() => null);
  if (!raw || typeof raw !== 'object') {
    throw new Error('dsh-pet: invalid chat response');
  }
  const o = raw as Record<string, unknown>;
  if (o.ok !== true) {
    return {
      ok: false,
      reason:
        o.reason === 'provider-missing' || o.reason === 'generate-error' || o.reason === 'config-error'
          ? o.reason
          : 'bad-request',
      message: typeof o.message === 'string' ? o.message : undefined,
    };
  }
  return { ok: true };
}
