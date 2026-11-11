/**
 * Behavioral test of voice whitelist (src/host/voice/voices.ts). Only verify the contract "Verify that it has the
 * same origin as the list": the default sound must actually be in the list.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_VOICE, VOICES, isKnownVoice } from './voices.ts';

test('isKnownVoice: id in the whitelist hits, any string does not hit', () => {
  assert.equal(isKnownVoice('zh-CN-XiaoxiaoNeural'), true);
  assert.equal(isKnownVoice('zh-CN-MadeUpNeural'), false);
  assert.equal(isKnownVoice(''), false);
});

test('DEFAULT_VOICE: must be in the list, and there is exactly one default', () => {
  assert.equal(isKnownVoice(DEFAULT_VOICE), true, 'The default tone cannot fall outside the white list');
  const defaults = VOICES.filter((voice) => voice.default);
  assert.equal(defaults.length, 1, 'default tag must be unique');
  assert.equal(defaults[0]?.id, DEFAULT_VOICE);
});
