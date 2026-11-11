/**
 * The contract of shortcut key register: what the command looks like, the default key position, whether it is really
 * opened after being triggered, and how to downgrade if the service is missing.
 *
 * Does not render the interface and does not rely on real keyboard services.
 *
 * Running method: node --experimental-strip-types --test src/client/chat/shortcut.test.ts
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { keycapOf } from '../app-shortcut.ts';
import { PET_CHAT_COMMAND_ID, petChatShortcutKeycap, registerPetChatShortcut } from './shortcut.ts';

/** Fake translation of title; test only cares if it is a lazy call. */
const LABEL = '打开桌宠对话';

/** A complete command of register (for assertion). */
interface Registered {
  id: string;
  label: () => string;
  defaults: Record<string, unknown>;
  regions: readonly string[];
  resolve: () => { status: string; run?: () => void };
}

/** False context: logging register and logout. */
function makeHost(hasService: boolean) {
  const state: { command?: Registered; disposed: number } = { disposed: 0 };
  const ctx = {
    get: (name: string) =>
      hasService && name === 'shortcuts'
        ? {
            register: (command: Registered) => {
              state.command = command;
              return () => {
                state.disposed += 1;
              };
            },
          }
        : undefined,
  };
  return { ctx, state };
}

describe('registerPetChatShortcut - shortcut key to open a conversation', () => {
  test('Service available → Use fixed id register, default Ctrl + Shift + P (primary expands to Command in macOS)', () => {
    const host = makeHost(true);
    const result = registerPetChatShortcut(
      host.ctx,
      () => LABEL,
      () => {},
    );
    assert.equal(result.registered, true);
    assert.equal(host.state.command?.id, PET_CHAT_COMMAND_ID);
    assert.deepEqual(host.state.command?.defaults['web:windows'], { code: 'KeyP', modifiers: ['primary', 'shift'] });
    assert.deepEqual(host.state.command?.defaults['desktop:macos'], { code: 'KeyP', modifiers: ['primary', 'shift'] });
  });

  test('Trigger command → call the incoming open action', () => {
    const host = makeHost(true);
    let opened = 0;
    registerPetChatShortcut(
      host.ctx,
      () => LABEL,
      () => {
        opened += 1;
      },
    );
    const resolution = host.state.command?.resolve();
    assert.equal(resolution?.status, 'handled');
    resolution?.run?.();
    assert.equal(opened, 1);
  });

  test('Lazy evaluation of title: after switching the language, the new copy is obtained', () => {
    const host = makeHost(true);
    let label = '打开桌宠对话';
    registerPetChatShortcut(
      host.ctx,
      () => label,
      () => {},
    );
    assert.equal(host.state.command?.label(), '打开桌宠对话');
    label = 'Open pet chat';
    assert.equal(host.state.command?.label(), 'Open pet chat', 'The first result cannot be cached');
  });

  test('Log out of transparent transmission shortcut key service', () => {
    const host = makeHost(true);
    registerPetChatShortcut(
      host.ctx,
      () => LABEL,
      () => {},
    ).dispose();
    assert.equal(host.state.disposed, 1);
  });

  test('Missing service → No register, no throw, return registered = false', () => {
    const host = makeHost(false);
    const result = registerPetChatShortcut(
      host.ctx,
      () => LABEL,
      () => {},
    );
    assert.equal(result.registered, false);
    assert.equal(host.state.command, undefined);
    assert.doesNotThrow(() => result.dispose());
  });

  test('register rejected (wrong throw) → return registered = false, no upward throw', () => {
    const ctx = {
      get: () => ({
        register: () => {
          throw new Error('unsupported code');
        },
      }),
    };
    const result = registerPetChatShortcut(
      ctx,
      () => LABEL,
      () => {},
    );
    assert.equal(result.registered, false);
    assert.doesNotThrow(() => result.dispose());
  });
});

describe('petChatShortcutKeycap - Keycaps for sidebar dialogue', () => {
  test('After the user changes the binding, the change will follow.', () => {
    const ctx = {
      get: () => ({
        catalog: {
          getSnapshot: () => [{ id: PET_CHAT_COMMAND_ID, keys: ['Ctrl', '+', 'Alt', '+', 'J'] }],
          subscribe: () => () => {},
        },
      }),
    };
    assert.equal(petChatShortcutKeycap(ctx), 'Ctrl+Alt+J');
  });

  test('There is no such item in the directory/Service is missing → Return to the default combination', () => {
    const expected = keycapOf({ code: 'KeyP', modifiers: ['primary', 'shift'] });
    assert.equal(petChatShortcutKeycap({ get: () => ({ catalog: { getSnapshot: () => [] } }) }), expected);
    assert.equal(petChatShortcutKeycap({ get: () => undefined }), expected);
  });
});
