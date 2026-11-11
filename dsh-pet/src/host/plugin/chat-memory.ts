/**
 * Dialogue and Memory: Read and write memory files, serialize dialogue queues, maintain active pets, and generate
 * whispers and replies.
 *
 * persona is assembled by ./persona, and model and memory service requests are delegated to ./chat, ./whisper, and
 * ./powercontext respectively. Dependencies are explicitly passed in by apply (see input type), and the module does
 * not read globals or create singletons.
 * @module dsh-pet/src/host/plugin/chat-memory
 */
import { join } from 'node:path';
import { generateChat, type ChatMemoryMessage } from '../chat.ts';
import { chatActionNames } from '../chat-action.ts';
import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { composeSystemPrompt, petPersona } from '../persona.ts';
import { findPetInstance, readAllConfig, removeRoundsByTs, sliceMemoryRounds } from '../config.ts';
import type { PetImageRef } from '../image-attachment.ts';
import { limitPool, matchMeme, pickMeme, readMemePool } from '../memes.ts';
import { generateWhisper } from '../whisper.ts';
import { createMemoryOrphans } from './memory-orphans.ts';
import { createPetMemoryLibrary } from './memory-library.ts';
import { configuredModel } from '../model-selection.ts';
import { SLEEP_TALK_INSTRUCTION } from '../whisper.ts';
import { pickVoiceSurface, type VoiceTarget } from '../surface.ts';
import type { HostSetup } from './setup.ts';
import type { HostContext } from './context.ts';
import { DEFAULT_CHAT_MEMORY, chatMemoryConfigValid, type ChatMemoryConfig } from '../../shared/chat-memory-config.ts';
import { boundedHistory, memoryRecallQuery } from '../memory-context.ts';
import {
  PowerContextClient,
  memoryState,
  memoryTarget,
  queueMemoryTurn,
  memoryErrorCode,
  type MemoryEntryState,
} from '../powercontext.ts';

import {
  activeChatMemoryProvider,
  type ChatContent,
  type ChatContentPatch,
  type ChatTurn,
} from '../chat-memory-provider.ts';

type MemoryEntry = { messages: ChatMemoryMessage[] } & MemoryEntryState;
type MemoryFile = Record<string, Record<string, MemoryEntry>>;

function memoryConfig(conf: Record<string, unknown>): ChatMemoryConfig {
  return chatMemoryConfigValid(conf.chatMemory) ? conf.chatMemory : { ...DEFAULT_CHAT_MEMORY };
}

/** Hard timeout for third-party recall (ms): Click "Do not modify content" to continue generating without delaying this round of dialogue. */
const RECALL_TIMEOUT_MS = 1500;

/** Validate history entries in a recall patch. Discard malformed history as a whole so invalid data cannot break generation. */
function isChatTurn(value: unknown): value is ChatTurn {
  const turn = value as { role?: unknown; content?: unknown; ts?: unknown } | null;
  return (
    (turn?.role === 'user' || turn?.role === 'assistant') &&
    typeof turn?.content === 'string' &&
    typeof turn?.ts === 'number'
  );
}

/** Which end should read this sentence: take the derivation of display of the pet instance (desktop priority); when both ends are not displayed, it is `undefined`. */
function voiceTargetFor(pet: Record<string, unknown>): VoiceTarget | undefined {
  return pickVoiceSurface(String(pet.display ?? '')) ?? undefined;
}

/** Input of dialogue and memory: assembly period objects and earlier factories. */
export type ChatMemoryInput = {
  /** host context (the one apply received). */
  ctx: HostContext;
} & Pick<HostSetup, 'configPaths'> &
  Pick<HostSetup, 'log'> &
  Pick<HostSetup, 'memeDirsFor'> &
  Pick<HostSetup, 'playback'> &
  Pick<HostSetup, 'state'> &
  Pick<HostSetup, 'userRoot'>;

/**
 * Create conversations and memories.
 */
