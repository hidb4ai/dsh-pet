/**
 * The contract of the global shortcut key "Which pet to attack": Prioritize the main item, degrade when the main item
 * is absent, log out and only pick yourself once.
 *
 * Why it’s worth pinning: There will be no error if you make a wrong selection here, it will only cause the shortcut
 * keys to act on another pet - the phenomenon that users see is that “the pop-up window opens in a strange position”,
 * and it is difficult to think that it is a problem with target selection.
 *
 * Running method: node --experimental-strip-types --test src/client/pet/card/registry.test.ts
 */
import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { petBridge } from '../../settings/bridge.ts';
import {
  pickPetChatHandle,
  registerPetChatHandle,
  togglePetChat,
  togglePetChatHear,
  type PetChatHandle,
} from './registry.ts';

/** Create a handle that only remembers the calling sequence; `hearing` / `opened` can be changed midway, simulating recording with the pop-up window open. */
function makeHandle(calls: string[]): PetChatHandle & { hearing: boolean; opened: boolean } {
  const handle = {
    hearing: false,
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

/** Register and automatically remove after each use case to avoid module-level Map string use cases. */
function register(id: string, handle: PetChatHandle): void {
  disposers.push(registerPetChatHandle(id, handle));
}

afterEach(() => {
  while (disposers.length > 0) disposers.pop()?.();
  petBridge.template = undefined;
});

describe('pickPetChatHandle——Which pet does the shortcut key work on?', () => {
  test('The main entry is present → take the main entry, regardless of the registration order', () => {
    const calls: string[] = [];
    const main = makeHandle(calls);
    register('other', makeHandle(calls));
    register('main', main);
    petBridge.template = asPet('main');
    assert.equal(pickPetChatHandle(), main);
  });

  test('The main item is not on the web page (only displayed on the desktop) → Return to the first registered one', () => {
    const calls: string[] = [];
    const first = makeHandle(calls);
    register('first', first);
    register('second', makeHandle(calls));
    petBridge.template = asPet('only-on-desktop');
    assert.equal(pickPetChatHandle(), first);
  });

  test('None registered → undefined', () => {
    petBridge.template = asPet('main');
    assert.equal(pickPetChatHandle(), undefined);
  });

  test('You will no longer get it after logging out; you will only get it once.', () => {
    const calls: string[] = [];
    const first = makeHandle(calls);
    const second = makeHandle(calls);
    const offFirst = registerPetChatHandle('first', first);
    register('second', second);
    offFirst();
    petBridge.template = asPet('first');
    assert.equal(
      pickPetChatHandle(),
      second,
      'The main entry has been canceled and should be returned to the one that is still there.',
    );
    offFirst(); // Idempotent: Repeated logout should not remove subsequent registrations together.
    assert.equal(pickPetChatHandle(), second);
  });
});

describe('togglePetChatHear——Switch recording', () => {
  test('Not recording → Start', () => {
    const calls: string[] = [];
    const handle = makeHandle(calls);
    handle.hearing = false;
    togglePetChatHear(handle);
    assert.deepEqual(calls, ['start']);
  });

  test('Recording → cleanup', () => {
    const calls: string[] = [];
    const handle = makeHandle(calls);
    handle.hearing = true;
    togglePetChatHear(handle);
    assert.deepEqual(calls, ['stop']);
  });

  test('No target pet → do nothing and don’t throw it', () => {
    assert.doesNotThrow(() => togglePetChatHear(undefined));
  });
});

describe('togglePetChat - Switch floating dialogue', () => {
  test('Not open → Open', () => {
    const calls: string[] = [];
    const handle = makeHandle(calls);
    togglePetChat(handle);
    assert.deepEqual(calls, ['open']);
  });

  test('Already on → off (the second press of the same key must be off)', () => {
    const calls: string[] = [];
    const handle = makeHandle(calls);
    handle.opened = true;
    togglePetChat(handle);
    assert.deepEqual(calls, ['close']);
  });

  test('Turn on once and press again → return to off state', () => {
    const calls: string[] = [];
    const handle = makeHandle(calls);
    togglePetChat(handle);
    togglePetChat(handle);
    assert.deepEqual(calls, ['open', 'close']);
    assert.equal(handle.isOpen(), false);
  });

  test('No target pet → do nothing and don’t throw it', () => {
    assert.doesNotThrow(() => togglePetChat(undefined));
  });
});
