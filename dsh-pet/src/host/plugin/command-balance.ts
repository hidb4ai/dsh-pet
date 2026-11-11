/**
 * Slash command / balance: Refresh the balance and return the result to the command panel.
 * @module dsh-pet/src/host/plugin/command-balance
 */
import type { BalancePoll } from './balance-poll.ts';
import type { PetLookup } from './pet-lookup.ts';
import type { HostContext } from './context.ts';

/** Input of balance command. */
export type CommandBalanceInput = {
  /** host context (the one apply received). */
  ctx: HostContext;
} & Pick<BalancePoll, 'refreshBalance'> &
  Pick<BalancePoll, 'effectivePetList'> &
  Pick<PetLookup, 'sleep'> &
  Pick<PetLookup, 'sleepRefusalText'>;

/** register balance command; the returned cleanup function is collected by ctx.effect. */
export function registerBalanceCommand(deps: CommandBalanceInput): void {
  const { ctx, effectivePetList, refreshBalance, sleep, sleepRefusalText } = deps;
  // / balance slash command: trigger a balance refresh (write S → front end 1 s polling and pop the bubble after
  // seeing it). fire-and-forget: The receipt does not wait for external API (the query may take several seconds), and
  // it will be replied immediately; the results will always be from S (successful broadcast of state animation +
  // balance bubble; service provider does not support / lack of credentials / failed to capture, text description
  // bubble will pop up, never silent).
  ctx.effect(
    () =>
      ctx.commands.register({
        name: 'balance',
        description: '手动触发桌宠余额显示（立即弹出余额气泡）',
        handler: () => {
          // The balance is a global data, but the "who to show it to" depends on the pet: if everyone is asleep, no one will see it, refuse and reply with a line.
          const visible = effectivePetList().filter((pet) => String(pet.display ?? '') !== 'none');
          if (visible.length > 0 && visible.every((pet) => sleep.sleeping(String(pet.id ?? '')))) {
            return { kind: 'error', text: sleepRefusalText(String(visible[0].id ?? '')) };
          }
          void refreshBalance(true); // manual: The command was entered by the user actively
          return { kind: 'success', text: '已触发桌宠余额显示' };
        },
      }),
    'dsh-pet: /balance command',
  );
}