export function createChatMemory(deps: ChatMemoryInput) {
  const { ctx, configPaths, log, memeDirsFor, playback, state, userRoot } = deps;
  // Command "current desktop pet" (/pet selected, /chat used): global single value regardless of session; in-process memory, restart back to the default first pet
  let activePetId = '';

  // The "last spawn time" of whisper periodic scheduling (according to pet): the scheduling time is determined based
  // on this. The generated result is directly written as S. Sharing the same sentence among multiple terminals is
  // naturally guaranteed by S, without the need for a second cache.
  const lastWhisperAt = new Map<string, number>();

  // Conversation memory file (the only reader and writer = this process; both the browser/desktop are just clients →
  // the same instance naturally shares the same memory). Structure double layer: { <type bucket assetRoot ?? petId >:
  // { <instance id >: { messages : ChatMemoryMessage [] } } }
  const memoryPath = join(userRoot, 'memory.json');

  // Conversation write operation serial queue: read-modify-write queue execution to prevent staggered disk writing when both ends are conversing at the same time.
  let chatQueue: Promise<void> = Promise.resolve();

  /** Refuse to overwrite an unreadable journal: it also owns remote scope and Source identities. */
  const readMemory = async (): Promise<MemoryFile> => {
    let raw: string;
    try {
      raw = await readFile(memoryPath, 'utf8');
    } catch (error) {
      if ((error as { code?: string }).code === 'ENOENT') return {};
      throw new Error('Chat memory could not be read; existing data was preserved.', { cause: error });
    }
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
      return parsed as MemoryFile;
    } catch {
      log.error('dsh-pet: invalid memory journal; refusing to overwrite it');
      throw new Error('Chat memory is invalid; restore memory.json from a backup before continuing.');
    }
  };

  const writeMemory = async (mem: MemoryFile): Promise<void> => {
    await mkdir(userRoot, { recursive: true });
    const temporary = memoryPath + '.' + randomUUID() + '.pending';
    try {
      await writeFile(temporary, JSON.stringify(mem, null, 2), {
        encoding: 'utf8',
        mode: 0o600,
        flag: 'wx',
        flush: true,
      });
      await rename(temporary, memoryPath);
    } finally {
      await rm(temporary, { force: true });
    }
  };

  /** Encapsulate a read and write into a serial queue (prevent interleaving within the same process) and return the result of fn */
  const withMemoryLock = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = chatQueue.then(fn, fn);
    chatQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  // Network delivery must not hold the chat journal lock: a slow Server must not queue every reply behind it.
  const deliveries = new Map<string, Promise<void>>();
  let disposed = false;
  const syncMemory = (petId: string): Promise<void> => {
    if (disposed) return Promise.resolve();
    const running = deliveries.get(petId);
    if (running) return running;
    const run = (async () => {
      for (let count = 0; count < 2; count += 1) {
        const snapshot = await withMemoryLock(async () => {
          if (disposed) return;
          const found = findPetInstance(readAllConfig(configPaths), petId);
          if (!found) return;
          const config = memoryConfig(found.conf);
          if (config.backend !== 'powercontext') return;
          const mem = await readMemory();
          const entry = mem[found.entry]?.[petId];
          if (!entry?.powercontext?.[memoryTarget(config)]) return;
          const sync = memoryState(entry, config);
          if (sync.deliveryBlocked || !sync.pending.length) return;
          return { entry: found.entry, config, sync, turn: sync.pending[0] };
        });
        if (!snapshot) return;
        let failure: string | undefined;
        try {
          await new PowerContextClient(snapshot.config).capture(snapshot.sync, snapshot.turn);
        } catch (error) {
          failure = memoryErrorCode(error);
        }
        await withMemoryLock(async () => {
          if (disposed) return;
          const mem = await readMemory();
          const sync = mem[snapshot.entry]?.[petId]?.powercontext?.[memoryTarget(snapshot.config)];
          // Deletion can cancel pending delivery while HTTP is in flight; never resurrect deleted local data.
          if (!sync || sync.scopeKey !== snapshot.sync.scopeKey) return;
          if (snapshot.sync.scopeId) sync.scopeId = snapshot.sync.scopeId;
          if (failure) {
            sync.lastError = failure;
            if (failure === 'http_409') sync.deliveryBlocked = true;
            log.warn('dsh-pet: memory sync ' + failure);
          } else {
            sync.pending = sync.pending.filter((turn) => turn.id !== snapshot.turn.id);
            sync.captured += 1;
            delete sync.lastError;
          }
          await writeMemory(mem);
        });
        if (failure) return;
      }
    })().finally(() => {
      deliveries.delete(petId);
    });
    deliveries.set(petId, run);
    return run;
  };

  // Scheduling belongs to the host lifecycle. Tests and callers can also explicitly drain a batch.
  if (typeof ctx.effect === 'function')
    ctx.effect(() => {
      let active = false;
      const tick = async () => {
        if (active || disposed) return;
        active = true;
        try {
          const cfg = readAllConfig(configPaths);
          for (const conf of Object.values(cfg)) {
            if (memoryConfig(conf).backend !== 'powercontext' || !Array.isArray(conf.pets)) continue;
            for (const pet of conf.pets) if (typeof pet.id === 'string') await syncMemory(pet.id);
          }
        } catch {
          log.warn('dsh-pet: memory background sync unavailable');
        } finally {
          active = false;
        }
      };
      const timer = setInterval(() => void tick(), 15000);
      timer.unref();
      return () => {
        disposed = true;
        clearInterval(timer);
      };
    });

  const memoryStatus = async (petId: string) => {
    const found = findPetInstance(readAllConfig(configPaths), petId);
    if (!found) return { ok: false as const, reason: 'unknown-pet' as const };
    const config = memoryConfig(found.conf);
    const mem = await readMemory();
    const sync = mem[found.entry]?.[petId]?.powercontext?.[memoryTarget(config)];
    return {
      ok: true as const,
      backend: config.backend,
      pending: sync?.pending.length ?? 0,
      captured: sync?.captured ?? 0,
      skipped: sync?.skipped ?? 0,
      scopeId: sync?.scopeId ?? null,
      recall: sync?.lastRecall ?? 'not_run',
      error: sync?.deliveryBlocked ? 'http_409' : (sync?.lastError ?? null),
      processing: 'Source capture does not establish Memory extraction.',
    };
  };

  /**
   * The final persona system of a certain pet: instance level `pets[].whisperPrompt` takes priority, and no fallback
   * is written to the share of the corresponding entry. assemble in ./persona (pure function): persona text + name
   * declaration + one line of time background, time is calculated each time; the conversation path is passed to
   * `{ historyTimes: true }` , and the [history] description is appended. Whisper has no history and is not passed.
   * Collect the hit result of `findPetInstance` instead of (petId, cfg): The caller has been parsed, and if you check
   * again, there will only be one more unreachable branch of "fallback main if not found".
   */
  const petSystemPrompt = (
    found: { conf: Record<string, unknown>; pet: Record<string, unknown> },
    options: { historyTimes?: boolean } = {},
  ): string =>
    composeSystemPrompt({
      prompt: petPersona(found.conf, found.pet),
      name: String(found.pet.name ?? ''),
      id: String(found.pet.id ?? ''),
      now: new Date(),
      ...(options.historyTimes === true ? { historyTimes: true } : {}),
    });

  /**
   * Number of dialogue memory rounds (1 round = 1 question 1 answer): chatMemoryRounds of the entry to which the pet
   * belongs (the merger has filled in the default). Receive the parsed entry configuration: The caller has received
   * the result of `findPetInstance` .
   */
  const memoryRounds = (conf: Record<string, unknown>): number => {
    const v = Number(conf.chatMemoryRounds);
    return Number.isFinite(v) && v >= 0 ? Math.floor(v) : 5;
  };

  /**
   * Modify content before dialogue: recall hook returns the fields to be covered, and the core is merged before being
   * handed over to the model.
   *
   * Timeouts, errors, and returning invalid shapes are treated as "not modified", and only the provider id and the
   * reason are recorded.
   *
   * @param petId - the target pet; third parties use it to distinguish memory space.
   * @param content - system/history/userText that will be sent to the model this round.
   * @returns is a valid override field; undefined is when no applicable field is available.
   */
  const recallPatch = async (petId: string, content: ChatContent): Promise<ChatContentPatch | undefined> => {
    const provider = activeChatMemoryProvider();
    const recall = provider?.recall;
    if (!provider || !recall) return undefined;
    let timer: NodeJS.Timeout | undefined;
    try {
      const timeout = new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), RECALL_TIMEOUT_MS);
        timer.unref?.();
      });
      const result = await Promise.race([Promise.resolve(recall.call(provider, { petId, ...content })), timeout]);
      if (!result || typeof result !== 'object') return undefined;
      const patch: { system?: string; history?: readonly ChatTurn[]; userText?: string } = {};
      if (typeof result.system === 'string') patch.system = result.system;
      if (typeof result.userText === 'string') patch.userText = result.userText;
      if (Array.isArray(result.history) && result.history.every(isChatTurn)) patch.history = result.history;
      return Object.keys(patch).length === 0 ? undefined : patch;
    } catch (error) {
      log.warn(
        '[dsh-pet] Memory recall failed id=' +
          provider.id +
          '：' +
          (error instanceof Error ? error.message : String(error)),
      );
      return undefined;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  };

  /**
   * After persist to disk, receive this round of Q&A: the core does not wait, and only the provider id and the reason
   * are recorded for failure.
   *
   * @param petId - Target pet.
   * @param turn - This round of Q&A and meta-information; action/image is just the name and does not contain the asset
   * itself.
   */
  const captureTurn = (
    petId: string,
    turn: { userText: string; replyText: string; action?: string; image?: string; ts: number },
  ): void => {
    const provider = activeChatMemoryProvider();
    const capture = provider?.capture;
    if (!provider || !capture) return;
    void Promise.resolve()
      .then(() => capture.call(provider, { petId, ...turn }))
      .catch((error) => {
        log.warn(
          '[dsh-pet] Memory capture failed id=' +
            provider.id +
            '：' +
            (error instanceof Error ? error.message : String(error)),
        );
      });
  };

  /**
   * Generate a pet whisper for scheduled, menu and command callers. Use its whisperPrompt or inherit the containing
   * entry's persona.
   * Publish successful text to S at pets.<id>.say, sharing the display path with commands and chat. Select a random
   * meme when enabled.
   * Return the actual failure reason, including unknown-pet/unknown-image, or generated text so callers need not
   * immediately reread /state.
   *
   * @param petId - Target pet instance ID.
   * @param image - Explicit image name, bypassing whisperImageEnabled. Return unknown-image if absent from the pool;
   * otherwise default to a random image or text according to configuration.
   * @param voiceTo - Playback surface, inferred from display when absent; desktop takes priority (see
   * {@link pickVoiceSurface} ). Routes with `?surface=` pass it explicitly.
   * @param kind - `whisper` respects `voiceWhisperEnabled` ; `manual` covers menu, slash-command and explicit route
   * requests and bypasses that switch. Defaults to `manual` .
   */
  const publishWhisper = async (
    petId: string,
    image?: string,
    voiceTo?: VoiceTarget,
    kind: 'whisper' | 'manual' = 'manual',
  ): Promise<
    | { ok: true; text: string; image?: string }
    | { ok: false; reason: 'provider-missing' | 'generate-error' | 'unknown-pet' | 'unknown-image'; message?: string }
  > => {
    const cfg = readAllConfig(configPaths);
    const found = findPetInstance(cfg, petId);
    // The pet may be deleted between the "verification reading" and here (the configuration may change at any time,
    // and the window is between two reads): clear failure, no generation, no writing S - written down is a ghost leaf
    // that no longer exists (resident until the process is restarted).
    if (!found) return { ok: false, reason: 'unknown-pet', message: '没有这只桌宠：' + petId };
    // Each type of voice is determined by its own switch: for periodic scheduling, see voiceWhisperEnabled, for manual
    // triggering (right-click menu, slash command), see voiceEnabled. Leaves without voiceTo = no one wants to play,
    // bubble still plays.
    const whisperVoiceOn = cfg.main?.voiceWhisperEnabled === true;
    const manualVoiceOn = cfg.main?.voiceEnabled === true;
    const voiceOff = kind === 'whisper' ? !whisperVoiceOn : !manualVoiceOn;
    const target = voiceOff ? undefined : (voiceTo ?? voiceTargetFor(found.pet));
    const system = petSystemPrompt(found);
    // The pool is only counted once: the named picture and the randomly drawn picture share the same one (including file existence determination).
    const pool = readMemePool(found.conf.memes, memeDirsFor(found.entry));
    // I called the name but missed = the configuration was wrongly written or the picture has been deleted: the clear failed, do not silently change to another one (if you click A but see B, you will think it is broken).
    const forced = image === undefined ? undefined : matchMeme(pool, image);
    if (image !== undefined && forced === undefined) {
      return { ok: false, reason: 'unknown-image', message: '表情包不在池内：' + image };
    }
    const meme = forced ?? (found.conf.whisperImageEnabled === true ? pickMeme(pool) : undefined);
    // Model: whisperModel of the entry configuration takes precedence (leave blank = not specified); failure on the generation side will fallback to the model of the current conversation and try again.
    const result = await generateWhisper(ctx, {
      system,
      meme,
      preferred: configuredModel(found.conf, 'whisperModel'),
    });
    if (!result.ok) {
      // Do not write S on failure: silently skip + warn, no forged text, no error bubbles
      log.warn(
        '[dsh-pet] Whisper generation failed pet=' +
          petId +
          ' reason=' +
          result.reason +
          (result.message ? ' ' + result.message : ''),
      );
      // The real reason is brought back as it is: If the route is hardcoded as generate-error, the provider-missing
      // calculated in standalone mode will be swallowed at the boundary (API.md describes the downgrade reason).
      return result;
    }
    state.writePet(petId, 'say', {
      text: result.text,
      ...(result.image ? { image: result.image } : {}),
      ...(target ? { voiceTo: target } : {}),
    });
    // Leave a line for success: otherwise "not triggered" and "triggered and successful" in logs.txt cannot be distinguished.
    log.info(
      `[dsh-pet] Whisper generated pet=${petId}, ${result.text.length} characters` +
        (result.image ? `, image=${result.image}` : ''),
    );
    // The text is brought out with the return value, and it is the same variable as the one just written into the leaf: two exits give the same text, not two versions of the same truth.
    return { ok: true, text: result.text, ...(result.image ? { image: result.image } : {}) };
  };

  /**
   * Generate and write a sleep whisper: system Only use persona, and the function command is whisper (the same code
   * constant as whisper); no pictures, no reading, no animation. "Changing animations" while sleeping is a disturbance
   * in itself, so write `say` instead of explicit `anim: false` , and don't write `voiceTo` either.
   * Whether @returns is really generated and written into S; if it fails, only one line of log will be left, and the
   * next tick will be scheduled to try again.
   */
  const publishSleepTalk = async (petId: string): Promise<boolean> => {
    const cfg = readAllConfig(configPaths);
    const found = findPetInstance(cfg, petId);
    if (!found) return false;
    const system = petSystemPrompt(found);
    const result = await generateWhisper(ctx, {
      system,
      preferred: configuredModel(found.conf, 'whisperModel'),
      instruction: SLEEP_TALK_INSTRUCTION,
    });
    if (!result.ok) {
      log.warn(
        '[dsh-pet] Dream speech generation failed pet=' +
          petId +
          ' reason=' +
          result.reason +
          (result.message ? ' ' + result.message : ''),
      );
      return false;
    }
    state.writePet(petId, 'say', { text: result.text, anim: false });
    log.info(`[dsh-pet] Dream speech generated pet=${petId}, ${result.text.length} characters`);
    return true;
  };

  /**
   * Conversation with a certain pet: intercept recent memory → generate reply → write to memory → write pets .< id >.
   * say of S. Shared by POST /chat and / chat commands (reading and writing within the lock to prevent interleaved
   * disk writing at both ends); successfully brings back the reply text.
   */
  const chatWithPet = async (
    petId: string,
    text: string,
    image?: PetImageRef,
  ): Promise<
    | { ok: true; text: string; image?: string }
    | { ok: false; reason: 'provider-missing' | 'generate-error' | 'unknown-pet'; message?: string }
  > =>
    withMemoryLock(async () => {
      const cfg = readAllConfig(configPaths);
      const found = findPetInstance(cfg, petId);
      // The pet was deleted between the "verification reading" and here - this function also needs to queue the serial
      // queue of withMemoryLock first. The window may be seconds, so this one will really hit. Definite failure: no
      // generation, no memory writing, no leaf writing, otherwise a deleted pet bucket and a ghost leaf will be
      // permanently left in memory.json.
      if (!found) return { ok: false, reason: 'unknown-pet', message: '没有这只桌宠：' + petId };
      const rounds = memoryRounds(found.conf);
      // Picture: switch off → empty pool (instructions and analysis are not involved); directory links are taken
      // according to the corresponding entries. The upper limit of the number of sheets (chatImageLimit, 0 = no
      // limit): the entire list must be attached to each message, and the upper limit of the cost is controllable
      // after truncation.
      const pool =
        found.conf.chatImageEnabled === true
          ? limitPool(readMemePool(found.conf.memes, memeDirsFor(found.entry)), Number(found.conf.chatImageLimit))
          : [];
      // Action list: Take only when the switch is turned on (off = no injection or parsing); the list itself is empty (no categories is configured), which is also equivalent to being closed.
      const actions = found.conf.chatAnimationEnabled === true ? chatActionNames(found.conf.animations) : [];
      const mem = await readMemory();
      // Bad structure (array/scalar) is rebuilt as an empty bucket; messages entries that are not arrays are processed as new sessions to avoid push crashing on bad objects
      const bucket =
        mem[found.entry] && typeof mem[found.entry] === 'object' && !Array.isArray(mem[found.entry])
          ? mem[found.entry]
          : (mem[found.entry] = {});
      const existing = bucket[petId];
      if (existing !== undefined && (!existing || !Array.isArray(existing.messages))) {
        log.error(
          `[dsh-pet] Invalid memory structure (messages is not an array) pet=${petId}; starting a new conversation: ${memoryPath}`,
        );
      }
      const entry =
        existing && typeof existing === 'object' && !Array.isArray(existing)
          ? existing
          : (bucket[petId] = { messages: [] });
      if (!Array.isArray(entry.messages)) entry.messages = [];
      // rounds = 0 (user turns off history) → empty history; otherwise, truncate the tail rounds rounds (1 round = 1
      // question 1 answer). Cannot write slice (- rounds * 2): -0 In JS === 0, slice (-0) returns the entire array
      // instead of empty.
      const config = memoryConfig(found.conf);
      const list =
        config.maxHistoryBytes > 0
          ? boundedHistory(entry.messages, rounds, config.maxHistoryBytes)
          : sliceMemoryRounds(entry.messages, rounds);
      let recalledContext: string | undefined;
      if (config.backend === 'powercontext') {
        const sync = memoryState(entry, config);
        // Persist the scope idempotency key before the first external call.
        await writeMemory(mem);
        try {
          recalledContext = await new PowerContextClient(config).prepare(sync, memoryRecallQuery(list, text));
        } catch (error) {
          sync.lastRecall = 'unavailable';
          sync.lastError = memoryErrorCode(error);
          log.warn('dsh-pet: memory recall ' + sync.lastError);
        }
        await writeMemory(mem);
      }
      // persona: instance level whisperPrompt takes priority, and the entry of fallback is not written (the same
      // assemble as whisper). Only add the [History] paragraph when there is history: When there is no history, that
      // paragraph is describing a prefix that does not exist, which will only mislead the model.
      const system = petSystemPrompt(found, { historyTimes: list.length > 0 });
      // Only the size and number of bytes of the image are recorded (base64 is not recorded): When the model does not support image reading, dsh-llm will project it into a placeholder text, and rely on this line of logs to locate it.
      if (image !== undefined) {
        log.info(
          `[dsh-pet] Chat image pet=${petId}, ${image.width}x${image.height}, ${image.bytes} bytes` +
            '(the kernel substitutes placeholder text if the model cannot read images)',
        );
      }
      // Third-party memory: Modify content before dialogue; fail or time out and downgrade to original content (see recallPatch).
      const patch =
        config.backend === 'powercontext'
          ? undefined
          : await recallPatch(petId, {
              system,
              history: list.map(({ role, content, ts }) => ({ role, content, ts })),
              userText: text,
            });
      // Model: chatModel of the entry configuration takes precedence (leave blank = not specified); failure on the generation side will fallback to the model of the current conversation and try again.
      const generated = await generateChat({
        ctx,
        system: patch?.system ?? system,
        history: patch?.history ?? list,
        recalledContext,
        userText: patch?.userText ?? text,
        pool,
        actions,
        preferred: configuredModel(found.conf, 'chatModel'),
        image,
      });
      if (!generated.ok) return generated;
      const now = Date.now();
      // The pictures uploaded by the user are only saved but not sent: the memory must be able to restore the
      // "pictures brought in this round" (chat record archive), but the picture itself is not resent to the model; the
      // picture with AI only backfills the name tag (see chat.ts's historyMarkersOf), and also does not have the
      // picture itself.
      entry.messages.push({ role: 'user', content: text, ts: now, ...(image ? { image } : {}) });
      entry.messages.push({
        role: 'assistant',
        content: generated.text,
        ts: now,
        ...(generated.image ? { meme: generated.image } : {}),
        // The action name is the same as the picture name: persist to disk only saves the name, and when replaying the
        // history, chat.ts will backfill it with [action: name] - otherwise the model cannot remember what it has
        // performed, and it will not be able to judge if the user says "change it"
        ...(generated.action ? { action: generated.action } : {}),
      });
      if (config.backend === 'powercontext') queueMemoryTurn(memoryState(entry, config), text, generated.text, now);
      await writeMemory(mem);
      if (config.backend === 'powercontext') {
        // The synchronization is queued after the current persist to disk lock, and the reply does not wait for remote collection.
        void syncMemory(petId).catch(() => log.warn('dsh-pet: memory sync persistence unavailable'));
      } else {
        // Exclusive memory link when PowerContext is explicitly selected to avoid repeated collection by third-party backends.
        captureTurn(petId, {
          userText: text,
          replyText: generated.text,
          ts: now,
          ...(generated.action !== undefined ? { action: generated.action } : {}),
          ...(generated.image !== undefined ? { image: generated.image } : {}),
        });
      }
      // The action is written first: the same writeback link as POST /anim (record + anim leaf), the renderer plays and reports the execution accordingly.
      if (generated.action !== undefined) {
        const record = playback.create(petId, generated.action);
        state.writePet(petId, 'anim', { name: generated.action, playbackId: record.playbackId });
      }
      // The reply is written into S (the same leaf as whisper: the front end is originally the same display link).
      // Which end should press this pet's display push: The dialogue request contains surface = any, and there is no
      // specific end available. The conversation reply returns to "manual broadcasting": this sentence is only
      // available after the user sends a message, and it is up to voiceEnabled to decide whether to read it or not.
      const replyVoiceTo = cfg.main?.voiceEnabled === true ? voiceTargetFor(found.pet) : undefined;
      // Only actions but no text (the model is marked write-only) → Do not write say to avoid popping an empty bubble.
      if (generated.text !== '') {
        state.writePet(petId, 'say', {
          text: generated.text,
          ...(generated.image ? { image: generated.image } : {}),
          // Explicitly turn off the whisper animation when taking action: the bubble is played, but the action of the just playback request is not blocked.
          ...(generated.action !== undefined ? { anim: false } : {}),
          ...(replyVoiceTo ? { voiceTo: replyVoiceTo } : {}),
        });
      }
      // The same text is brought out with the return value (the leaves are written as written, not one of the two)
      return { ok: true as const, text: generated.text, ...(generated.image ? { image: generated.image } : {}) };
    });

  /**
   * Delete the dialogue memory of a certain pet: `ts` default = clear all, given ts = only delete the hit round (two
   * in a round share ts, delete in pairs). Shares the same serial queue as the conversation - deletion will not be
   * inserted into the read-modify-write interval of a reply, nor will it be overwritten by it. Empty entries are
   * removed after native pets are deleted; pets that have been bound to long-term memory remain bound, and only
   * evidence that has not yet been sent is cancelled.
   */
  const deleteHistory = async (
    petId: string,
    ts?: readonly number[],
  ): Promise<{ ok: true; removed: number } | { ok: false; reason: 'unknown-pet'; message: string }> =>
    withMemoryLock(async () => {
      const cfg = readAllConfig(configPaths);
      const found = findPetInstance(cfg, petId);
      // Same as the dialogue: pets may be deleted at any time, clear failure, no unconsumed buckets are left in the file
      if (!found) return { ok: false as const, reason: 'unknown-pet' as const, message: '没有这只桌宠：' + petId };
      const mem = await readMemory();
      const byPet = mem[found.entry];
      const before = byPet?.[petId]?.messages;
      const list = Array.isArray(before) ? before : [];
      const kept = ts === undefined ? [] : removeRoundsByTs(list, ts).messages;
      const removed = list.length - kept.length;
      if (removed > 0) {
        const leaf = byPet?.[petId];
        if (leaf?.powercontext) {
          leaf.messages = kept;
          // Local history deletion cancels unsent evidence but does not pretend to erase remote Memory.
          for (const sync of Object.values(leaf.powercontext)) {
            sync.pending = ts === undefined ? [] : sync.pending.filter((turn) => !ts.includes(turn.at));
          }
        } else if (kept.length > 0 && leaf !== undefined) {
          leaf.messages = kept;
        } else if (byPet !== undefined) {
          // clear (or only bad data is left): remove the pet leaves; if the entry is empty, remove the entry as well
          delete byPet[petId];
          if (Object.keys(byPet).length === 0) delete mem[found.entry];
        }
        await writeMemory(mem);
      }
      // Only remember the quantity and action, without typing the text (the memory content is user privacy)
      log.info(
        `[dsh-pet] Deleted chat history pet=${petId}, removed=${removed}` + (ts === undefined ? '(cleared all)' : ''),
      );
      return { ok: true as const, removed };
    });

  /** Query and clean up the residual history of deleted pets (see ./memory-orphans for details on determination and reading and writing). */
  const { orphanHistory, deleteOrphans } = createMemoryOrphans({
    configPaths,
    readMemory,
    writeMemory,
    withLock: withMemoryLock,
    log,
  });

  /** Currently active pet id (session event writing, balance and thoughts reading). */
  const getActivePetId = (): string => activePetId;

  /** Rewrite the currently active pet id. */
  const setActivePetId = (id: string): void => {
    activePetId = id;
  };
  return {
    ...createPetMemoryLibrary({ configPaths, readMemory, withLock: withMemoryLock }),
    syncMemory,
    memoryStatus,
    lastWhisperAt,
    memoryPath,
    readMemory,
    memoryRounds,
    publishWhisper,
    publishSleepTalk,
    chatWithPet,
    deleteHistory,
    orphanHistory,
    deleteOrphans,
    getActivePetId,
    setActivePetId,
  };
}
/** Output of dialogue and memory (for downstream factories on demand Pick). */
export type ChatMemory = ReturnType<typeof createChatMemory>;
