/**
 * Data access in desktop pet dialog window: pet list, history window, send a sentence, delete wheel.
 *
 * Only HTTP and response shaping are performed, DOM is not touched, and the state is not maintained; if it fails, an
 * error is thrown or the judgment is combined, and the caller decides how to display it - do not silently fallback the
 * exception into an empty list.
 * @module dsh-pet/src/client/chat/api
 */
import { sendChat, type ChatAttachment } from '../../shared/chat/send.ts';
import { flattenConfigPets } from '../../shared/config.ts';
import { ROUTE_PATH } from '../../shared/constants.ts';
import { postAction } from '../../shared/state.ts';
import type { Pet } from '../../shared/types.ts';

/** The picture reference in the message (same shape as host `PetImageRef`, only the fields used for display are taken). */
export interface ChatImageRef {
  readonly attachmentId: string;
  readonly mediaType: string;
  readonly bytes: number;
  readonly width: number;
  readonly height: number;
}

/** A message in the history (only these items are displayed in the window). */
export interface ChatMessageView {
  readonly role: 'user' | 'assistant';
  readonly text: string;
  readonly ts: number;
  /** Pictures uploaded by users in this round (retrieved by `/attachment`); default = plain text. */
  readonly image?: ChatImageRef;
  /** The name of the meme matched by AI in this round (retrieved by `/pic/memes`); default = no picture. */
  readonly meme?: string;
  /** The name of the action performed by AI in this round (input parameter of the replay button); default = no action performed. */
  readonly action?: string;
}

/** One round of dialogue: one question and one answer share the same ts. Even if one side is missing (for example, deleted), it only occupies one round. */
export interface ChatRound {
  readonly ts: number;
  readonly user?: ChatMessageView;
  readonly assistant?: ChatMessageView;
}

/** Delete receipt. */
export type DeleteResult = { ok: true; removed: number } | { ok: false; message: string };

/** Verify and narrow an image reference; if the shape is incorrect, undefined is returned (old records do not have this field). */
function imageRefOf(raw: unknown): ChatImageRef | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const ref = raw as Record<string, unknown>;
  if (typeof ref.attachmentId !== 'string' || ref.attachmentId === '') return undefined;
  const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
  return {
    attachmentId: ref.attachmentId,
    mediaType: typeof ref.mediaType === 'string' ? ref.mediaType : 'image/png',
    bytes: num(ref.bytes),
    width: num(ref.width),
    height: num(ref.height),
  };
}

/**
 * Response body of `GET /chat` → message list.
 *
 * @param body - response to JSON (unchecked).
 * @returns is a message where both the character and the text are valid; bad entries are discarded directly, and one
 * piece of bad data should not cause the entire history to report an error.
 */
export function toChatMessages(body: unknown): ChatMessageView[] {
  const raw = (body as { messages?: unknown } | null)?.messages;
  if (!Array.isArray(raw)) return [];
  const out: ChatMessageView[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const m = item as Record<string, unknown>;
    const role = m.role === 'assistant' ? 'assistant' : m.role === 'user' ? 'user' : undefined;
    if (role === undefined || typeof m.content !== 'string') continue;
    const image = imageRefOf(m.image);
    const meme = typeof m.meme === 'string' && m.meme !== '' ? m.meme : undefined;
    const action = typeof m.action === 'string' && m.action !== '' ? m.action : undefined;
    out.push({
      role,
      text: m.content,
      ts: typeof m.ts === 'number' ? m.ts : 0,
      ...(image === undefined ? {} : { image }),
      ...(meme === undefined ? {} : { meme }),
      ...(action === undefined ? {} : { action }),
    });
  }
  return out;
}

/**
 * Group by round: Questions and Answers for the same `ts` synthesis round - display by round, delete also by round.
 *
 * When `ts` is 0 (there is no timestamp in the history), each message forms its own round: otherwise, all messages
 * without timestamps will be merged into one round.
 *
 * @param messages - chronological messages.
 * @returns Wheels in order of appearance.
 */
