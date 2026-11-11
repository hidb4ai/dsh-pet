/**
 * Behavioral testing of third-party voice register (src/host/voice/registry.ts).
 *
 * Only focus on "who takes effect, who is overwritten, and whether you will only delete yourself after logging out" -
 * synthesis and caching are not in this module and are tested separately.
 */
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import {
  BUILTIN_VOICE_ID,
  activeVoiceProvider,
  listVoiceProviders,
  registerVoiceProvider,
  resetVoiceProviders,
} from './registry.ts';

/** Create a minimal implementation; only care about id, synthesize returns a bytes placeholder. */
const provider = (id: string) => ({
  id,
  name: id,
  synthesize: async () => new Uint8Array([1]),
});

afterEach(() => {
  resetVoiceProviders();
});

test('Initial state: There is no third-party implementation, external of list is empty', () => {
  assert.equal(activeVoiceProvider(), null);
  assert.deepEqual(listVoiceProviders(), { builtin: [BUILTIN_VOICE_ID], external: [] });
});

test('After register: active returns it, list reports id', () => {
  registerVoiceProvider(provider('my-tts'));
  assert.equal(activeVoiceProvider()?.id, 'my-tts');
  assert.deepEqual(listVoiceProviders(), { builtin: [BUILTIN_VOICE_ID], external: ['my-tts'] });
});

test('The last register overwrites the first register: only one of the single slots takes effect.', () => {
  registerVoiceProvider(provider('first'));
  registerVoiceProvider(provider('second'));
  assert.equal(activeVoiceProvider()?.id, 'second');
  assert.deepEqual(listVoiceProviders().external, ['second']);
});

test('When you log out, you will only clear your own share: the person who registers first will not override the person who comes later.', () => {
  const disposeFirst = registerVoiceProvider(provider('first'));
  registerVoiceProvider(provider('second'));
  disposeFirst();
  assert.equal(activeVoiceProvider()?.id, 'second', 'Late logout should not clear out new implementations');
});

test('Cancel the currently effective copy: return to the built-in', () => {
  const dispose = registerVoiceProvider(provider('my-tts'));
  dispose();
  assert.equal(activeVoiceProvider(), null);
  assert.deepEqual(listVoiceProviders().external, []);
});

test('Invalid definitions will be thrown away TypeError', () => {
  assert.throws(() => registerVoiceProvider(null as never), TypeError, 'Non-object');
  assert.throws(
    () => registerVoiceProvider({ id: '', name: 'x', synthesize: async () => new Uint8Array() }),
    TypeError,
    'Empty id',
  );
  assert.throws(
    () => registerVoiceProvider({ id: BUILTIN_VOICE_ID, name: 'x', synthesize: async () => new Uint8Array() }),
    TypeError,
    'Same name as built-in',
  );
  assert.throws(
    () => registerVoiceProvider({ id: 'x', name: 'x', synthesize: 1 as never }),
    TypeError,
    'synthesize is not a function',
  );
});
