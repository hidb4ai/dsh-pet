/**
 * Mock memory implementation: retain the last 5 rounds of questions and answers according to pets. When the user asks
 * "remember/before/last time", the latest round is injected as evidence, and the model is required to reread a mark -
 * only when the mark appears in the reply can it be proved that recall has really rewritten the content (the native
 * history cannot provide it).
 *
 * Verify the two entry points of `petApi7340.memory` : `recall` changes the content of this round before generation,
 * `capture` collects this round after persisting to disk; `stats().captured` provides evidence for switch routing that
 * "capture is really called". Not connected to the Internet, does not persist to disk; the process memory state will
 * be empty after restarting.
 * @module dsh-cordis-probe/mock-memory
 */

/** The upper limit of the number of rounds each pet can keep: any pets that are exceeded will be discarded starting from the oldest one. */
const MAX_TURNS = 5;

/** Characteristics of questions that trigger recall: only words "asking about memory" are recognized, and ordinary chatting is not injected. */
const RECALL_PATTERN = /(记得|之前|上次|说过|聊过)/;

/** The mark that must be repeated when recalling: The model rereads it = recall takes effect; it is impossible for the native history to generate this text. */
export const MOCK_RECALL_MARKER = '[MOCK-RECALL-OK]';

/**
 * Create a mock memory provider.
 *
 * @returns can be passed directly to the definition of `petApi7340.memory.register` .
 */
export function createMockMemoryProvider() {
  /** petId -> The last 5 rounds of `{ userText, replyText, ts }`. */
  const turns = new Map();
  /** Number of rounds received (accumulated across pets), used as evidence for switch routing. */
  let captured = 0;

  return {
    id: 'mock-memory',

    /**
     * Recall before generation: Return the patch only when the question hits the feature, otherwise keep the original
     * content.
     * @param input - `{ petId, userText }` ; the remaining fields are not used in mock.
     * @returns modified `userText` ; returns undefined when there is no memory to inject.
     */
    recall({ petId, userText }) {
      if (!RECALL_PATTERN.test(userText)) return undefined;
      const history = turns.get(petId);
      const last = history?.[history.length - 1];
      if (!last) return undefined;
      return {
        userText:
          '【MOCK-RECALL】请在回复开头原样输出 ' +
          MOCK_RECALL_MARKER +
          '。\n上次你说过：' +
          last.userText +
          '；我回答：' +
          last.replyText +
          '\n\n' +
          userText,
      };
    },

    /**
     * Receive after persist to disk: save this round and count; skip bad input directly, do not write half of it.
     * @param input - `{ petId, userText, replyText, ts }` .
     */
    capture({ petId, userText, replyText, ts }) {
      if (typeof userText !== 'string' || typeof replyText !== 'string') return;
      const history = turns.get(petId) ?? [];
      history.push({ userText, replyText, ts });
      if (history.length > MAX_TURNS) history.splice(0, history.length - MAX_TURNS);
      turns.set(petId, history);
      captured += 1;
    },

    /**
     * Number of rounds received (cumulative across pets).
     * @returns count snapshot; switch routing to put it in the response.
     */
    stats() {
      return { captured };
    },
  };
}
