/**
 * Plugin entry point: Cordis plugin, assembles the configuration, route, slash command, polling and desktop Helper
 * of host side to ctx. The assembly sequence cannot be changed: `getHandlePetRoute` is used lazily (`httpRoute` is
 * created later in this function), `startHelper` must be called last.
 * @module dsh-pet/src/host/index
 */
import { createHostSetup } from './plugin/setup.ts';
import { registerManagedMemory } from './plugin/managed-memory.ts';
import { readAllConfig } from './config.ts';
import { createHttpRoute, registerHttpRoute } from './plugin/http-route.ts';
import { registerLifecycle } from './plugin/lifecycle.ts';
import { registerChatCommand } from './plugin/command-chat.ts';
import { registerPetCommand } from './plugin/command-pet.ts';
import { registerLoops } from './plugin/loops.ts';
import { registerBalanceCommand } from './plugin/command-balance.ts';
import { registerSessionWatch } from './plugin/session-watch.ts';
import { createDesktopHelper } from './plugin/desktop-helper.ts';
import { createBalancePoll } from './plugin/balance-poll.ts';
import { createChatMemory } from './plugin/chat-memory.ts';
import { createSessionNotify } from './plugin/session-notify.ts';
import { createPetLookup } from './plugin/pet-lookup.ts';
import { createDownloadReport } from './plugin/download-report.ts';
import { createWorkStatusBridge } from './plugin/work-status-bridge.ts';
import { registerTodoReminders } from './plugin/todo-reminders.ts';
import { createVoiceService } from './voice/speak.ts';
import { createHearService } from './voice/hear.ts';
import { TODO_FILE_NAME, TodoStore } from './todo/store.ts';
import { join } from 'node:path';
import type { PetRouteDeps } from './routes/types.ts';

/** Plugin row id (consistent with cordis.patch.yml) */
export const name = 'pet';
/** Services that need to be injected: webServer (route) + agentDefaultModel (current service provider) + credentials (credential) + llm (dialog model call) + commands (/ balance slash command) + connection (desktop Helper "Open AI Authenticated site URL used in Settings) */
export const inject = ['webServer', 'agentDefaultModel', 'credentials', 'llm', 'commands', 'connection'];

