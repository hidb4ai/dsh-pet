/**
 * Contract test between container and settings page sharing bridge (src/client/settings/bridge.ts).
 *
 * Two contracts:
 * 1. The default is safe: the settings page may be saved before the container is assembled, `reload()` must be a
 * callable empty function, and `current` must be an empty array;
 * 2. Both parties get the same object: after the container replaces `reload` / writes `current` , the settings page
 * must read the new value (single instance, not snapshot).
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { petBridge } from './bridge.ts';
import type { Pet } from '../../shared/types.ts';

/** Each use case starts from the default shape and restores the bridge to avoid mutual contamination between use cases. */
function withBridge(run: () => void): void {
  const saved = { current: petBridge.current, reload: petBridge.reload, template: petBridge.template };
  petBridge.current = [];
  petBridge.reload = () => {};
  petBridge.template = undefined;
  try {
    run();
  } finally {
    petBridge.current = saved.current;
    petBridge.reload = saved.reload;
    petBridge.template = saved.template;
  }
}

describe('petBridge - Shared bridge between containers and settings pages', () => {
  test('Default shape: empty list, undefined template, callable empty reload', () => {
    withBridge(() => {
      assert.deepEqual(petBridge.current, []);
      assert.equal(petBridge.template, undefined);
      assert.doesNotThrow(() => petBridge.reload(), '容器未装配时保存设置不能炸');
      assert.doesNotThrow(() => petBridge.reload({ main: { pets: [] } }), '带货重载同样不能炸');
    });
  });

  test('Sharing the same object: the settings page reads the new value immediately after the container is written.', () => {
    withBridge(() => {
      const seen: Array<Record<string, Record<string, unknown>> | undefined> = [];
      petBridge.reload = (merged) => seen.push(merged);
      // Only concerned with id: the remaining fields of the pet object written by the container are irrelevant to this use case.
      const pet = { id: 'pet-1' } as unknown as Pet;
      petBridge.current = [pet];
      petBridge.template = pet;

      assert.equal(petBridge.current.length, 1);
      assert.equal(petBridge.template?.id, 'pet-1');
      petBridge.reload({ main: { pets: [] } });
      assert.deepEqual(
        seen,
        [{ main: { pets: [] } }],
        'After saving the settings page, the finished aggregate must be handed over to the container.',
      );
    });
  });
});
