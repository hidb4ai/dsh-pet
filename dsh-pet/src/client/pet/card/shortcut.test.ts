/**
 * The contract of three floating dialogue commands: command id, key position, and whether it actually falls on the
 * registered pet after triggering.
 *
 * The key positions are worth fixing: T is occupied by the browser, here we use L (conversation), M (recording), S
 * (screenshot); if you change a wrong letter, the user will not be able to press it, and "cannot press it" will only
 * be regarded as a shortcut key that has not been made on site. The switch semantics are also worthy of criticism: the
 * second press of the same key must be off, not "put the focus back into the input box".
 *
 * Running method: node --experimental-strip-types --test src/client/pet/card/shortcut.test.ts
 */
import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { petBridge } from '../../settings/bridge.ts';
import { keycapOf, type ShortcutHost } from '../../app-shortcut.ts';
import { registerPetChatHandle } from './registry.ts';
import {
  PET_CAPTURE_COMMAND_ID,
  PET_FLOAT_COMMAND_ID,
  PET_HEAR_COMMAND_ID,
  petShortcutKeycap,
  registerPetCardShortcuts,
} from './shortcut.ts';

/** A complete command of register (for assertion). */
interface Registered {
  id: string;
  label: () => string;
  defaults: Record<string, { code: string; modifiers: readonly string[] }>;
  resolve: () => { status: string; run?: () => void };
}

/** Directory line: service expanded keycap fragment by platform. */
type Row = { id: string; keys: string[] };

/** Fake context: Collect registered commands as id and optionally expose a directory. */
function makeHost(rows: Row[] = []): { host: ShortcutHost; commands: Map<string, Registered> } {
  const commands = new Map<string, Registered>();
  const host: ShortcutHost = {
    get: () => ({
      register: (command: Registered) => {
        commands.set(command.id, command);
        return () => {
          commands.delete(command.id);
        };
      },
      catalog: { getSnapshot: () => rows, subscribe: () => () => {} },
    }),
  };
  return { host, commands };
}

/** Create a handle that only remembers calls; `hearing` can be changed midway to simulate recording. */
function makeHandle(calls: string[], hearing = false) {
  const handle = {
    hearing,
    opened: false,
    open: () => {
      handle.opened = true;
      calls.push('open');
    },
    close: () => {
      handle.opened = false;
      calls.push('close');
    },
    isOpen: () => handle.opened,
    startHear: () => calls.push('start'),
    stopHear: () => calls.push('stop'),
    isHearing: () => handle.hearing,
    screenshot: () => calls.push('screenshot'),
  };
  return handle;
}

/** The main configuration is the shape of the first pet; the test only cares about id. */
const asPet = (id: string): NonNullable<typeof petBridge.template> =>
  ({ id }) as unknown as NonNullable<typeof petBridge.template>;

const disposers: Array<() => void> = [];

afterEach(() => {
  while (disposers.length > 0) disposers.pop()?.();
  petBridge.template = undefined;
});

/** The default combination has the same origin as the binding in the source code; the test is only used for assertion fallback text. */
const FLOAT_DEFAULT_KEYCAP = keycapOf({ code: 'KeyL', modifiers: ['primary', 'shift'] });