export function groupRounds(messages: readonly ChatMessageView[]): ChatRound[] {
  const rounds: ChatRound[] = [];
  for (const message of messages) {
    const last = rounds[rounds.length - 1];
    if (last !== undefined && last.ts === message.ts && message.ts !== 0) {
      rounds[rounds.length - 1] =
        message.role === 'user' ? { ...last, user: message } : { ...last, assistant: message };
      continue;
    }
    rounds.push(message.role === 'user' ? { ts: message.ts, user: message } : { ts: message.ts, assistant: message });
  }
  return rounds;
}

/** Plugin logo address and pet avatar address: The assemble rule is in shared/avatar.ts, and the panel only does re-export. */
export { avatarUrl, LOGO_URL } from '../../shared/avatar.ts';

/**
 * Let the pet replay an action recorded in the memory ("Play Action" button in the chat window).
 *
 * Use `/anim` instead of directly changing to state: the host link is responsible for whitelist verification,
 * occupation lock, renderer validation check, and playback receipt.
 *
 * @param petId - pet id.
 * @param name - Action name recorded in memory (from `animations.categories` ).
 * @returns Whether the acceptance is successful; if it fails, only the log will be left, and no error bar will pop up
 * - it is just a replay and does not affect the main flow of the conversation.
 */
export async function playAction(petId: string, name: string): Promise<boolean> {
  // surface = any: Same conventions as dialogue - replay does not require a specific end, and the pet will be played
  // on whichever end it is rendered. / surface of anim is required (default is 400) and cannot be omitted here.
  return postAction(ROUTE_PATH + '/anim?pet=' + encodeURIComponent(petId) + '&surface=any', { name });
}

/** Attachment reference → Image retrieval address (host hashes back bytes by content). */
export function attachmentUrl(ref: ChatImageRef): string {
  return ROUTE_PATH + '/attachment?id=' + encodeURIComponent(ref.attachmentId);
}

/**
 * Meme name → image address.
 *
 * @param name - the name written down in memory.
 * @param assetRoot - The entry to which the pet belongs (asset root); when the string is empty, the two-segment form
 * is returned (the image exclusive to the pet package cannot be obtained).
 */
export function memeUrl(name: string, assetRoot: string): string {
  const root = assetRoot.trim();
  const prefix = root === '' ? '' : encodeURIComponent(root) + '/';
  return ROUTE_PATH + '/pic/memes/' + prefix + encodeURIComponent(name) + '.png';
}

/** The configuration required for the panel: pet list + number of dialogue turns reserved for each entry + persona text for each pet. */
export interface ChatConfig {
  readonly pets: Pet[];
  /** Entry (asset root) → `chatMemoryRounds` configured for this entry; missing entries do not appear in the table. */
  readonly roundsByEntry: Readonly<Record<string, number>>;
  /** Pet id → The actual persona text in use; see {@link personaText} for value conventions. */
  readonly personaByPet: Readonly<Record<string, string>>;
}

/**
 * The actual persona text used by a pet.
 *
 * Two levels: instance-level non-blank priority (**replace** the copy of the entry it belongs to, not concatenate),
 * otherwise use the top-level copy of the entry - the top-level entry of the main entry is the built-in default
 * sentence, so it will not be an empty string under normal configuration.
 *
 * @param own - `pets[].whisperPrompt` ; Default or pure blank is regarded as not written.
 * @param entry - The top level of the entry to which it belongs is `whisperPrompt` ; non-character strings are treated
 * as unwritten.
 * @returns instance-level original text (preserve typesetting, not trim) or entry copy; when neither is included, it
 * is an empty string.
 */
export function personaText(own: unknown, entry: unknown): string {
  if (typeof own === 'string' && own.trim() !== '') return own;
  return typeof entry === 'string' ? entry : '';
}

/**
 * Pull the resolved configuration: Flatten the pet list, and bring out the dialogue memory rounds of each
 * entry and the persona of each pet.
 *
 * The settings page reads the same `/config` (`merged.main.chatMemoryRounds`), here it is taken by entry, and the
 * panel takes the same persona and entry configuration; the actual number of recent context rounds is returned by the
 * history interface.
 *
 * @returns Pet list, entry round table and pet persona table.
 * @throws When a configuration request fails or the response is not a finished aggregate.
 */
