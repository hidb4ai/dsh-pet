/**
 * Slash command / chat: forward a sentence to the pet and reply.
 * @module dsh-pet/src/host/plugin/command-chat
 */
import type { ChatMemory } from './chat-memory.ts';
import type { BalancePoll } from './balance-poll.ts';
import type { PetLookup } from './pet-lookup.ts';
import type { HostSetup } from './setup.ts';
import type { HostContext } from './context.ts';

/** Input of dialogue commands. */
export type CommandChatInput = {
  /** host context (the one apply received). */
  ctx: HostContext;
} & Pick<ChatMemory, 'chatWithPet'> &
  Pick<HostSetup, 'log'> &
  Pick<ChatMemory, 'publishWhisper'> &
  Pick<PetLookup, 'sleep'> &
  Pick<PetLookup, 'sleepRefusalText'> &
  Pick<BalancePoll, 'resolveActivePetId'>;

/** register dialog command; returned cleanup function collected by ctx.effect. */
export function registerChatCommand(deps: CommandChatInput): void {
  const { ctx, chatWithPet, log, publishWhisper, resolveActivePetId, sleep, sleepRefusalText } = deps;
  // The /chat command generates a manual whisper without arguments, bypassing whisperEnabled, which only controls the
  // periodic loop.
  // With arguments, use chatWithPet for history, persona and persistence. Both paths acknowledge immediately without
  // waiting for the model;
  // text is published to S at pets.<id>.say and displayed by polling consumers.
  ctx.effect(
    () =>
      ctx.commands.register({
        name: 'chat',
        description: '与桌宠对话：留空 = 碎碎念一句；输入消息 = 正常对话',
        input: { hint: '[消息]（留空 = 碎碎念）' },
        handler: ({ rawInput }: { rawInput: string }) => {
          const petId = resolveActivePetId();
          if (!petId) return { kind: 'error', text: '没有可交互的桌宠' };
          // Sleep: The command is also "Manual Disturbance", which will reject the line instead of calling the model (save one call, and it is also consistent with the setting of not talking when sleeping)
          if (sleep.sleeping(petId)) return { kind: 'error', text: sleepRefusalText(petId) };
          const text = rawInput.trim();
          if (!text) {
            void publishWhisper(petId).catch((e: unknown) =>
              log.warn('[dsh-pet] Whisper threw an error:' + (e instanceof Error ? e.message : String(e))),
            );
            return { kind: 'success', text: '已让桌宠碎碎念一句' };
          }
          if (text.length > 2000) return { kind: 'error', text: '消息过长（限 2000 字）' };
          void chatWithPet(petId, text)
            .then((r) => {
              if (!r.ok) {
                log.warn('[dsh-pet] Chat failed reason=' + r.reason + (r.message ? ' ' + r.message : ''));
              }
            })
            // The generated chain itself will turn the business failure into ok:false. What comes here is a real
            // exception (write disk/read configuration throw): If it is not caught, it is unhandled rejection. Node
            // terminates the host main process by default.
            .catch((e: unknown) =>
              log.warn('[dsh-pet] Chat threw an error:' + (e instanceof Error ? e.message : String(e))),
            );
          return { kind: 'success', text: '已发送，桌宠马上回应' };
        },
      }),
    'dsh-pet: /chat command',
  );
}