describe('registerPetCardShortcuts - Three commands for floating dialogue', () => {
  test('register three commands, the key positions are Ctrl + Shift + L / M / S', () => {
    const { host, commands } = makeHost();
    registerPetCardShortcuts(host, (key) => key);
    assert.deepEqual(
      [...commands.keys()].sort(),
      [PET_FLOAT_COMMAND_ID, PET_HEAR_COMMAND_ID, PET_CAPTURE_COMMAND_ID].sort(),
    );
    assert.deepEqual(commands.get(PET_FLOAT_COMMAND_ID)?.defaults['web:windows'], {
      code: 'KeyL',
      modifiers: ['primary', 'shift'],
    });
    assert.deepEqual(commands.get(PET_HEAR_COMMAND_ID)?.defaults['desktop:windows'], {
      code: 'KeyM',
      modifiers: ['primary', 'shift'],
    });
    assert.deepEqual(commands.get(PET_CAPTURE_COMMAND_ID)?.defaults['web:windows'], {
      code: 'KeyS',
      modifiers: ['primary', 'shift'],
    });
  });

  test('The title is based on the translation key passed in.', () => {
    const { host, commands } = makeHost();
    registerPetCardShortcuts(host, (key) => 'T:' + key);
    assert.equal(commands.get(PET_FLOAT_COMMAND_ID)?.label(), 'T:shortcut.chat');
    assert.equal(commands.get(PET_HEAR_COMMAND_ID)?.label(), 'T:shortcut.hear');
    assert.equal(commands.get(PET_CAPTURE_COMMAND_ID)?.label(), 'T:shortcut.capture');
  });

  test('Click "Open Conversation" → Act on the registered pet', () => {
    const { host, commands } = makeHost();
    const calls: string[] = [];
    disposers.push(registerPetChatHandle('main', makeHandle(calls)));
    petBridge.template = asPet('main');
    registerPetCardShortcuts(host, (key) => key);
    commands.get(PET_FLOAT_COMMAND_ID)?.resolve().run?.();
    assert.deepEqual(calls, ['open']);
  });

  test('Click "Open Conversation" again → close it instead of opening another one', () => {
    const { host, commands } = makeHost();
    const calls: string[] = [];
    disposers.push(registerPetChatHandle('main', makeHandle(calls)));
    petBridge.template = asPet('main');
    registerPetCardShortcuts(host, (key) => key);
    const run = (): void => {
      commands.get(PET_FLOAT_COMMAND_ID)?.resolve().run?.();
    };
    run();
    run();
    assert.deepEqual(calls, ['open', 'close']);
  });

  test('Press "Voice Input" → Start recording when not recording, cleanup when recording', () => {
    const calls: string[] = [];
    const handle = makeHandle(calls);
    disposers.push(registerPetChatHandle('main', handle));
    petBridge.template = asPet('main');
    const { host, commands } = makeHost();
    registerPetCardShortcuts(host, (key) => key);
    const run = (): void => {
      commands.get(PET_HEAR_COMMAND_ID)?.resolve().run?.();
    };
    run();
    handle.hearing = true;
    run();
    assert.deepEqual(calls, ['start', 'stop']);
  });

  test('Click "Screenshot" → fall on the registered pet', () => {
    const { host, commands } = makeHost();
    const calls: string[] = [];
    disposers.push(registerPetChatHandle('main', makeHandle(calls)));
    petBridge.template = asPet('main');
    registerPetCardShortcuts(host, (key) => key);
    commands.get(PET_CAPTURE_COMMAND_ID)?.resolve().run?.();
    assert.deepEqual(calls, ['screenshot']);
  });

  test('Not a single pet → Triggered and not thrown', () => {
    const { host, commands } = makeHost();
    registerPetCardShortcuts(host, (key) => key);
    assert.doesNotThrow(() => commands.get(PET_FLOAT_COMMAND_ID)?.resolve().run?.());
    assert.doesNotThrow(() => commands.get(PET_HEAR_COMMAND_ID)?.resolve().run?.());
    assert.doesNotThrow(() => commands.get(PET_CAPTURE_COMMAND_ID)?.resolve().run?.());
  });
});

describe('petShortcutKeycap ——The keycap displayed on the settings page', () => {
  test('After the user changes the binding, the changed key is displayed and the default value is no longer read.', () => {
    const { host } = makeHost([{ id: PET_FLOAT_COMMAND_ID, keys: ['Ctrl', '+', 'Alt', '+', 'K'] }]);
    assert.equal(petShortcutKeycap(host, 'chat'), 'Ctrl+Alt+K');
  });

  test('There is no such item in the directory → Return to the default combination', () => {
    const { host } = makeHost();
    assert.equal(petShortcutKeycap(host, 'chat'), FLOAT_DEFAULT_KEYCAP);
  });

  test('The host has no shortcut key service → Return to the default combination without throwing', () => {
    assert.equal(petShortcutKeycap({ get: () => undefined }, 'chat'), FLOAT_DEFAULT_KEYCAP);
  });
});