export async function fetchChatConfig(): Promise<ChatConfig> {
  const res = await fetch(ROUTE_PATH + '/config', { cache: 'no-store' });
  if (!res.ok) throw new Error('config HTTP ' + res.status);
  const body = (await res.json()) as Record<string, unknown>;
  // Business failure is also 200: The body of ok:false is not a resolved value. If you flatten it, it will silently degenerate into the default pet.
  if (body.ok === false) throw new Error('config: ' + String(body.reason ?? 'failed'));
  const merged = body as Record<string, Record<string, unknown>>;
  const roundsByEntry: Record<string, number> = {};
  for (const [entry, conf] of Object.entries(merged)) {
    const rounds = Number(conf?.chatMemoryRounds);
    if (Number.isFinite(rounds) && rounds >= 0) roundsByEntry[entry] = Math.floor(rounds);
  }
  const pets = flattenConfigPets(merged);
  const personaByPet: Record<string, string> = {};
  for (const pet of pets) {
    const entry = merged[pet.assetRoot ?? '']?.whisperPrompt;
    personaByPet[pet.id] = personaText(pet.whisperPrompt, entry);
  }
  return { pets, roundsByEntry, personaByPet };
}

/**
 * Recent context boundary: The last `memoryRounds` round enters the next round of model input, and the long-term
 * memory is also recalled.
 *
 * @param totalRounds - The number of rounds currently displayed.
 * @param memoryRounds - host is the number of recent rounds actually selected; `undefined` means it has not been
 * obtained yet.
 * @returns dividing subscript (the line is inserted before the subscript); no line is drawn when all are within the
 * recent window; the zero round time line is at the end of history.
 */
export function memoryBoundaryIndex(totalRounds: number, memoryRounds: number | undefined): number | null {
  if (memoryRounds === undefined || memoryRounds < 0) return null;
  const cut = totalRounds - memoryRounds;
  return cut > 0 ? cut : null;
}

/** The positioning mark of the dividing line node: click on the "memory line" of the toolbar to find the element, without relying on the class name. */
export const MEMORY_LINE_ATTR = 'data-pet-chat-memory';

/**
 * Minimum number of presentation rounds required for the memory boundary to enter the visible window.
 *
 * The line is inserted before the penultimate round `memoryRounds` . There must be at least one round above it in the
 * window before the line can be drawn.
 *
 * @param memoryRounds - The number of rounds this entry is retained for.
 * @returns The number of display rounds required; `memoryRounds` returns 0 when negative; zero rounds display at least
 * one round to locate the end boundary.
 */
export function roundsToRevealMemory(memoryRounds: number): number {
  return memoryRounds >= 0 ? memoryRounds + 1 : 0;
}

/** The number of rounds allowed by the interface is full at one time (the upper limit of the host is 200): the panel is displayed locally on demand, and the number is not paged. */
export const HISTORY_ROUNDS = 200;

/**
 * Read the conversation history of a certain pet.
 *
 * If 200 rounds are obtained in one request, the display layer will control "how many to display first"; if `rounds`
 * is not passed, it will only get the configured default number of rounds.
 *
 * @param petId - Pet id.
 * @returns displays messages in chronological order, as well as the actual number of recent rounds calculated by the
 * host's budget.
 * @throws when the request fails.
 */
export async function fetchHistory(petId: string): Promise<{ messages: ChatMessageView[]; contextRounds?: number }> {
  const url = ROUTE_PATH + '/chat?pet=' + encodeURIComponent(petId) + '&rounds=' + HISTORY_ROUNDS;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error('chat HTTP ' + res.status);
  const data = (await res.json()) as { contextRounds?: number };
  return {
    messages: toChatMessages(data),
    contextRounds: Number.isInteger(data.contextRounds) && data.contextRounds! >= 0 ? data.contextRounds : undefined,
  };
}

