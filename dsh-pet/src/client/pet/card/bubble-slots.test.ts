/**
 * Pure function contract of bubble single slot (src/client/pet/card/bubble-slots.ts): priority determination and
 * balance page number.
 *
 * Only the stateless part is covered; visibility and dwell timing require real rendering and are subject to manual
 * acceptance.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import type { BalanceState } from '../../../shared/balance/index.ts';
import { balancePageCount, decideBubbleSlot, type BubbleSlotInput } from './bubble-slots.ts';

/** A completely closed input covers the target scene item by item. */
function input(overrides: Partial<BubbleSlotInput> = {}): BubbleSlotInput {
  return {
    workTerminal: false,
    workOn: false,
    workText: null,
    workStatusEnabled: true,
    whisperOn: false,
    whisperText: null,
    balanceOn: false,
    balanceAvailable: true,
    balanceEnabled: true,
    balanceManual: false,
    todoOn: false,
    ...overrides,
  };
}

const windowsState: BalanceState = { provider: 'test', shape: 'windows', ok: true };
const customState = (pages: number): BalanceState => ({
  provider: 'test',
  shape: 'custom',
  ok: true,
  custom: { views: Array.from({ length: pages }, () => ({ tag: 'div', text: '页' })) },
});
const failedState: BalanceState = { provider: 'test', ok: false, reason: 'fetch-error' };

describe('decideBubbleSlot ——Only one bubble is hung at the same time', () => {
  test('None are lit: return none', () => {
    assert.equal(decideBubbleSlot(input()), 'none');
  });

  test('The final task overwhelms the conversation and balance: only 10 s can survive, without giving up the position.', () => {
    const slot = decideBubbleSlot(
      input({
        workTerminal: true,
        workOn: true,
        workText: '跑完了',
        whisperOn: true,
        whisperText: '在',
        balanceOn: true,
      }),
    );
    assert.equal(slot, 'work-terminal');
  });

  test('Talking over balance and non-final tasks: second priority', () => {
    const slot = decideBubbleSlot(
      input({ whisperOn: true, whisperText: '在', balanceOn: true, workOn: true, workText: '干活中' }),
    );
    assert.equal(slot, 'whisper');
  });

  test('The balance exceeds the non-terminal task: the resident task gives way 10 s without loss', () => {
    const slot = decideBubbleSlot(input({ balanceOn: true, workOn: true, workText: '干活中' }));
    assert.equal(slot, 'balance');
  });

  test('Only non-final tasks remain: permanent display', () => {
    assert.equal(decideBubbleSlot(input({ workOn: true, workText: '干活中' })), 'work');
  });

  test('Turn off work status linkage: task bubble does not occupy slots', () => {
    assert.equal(decideBubbleSlot(input({ workOn: true, workText: '干活中', workStatusEnabled: false })), 'none');
  });

  test('The balance data has not been retrieved: no balance bubble is attached.', () => {
    assert.equal(decideBubbleSlot(input({ balanceOn: true, balanceAvailable: false })), 'none');
  });

  test('Close balance and non-manual request: balance bubble will not be hung; manual request will be hung as usual', () => {
    assert.equal(decideBubbleSlot(input({ balanceOn: true, balanceEnabled: false })), 'none');
    assert.equal(decideBubbleSlot(input({ balanceOn: true, balanceEnabled: false, balanceManual: true })), 'balance');
  });

  test('The to-do panel overwhelms everything else: the window actively opened by the user does not give way.', () => {
    const slot = decideBubbleSlot(
      input({
        todoOn: true,
        workTerminal: true,
        workOn: true,
        workText: '跑完了',
        whisperOn: true,
        whisperText: '在',
        balanceOn: true,
      }),
    );
    assert.equal(slot, 'todo');
  });
});

describe('balancePageCount ——The number of pages that the balance bubble can turn', () => {
  test('No data or pull failed: one page', () => {
    assert.equal(balancePageCount(null), 1);
    assert.equal(balancePageCount(failedState), 1);
  });

  test('windows: Collapse and expand two pages', () => {
    assert.equal(balancePageCount(windowsState), 2);
  });

  test('windows with interval usage: one more page (Collapse / Window Details / Usage)', () => {
    assert.equal(
      balancePageCount({
        ...windowsState,
        usage: { totalTokens: 95967948, inputTokens: 95489675, outputTokens: 478273, requests: 745, spentUsd: 1.6 },
      }),
      3,
    );
  });

  test('custom: The number of pages is taken as the number of third-party views', () => {
    assert.equal(balancePageCount(customState(3)), 3);
  });

  test('custom has only one page: it is still counted as one page and no empty pages will appear.', () => {
    assert.equal(balancePageCount(customState(1)), 1);
  });

  test('Built-in single page format: one page', () => {
    assert.equal(balancePageCount({ provider: 'test', shape: 'money', ok: true }), 1);
  });
});
