/**
 * The contract of the register shell: which environments are the default keys, why web:linux is absent, whether it can
 * run after being triggered, and how to downgrade if the service is missing.
 *
 * This layer is shared by three commands. If they are wrong, they will go wrong together: the wrong file will cause a
 * certain end to have no default key, leaving out resolve will cause the shortcut key to have no response when
 * pressed, and only saying page will cause the second press to be swallowed by the input box.
 *
 * Running method: node --experimental-strip-types --test src/client/app-shortcut.test.ts
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  keycapOf,
  readShortcutKeycap,
  registerAppShortcut,
  SHORTCUT_PROFILES,
  subscribeShortcutKeycaps,
  type ShortcutHost,
} from './app-shortcut.ts';

/** A complete command of register (for assertion). */
interface Registered {
  id: string;
  label: () => string;
  defaults: Record<string, unknown>;
  regions: readonly string[];
  modals: readonly string[];
  resolve: () => { status: string; run?: () => void };
}

/** False context: logging register and logout. */
function makeHost(mode: 'ok' | 'missing' | 'reject') {
  const state: { command?: Registered; disposed: number } = { disposed: 0 };
  const host: ShortcutHost =
    mode === 'missing'
      ? { get: () => undefined }
      : {
          get: () =>
            mode === 'reject'
              ? {
                  register: () => {
                    throw new Error('Unsupported Web shortcut');
                  },
                }
              : {
                  register: (command: Registered) => {
                    state.command = command;
                    return () => {
                      state.disposed += 1;
                    };
                  },
                },
        };
  return { host, state };
}

/** The command under test: the key position is given casually, and the assertion only cares that it is laid out as it is. */
const BINDING = { code: 'KeyL', modifiers: ['primary', 'shift'] } as const;

describe('keycapOf —— Keycap derivation', () => {
  /** The same set of criteria as the implementation; the test only cares about the "derivation rules" rather than the specific platform. */
  const primary = /Mac/i.test(navigator.platform || navigator.userAgent) ? 'Cmd' : 'Ctrl';

  test('primary is expanded according to the platform, and the Key prefix is removed.', () => {
    assert.equal(keycapOf({ code: 'KeyL', modifiers: ['primary', 'shift'] }), primary + '+Shift+L');
    assert.equal(keycapOf({ code: 'KeyM', modifiers: ['primary'] }), primary + '+M');
  });

  test('Only letters appear when there are no modifier keys', () => {
    assert.equal(keycapOf({ code: 'KeyV', modifiers: [] }), 'V');
  });
});

describe('registerAppShortcut —— shortcut key register shell', () => {
  test('Service available → All five environments use the same key, web:linux is not among them', () => {
    const { host, state } = makeHost('ok');
    const result = registerAppShortcut(host, {
      id: 'pet-chat.float',
      label: () => 'L',
      binding: BINDING,
      run: () => {},
    });
    assert.equal(result.registered, true);
    assert.deepEqual(Object.keys(state.command?.defaults ?? {}).sort(), [...SHORTCUT_PROFILES].sort());
    for (const profile of SHORTCUT_PROFILES) {
      assert.deepEqual(state.command?.defaults[profile], BINDING, profile);
    }
    assert.equal(
      state.command?.defaults['web:linux'],
      undefined,
      'If web:linux is added to the whitelist, the entire line will be rejected.',
    );
  });

  test('Recognize page and editable at the same time: the pop-up window must be received even if the focus is on in the input box', () => {
    const { host, state } = makeHost('ok');
    registerAppShortcut(host, { id: 'x.y', label: () => 'L', binding: BINDING, run: () => {} });
    // Write less editable: The first press will open the window, but the second press will treat DSH as "typing in the
    // input box" and directly ignore it. Therefore, neither close the window nor preventDefault, and the browser's
    // native shortcut keys will still run.
    assert.deepEqual(state.command?.regions, ['page', 'editable']);
    assert.deepEqual(state.command?.modals, []);
  });

  test('Trigger → Call the incoming action', () => {
    const { host, state } = makeHost('ok');
    let ran = 0;
    registerAppShortcut(host, {
      id: 'x.y',
      label: () => 'L',
      binding: BINDING,
      run: () => {
        ran += 1;
      },
    });
    const resolution = state.command?.resolve();
    assert.equal(resolution?.status, 'handled');
    resolution?.run?.();
    assert.equal(ran, 1);
  });

  test('Log out of transparent transmission shortcut key service', () => {
    const { host, state } = makeHost('ok');
    registerAppShortcut(host, { id: 'x.y', label: () => 'L', binding: BINDING, run: () => {} }).dispose();
    assert.equal(state.disposed, 1);
  });

  test('Missing service → No register, no throw, return registered = false', () => {
    const { host, state } = makeHost('missing');
    const result = registerAppShortcut(host, { id: 'x.y', label: () => 'L', binding: BINDING, run: () => {} });
    assert.equal(result.registered, false);
    assert.equal(state.command, undefined);
    assert.doesNotThrow(() => result.dispose());
  });

  test('register rejected (key position does not match the whitelist / id conflict) → return registered = false, do not throw upward', () => {
    const { host } = makeHost('reject');
    const result = registerAppShortcut(host, { id: 'x.y', label: () => 'L', binding: BINDING, run: () => {} });
    assert.equal(result.registered, false);
    assert.doesNotThrow(() => result.dispose());
  });
});