/**
 * Send a sentence to a pet.
 *
 * @param petId - Pet id.
 * @param text - User input (host trim and verify 2000 word limit).
 * @param attachment - optional one image (compressed specification base64).
 * @returns success receipt, or failure copy that can be displayed directly.
 * @throws When the network is interrupted or the response is not JSON.
 */
export async function sendMessage(
  petId: string,
  text: string,
  attachment?: ChatAttachment,
): Promise<{ ok: true } | { ok: false; message: string }> {
  // surface = any: The dialogue window does not look at the rendering results, and pets hidden (display: none) should also be able to dialogue.
  const url = ROUTE_PATH + '/chat?pet=' + encodeURIComponent(petId) + '&surface=any';
  const result = await sendChat(url, text, attachment);
  return result.ok ? { ok: true } : { ok: false, message: result.message ?? result.reason };
}

/** Narrow the deletion response to a receipt; `ts` is empty = clear the entire one. */
async function deleteChat(petId: string, ts: readonly number[]): Promise<DeleteResult> {
  const query = ts.map((value) => '&ts=' + encodeURIComponent(String(value))).join('');
  const res = await fetch(ROUTE_PATH + '/chat?pet=' + encodeURIComponent(petId) + query, { method: 'DELETE' });
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (body?.ok === true) return { ok: true, removed: Number(body.removed ?? 0) };
  const reason = typeof body?.message === 'string' ? body.message : 'HTTP ' + res.status;
  return { ok: false, message: reason };
}

/**
 * Delete several rounds (press `ts` , ask and answer together).
 *
 * @param petId - Pet id.
 * @param ts - The wheel to delete; an empty array means none are selected.
 * @returns The actual number of deleted items, or the failed copy.
 * @throws When the network is interrupted.
 */
export async function deleteRounds(petId: string, ts: readonly number[]): Promise<DeleteResult> {
  if (ts.length === 0) return { ok: true, removed: 0 };
  return deleteChat(petId, ts);
}

/**
 * clear the entire history of a pet.
 *
 * @param petId - Pet id.
 * @returns The actual number of deleted items, or the failed copy.
 * @throws When the network is interrupted.
 */
export async function clearHistory(petId: string): Promise<DeleteResult> {
  return deleteChat(petId, []);
}

/** A piece of history of a deleted pet (only the number and last time are given, not the text). */
export interface OrphanHistory {
  readonly entry: string;
  readonly petId: string;
  readonly messages: number;
  readonly lastTs: number;
}

/**
 * Read the remaining history of deleted pets.
 *
 * These pets are no longer in the configuration, `GET /chat` is always `unknown-pet` - they can neither be seen nor
 * cleared without relying on this interface.
 *
 * @returns Each residue is divided into one bucket; when there are no residues, it is an empty list.
 * @throws when the request fails.
 */
export async function fetchOrphans(): Promise<OrphanHistory[]> {
  const res = await fetch(ROUTE_PATH + '/chat/memory', { cache: 'no-store' });
  if (!res.ok) throw new Error('chat/memory HTTP ' + res.status);
  const body = (await res.json()) as { orphans?: unknown };
  const raw = Array.isArray(body.orphans) ? body.orphans : [];
  const out: OrphanHistory[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const one = item as Record<string, unknown>;
    if (typeof one.petId !== 'string') continue;
    out.push({
      entry: typeof one.entry === 'string' ? one.entry : '',
      petId: one.petId,
      messages: typeof one.messages === 'number' ? one.messages : 0,
      lastTs: typeof one.lastTs === 'number' ? one.lastTs : 0,
    });
  }
  return out;
}

/**
 * Clear the history of all deleted pets.
 *
 * @returns The number of deleted pets and messages, or failed text.
 * @throws When the network is interrupted.
 */
export async function clearOrphans(): Promise<
  { ok: true; pets: number; messages: number } | { ok: false; message: string }
> {
  const res = await fetch(ROUTE_PATH + '/chat/memory', { method: 'DELETE' });
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (body?.ok === true) return { ok: true, pets: Number(body.pets ?? 0), messages: Number(body.messages ?? 0) };
  return { ok: false, message: typeof body?.message === 'string' ? body.message : 'HTTP ' + res.status };
}