/** host plugin body: register `/dsh-pet-7340` prefix route with slash command (/ balance / pet / chat); ctx temporarily uses any (peer type package cannot be parsed locally). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- DSH-injected webServer/locale services have no static types.
export function apply(ctx: any): void {
  const setup = createHostSetup(ctx);
  const {
    userRoot,
    log,
    configPaths,
    thumbUserRoot,
    memeDirsFor,
    standaloneAiPolicy,
    standaloneAiBalance,
    state,
    playback,
    workStatus,
    EXTERNAL_WORK_SESSION,
    nextExternalWorkSeq,
  } = setup;
  const workStatusBridge = createWorkStatusBridge({ state, workStatus, EXTERNAL_WORK_SESSION });
  const { publishWorkStatus, stopWorkStatusFlush } = workStatusBridge;
  const downloadReport = createDownloadReport({
    EXTERNAL_WORK_SESSION,
    nextExternalWorkSeq,
    publishWorkStatus,
    workStatus,
  });
  const { reportDownload, stopDownloadSlotTimer } = downloadReport;
  const petLookup = createPetLookup({ state, configPaths });
  const { lock, sleep, sleepRefusalText } = petLookup;
  const sessionNotify = createSessionNotify({ ctx, publishWorkStatus, state, workStatus });
  const {
    pushNotifyFrame,
    turnFlags,
    terminalTimers,
    lastTodoText,
    lastReplyText,
    toolsInFlight,
    cancelTerminalCleanup,
    scheduleTerminalCleanup,
    notifyActivityTimers,
    scheduleCompletionNotify,
  } = sessionNotify;
  const chatMemory = createChatMemory({ ctx, configPaths, log, memeDirsFor, playback, state, userRoot });
  const { lastWhisperAt, publishWhisper, publishSleepTalk, chatWithPet, getActivePetId, setActivePetId } = chatMemory;

  const balancePoll = createBalancePoll({ ctx, configPaths, getActivePetId, log, state, standaloneAiBalance });
  const { effectivePetList, balancePeriodSec, whisperPeriodSec, refreshBalance, resolveActivePetId, petDisplayName } =
    balancePoll;

  // To-do list: a user-level data (regardless of pets), persist to disk in the plugin data root; reminder loop and / todos route share the same instance.
  const todos = new TodoStore({ file: join(userRoot, TODO_FILE_NAME), log });

  const desktopHelper = createDesktopHelper({
    ctx,
    configPaths,
    effectivePetList,
    log,
    reportDownload,
    thumbUserRoot,
    // Lazy access: handlePetRoute is assembled below, Helper is only actually called when starting/receiving requests
    getHandlePetRoute: () => httpRoute.handlePetRoute,
  });
  const { startHelper, stopHelper, markDisposed } = desktopHelper;

  const deps: PetRouteDeps = {
    memorySetup: registerManagedMemory(ctx, setup, () => httpRoute.memoryConfig),
    ...setup,
    ...petLookup,
    ...workStatusBridge,
    ...chatMemory,
    ...balancePoll,
    ...desktopHelper,
    ...sessionNotify,
    ctx,
    todos,
    // Speech synthesis: The cache falls into userRoot. If it fails, only the log will be left and the host will not be interrupted.
    voice: createVoiceService({ userRoot, log }),
    // Speech recognition: The capability comes from the host (speechToText of DSH). When not enabled, the service itself returns unsupported when called.
    speech: createHearService({ speechToText: () => setup.optionalService('speechToText') }),
  };
  const httpRoute = createHttpRoute(deps);
  registerHttpRoute(ctx, httpRoute.handlePetRoute);
  deps.memorySetup?.resume();

  registerSessionWatch({
    ctx,
    cancelTerminalCleanup,
    lastTodoText,
    lastReplyText,
    notifyActivityTimers,
    publishWorkStatus,
    pushNotifyFrame,
    scheduleCompletionNotify,
    scheduleTerminalCleanup,
    terminalTimers,
    toolsInFlight,
    turnFlags,
    workStatus,
  });

  registerBalanceCommand({ ctx, effectivePetList, refreshBalance, sleep, sleepRefusalText });

  registerLoops({
    ctx,
    balancePeriodSec,
    configPaths,
    lastWhisperAt,
    lock,
    log,
    publishWhisper,
    publishSleepTalk,
    refreshBalance,
    sleep,
    standaloneAiPolicy,
    whisperPeriodSec,
  });

  registerPetCommand({ ctx, effectivePetList, petDisplayName, resolveActivePetId, setActivePetId });

  registerChatCommand({ ctx, chatWithPet, log, publishWhisper, resolveActivePetId, sleep, sleepRefusalText });

  // To-do reminder: starts and stops with the plugin lifecycle; when the lock is held by a third party, the pet is
  // skipped by pickReminderSpeaker. The broadcast switch is read and used: after the configuration is changed, the
  // next reminder will take effect without restarting.
  registerTodoReminders({
    ctx,
    effectivePetList,
    isVoiceTodoEnabled: () => readAllConfig(configPaths).main?.voiceTodoEnabled === true,
    lock,
    log,
    sleep,
    state,
    todos,
    waiterCount: () => state.waiterCount(),
  });

  registerLifecycle({
    ctx,
    lock,
    markDisposed,
    playback,
    state,
    stopDownloadSlotTimer,
    stopHelper,
    stopWorkStatusFlush,
  });

  // Pull up the desktop Helper after the route is ready (only an warning will be issued when Electron is missing, and will not affect DSH and the browser overlay)
  startHelper();
}