/** Directory line: `keys` is a fragment of the service expanded by platform, macOS is marked without `+`. */
type Row = { id: string; keys: string[] };

/** Fake directory: record subscriber, `emit()` simulates user change. */
function makeCatalogHost(rows: Row[]) {
  const listeners: Array<() => void> = [];
  const host: ShortcutHost = {
    get: () => ({
      register: () => () => {},
      catalog: {
        getSnapshot: () => rows,
        subscribe: (listener: () => void) => {
          listeners.push(listener);
          return () => {};
        },
      },
    }),
  };
  return { host, listeners };
}

describe('readShortcutKeycap - Read the keycaps modified by the user', () => {
  test('There is this line in the directory → spelled as keycap', () => {
    const { host } = makeCatalogHost([{ id: 'pet-chat.float', keys: ['Ctrl', '+', 'Alt', '+', 'K'] }]);
    assert.equal(readShortcutKeycap(host, 'pet-chat.float'), 'Ctrl+Alt+K');
  });

  test('The symbol keycap of macOS is concatenate as it is without inserting the delimiter.', () => {
    const { host } = makeCatalogHost([{ id: 'pet-chat.float', keys: ['⌃', '⇧', 'L'] }]);
    assert.equal(readShortcutKeycap(host, 'pet-chat.float'), '⌃⇧L');
  });

  test('The command is not in the directory/the key is cleared → undefined, and the caller returns to the default combination', () => {
    const { host } = makeCatalogHost([{ id: 'other.command', keys: ['Ctrl', '+', 'L'] }]);
    assert.equal(readShortcutKeycap(host, 'pet-chat.float'), undefined);
    const cleared = makeCatalogHost([{ id: 'pet-chat.float', keys: [] }]);
    assert.equal(readShortcutKeycap(cleared.host, 'pet-chat.float'), undefined);
  });

  test('host has no directory (old version/service missing) → undefined, not thrown', () => {
    assert.equal(readShortcutKeycap({ get: () => ({ register: () => () => {} }) }, 'pet-chat.float'), undefined);
    assert.equal(readShortcutKeycap({ get: () => undefined }, 'pet-chat.float'), undefined);
  });
});

describe('subscribeShortcutKeycaps ——Notification to reread after changing the binding', () => {
  test('Change binding to trigger subscriber', () => {
    const { host, listeners } = makeCatalogHost([]);
    let hits = 0;
    const off = subscribeShortcutKeycaps(host, () => {
      hits += 1;
    });
    for (const listener of listeners) listener();
    assert.equal(hits, 1);
    assert.doesNotThrow(() => off());
  });

  test('host has no directory → returns an empty logout function and does not throw', () => {
    const off = subscribeShortcutKeycaps({ get: () => undefined }, () => {});
    assert.doesNotThrow(() => off());
  });
});
