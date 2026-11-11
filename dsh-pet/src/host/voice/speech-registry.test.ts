/**
 * Behavioral test of third-party speech recognition register (src/host/voice/speech-registry.ts).
 *
 * Only focus on "who takes effect, who is overwritten, and whether you will only delete yourself after logging out" -
 * identification and timeout are not in this module, there are other tests.
 */
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import {
  BUILTIN_SPEECH_ID,
  activeSpeechProvider,
  listSpeechProviders,
  registerSpeechProvider,
  resetSpeechProviders,
} from './speech-registry.ts';

/** Create a minimal implementation; only care about id, transcribe returns fixed text. */
const provider = (id: string) => ({
  id,
  name: id,
  transcribe: async () => '好',
});

afterEach(() => {
  resetSpeechProviders();
});

test('Initial state: There is no third-party implementation, external of list is empty', () => {
  assert.equal(activeSpeechProvider(), null);
  assert.deepEqual(listSpeechProviders(), { builtin: [BUILTIN_SPEECH_ID], external: [] });
});

test('After register: active returns it, list reports id', () => {
  registerSpeechProvider(provider('my-asr'));
  assert.equal(activeSpeechProvider()?.id, 'my-asr');
  assert.deepEqual(listSpeechProviders(), { builtin: [BUILTIN_SPEECH_ID], external: ['my-asr'] });
});

test('The last register overwrites the first register: only one of the single slots takes effect.', () => {
  registerSpeechProvider(provider('first'));
  registerSpeechProvider(provider('second'));
  assert.equal(activeSpeechProvider()?.id, 'second');
  assert.deepEqual(listSpeechProviders().external, ['second']);
});

test('When you log out, you will only clear your own share: the person who registers first will not override the person who comes later.', () => {
  const disposeFirst = registerSpeechProvider(provider('first'));
  registerSpeechProvider(provider('second'));
  disposeFirst();
  assert.equal(activeSpeechProvider()?.id, 'second', 'Late logout should not clear out new implementations');
});

test('Cancel the currently effective one: return to no third party', () => {
  const dispose = registerSpeechProvider(provider('my-asr'));
  dispose();
  assert.equal(activeSpeechProvider(), null);
  assert.deepEqual(listSpeechProviders().external, []);
});

test('Invalid definitions will be thrown away TypeError', () => {
  assert.throws(() => registerSpeechProvider(null as never), TypeError, 'Non-object');
  assert.throws(() => registerSpeechProvider({ id: '', name: 'x', transcribe: async () => '' }), TypeError, 'Empty id');
  assert.throws(
    () => registerSpeechProvider({ id: BUILTIN_SPEECH_ID, name: 'x', transcribe: async () => '' }),
    TypeError,
    'Same name as built-in source',
  );
  assert.throws(
    () => registerSpeechProvider({ id: 'x', name: 'x', transcribe: 1 as never }),
    TypeError,
    'transcribe is not a function',
  );
});
