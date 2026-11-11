/**
 * The register contract of the right column label: what is registered, how to downgrade when the service is missing,
 * and whether the deregistration is only the label type.
 *
 * The component is not rendered (the component behavior belongs to the UI layer), nor is the complete lifecycle of the
 * slot framework simulated - here only the register order and the path of "waiting for the slot declaration before
 * registering" are nailed.
 *
 * Running method: node --experimental-strip-types --test src/client/chat/register.test.ts
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { registerPetChatTab, type PetChatTabHost } from './register.ts';
import type { ChatPanelRuntime } from './panel.ts';

/** The component will not be called, the stub just needs to be of the correct shape. */
const RT: ChatPanelRuntime = {
  h: () => null,
  useState: <T>(init: T) => [init, () => {}] as unknown as [T, (next: T | ((prev: T) => T)) => void],
  useEffect: () => {},
  useRef: <T>(initial: T) => ({ current: initial }),
  t: (key) => key,
};

/** Fake context: record the calling sequence; inject drives the generator immediately, simulating "slot declared". */
function makeHost(hasService: boolean) {
  const calls: string[] = [];
  let typeDisposed = 0;
  const host: PetChatTabHost = {
    get: (name: string) =>
      hasService && name === 'sidebarRightTabs'
        ? {
            register: (definition: { kind: string }) => {
              calls.push('type:' + definition.kind);
              return () => {
                typeDisposed += 1;
              };
            },
          }
        : undefined,
    slots: {
      inject: (name: string, generator: () => Generator<unknown, void, unknown>) => {
        calls.push('inject:' + name);
        const steps = generator();
        for (let step = steps.next(); !step.done; step = steps.next()) {
          // The generator yield is disposer of the text register, and the real framework will collect it
        }
      },
      register: (registration: { name: string; key: string }) => {
        calls.push('slot:' + registration.name + ':' + registration.key);
        return () => {};
      },
    },
  };
  return { host, calls, disposed: () => typeDisposed };
}

describe('registerPetChatTab ——Right column dialogue label', () => {
  test('The service is available → register the label type first, then register the body in the slot scope', () => {
    const fake = makeHost(true);
    registerPetChatTab(fake.host, RT);
    assert.deepEqual(fake.calls, [
      'type:pet-chat',
      'inject:sidebar.right.pane.tab',
      'slot:sidebar.right.pane.tab:dsh-pet-chat',
    ]);
  });

  test('Unregister only the label type (the text slot belongs to the scope of slots.inject)', () => {
    const fake = makeHost(true);
    registerPetChatTab(fake.host, RT)();
    assert.equal(fake.disposed(), 1);
  });

  test('No sidebarRightTabs service → does not register anything, returns an empty logout that is safe to call', () => {
    const fake = makeHost(false);
    const dispose = registerPetChatTab(fake.host, RT);
    assert.deepEqual(fake.calls, []);
    assert.doesNotThrow(() => dispose());
  });
});
