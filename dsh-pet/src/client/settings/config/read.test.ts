/**
 * Contract testing of finished configuration read.
 *
 * Three contracts:
 * 1. Bad responses must explicitly fail: `null` is returned when `main.pets` is missing or is not an array, allowing
 * the caller to report an error instead of rendering a half-empty form;
 * 2. Fields that are not written or written with bad values will not appear in the patch. The form retains its own
 * value and will never be overwritten with bad data;
 * 3. When the filled paragraphs (physical parameters, fonts) in the resolved value are missing subkeys, they are
 * filled with the built-in default, and the complete object is always read out.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { readConfigEntries, readMainConfig } from './read.ts';
import { DEFAULT_PHYSICS } from '../../../shared/physics.ts';
import { DEFAULT_FONT } from '../../../shared/fonts.ts';

describe('readMainConfig - resolved configuration → form patch', () => {
  test('main.pets is missing or not an array: return null (response broken)', () => {
    assert.equal(readMainConfig({}), null);
    assert.equal(readMainConfig({ main: {} }), null);
    assert.equal(readMainConfig({ main: { pets: 'oops' } }), null);
  });

  test('pets deep copy position: the editing list and the resolved value list are two pieces of data', () => {
    const merged = {
      main: { pets: [{ id: 'pet-1', position: { corner: 'top-left', marginX: 1, marginY: 2 } }] },
    };
    const patch = readMainConfig(merged);
    assert.ok(patch?.pets);
    patch.pets[0].position.marginX = 99;
    assert.equal(merged.main.pets[0].position.marginX, 1, 'Sharing the same position object is not allowed');
  });

  test('Physical parameters and fonts: When the resolved value is missing subkeys, use the built-in default to fill them.', () => {
    const patch = readMainConfig({ main: { pets: [], physics: { gravity: 3 }, font: { size: 20 } } });
    assert.deepEqual(patch?.physics, { ...DEFAULT_PHYSICS, gravity: 3 });
    assert.deepEqual(patch?.font, { ...DEFAULT_FONT, size: 20 });
  });

  test('Action frequency weight: Only three non-negative numbers are brought out, and bad values are treated as not written.', () => {
    const patch = readMainConfig({ main: { pets: [], animationWeights: { idle: 30, turn: 5, move: 5 } } });
    assert.deepEqual(patch?.animationWeights, { idle: 30, turn: 5, move: 5 });
    assert.equal('animationWeights' in (readMainConfig({ main: { pets: [] } }) ?? {}), false);
    assert.equal(
      'animationWeights' in
        (readMainConfig({ main: { pets: [], animationWeights: { idle: -1, turn: 5, move: 5 } } }) ?? {}),
      false,
      'Negative numbers are treated as if they are not written.',
    );
  });

  test('The model selects write-only half: the entire pair is treated as not written (the host will be rejected as invalid)', () => {
    const half = readMainConfig({ main: { pets: [], whisperModel: { provider: 'openai' } } });
    assert.equal(half?.whisperModel, undefined);
    const full = readMainConfig({ main: { pets: [], chatModel: { provider: 'a', model: 'b' } } });
    assert.deepEqual(full?.chatModel, { provider: 'a', model: 'b' });
  });

  test('Numeric field: When negative numbers and non-numbers are not written, 0 is a valid value.', () => {
    assert.equal(readMainConfig({ main: { pets: [], chatMemoryRounds: -1 } })?.chatMemoryRounds, undefined);
    assert.equal(readMainConfig({ main: { pets: [], chatMemoryRounds: 'x' } })?.chatMemoryRounds, undefined);
    assert.equal(readMainConfig({ main: { pets: [], chatImageLimit: 0 } })?.chatImageLimit, 0);
  });

  test('If the Boolean field is missing, the patch will not be added to avoid writing back the default value as a user choice.', () => {
    const patch = readMainConfig({ main: { pets: [] } });
    assert.equal('notificationsEnabled' in (patch ?? {}), false);
    assert.equal('trayEnabled' in (patch ?? {}), false);
    const withFlag = readMainConfig({ main: { pets: [], trayEnabled: false } });
    assert.equal(withFlag?.trayEnabled, false);
  });

  test('Voice subdivision switch: Boolean is brought out as it is, missing or non-Boolean will not be included in the patch', () => {
    const patch = readMainConfig({ main: { pets: [], voiceWhisperEnabled: true, voiceTodoEnabled: false } });
    assert.equal(patch?.voiceWhisperEnabled, true);
    assert.equal(patch?.voiceTodoEnabled, false, 'false is a legal value and cannot be treated as not written.');
    const none = readMainConfig({ main: { pets: [] } });
    assert.equal('voiceWhisperEnabled' in (none ?? {}), false);
    assert.equal('voiceTodoEnabled' in (none ?? {}), false);
    const bad = readMainConfig({ main: { pets: [], voiceTodoEnabled: 'yes' } });
    assert.equal('voiceTodoEnabled' in (bad ?? {}), false, 'Non-boolean is treated as not written');
  });

  test('Working status broadcast switch: Boolean is brought out as it is, missing or non-Boolean will not be patched', () => {
    assert.equal(readMainConfig({ main: { pets: [], voiceNotifyEnabled: false } })?.voiceNotifyEnabled, false);
    assert.equal('voiceNotifyEnabled' in (readMainConfig({ main: { pets: [] } }) ?? {}), false);
    assert.equal(
      'voiceNotifyEnabled' in (readMainConfig({ main: { pets: [], voiceNotifyEnabled: 'yes' } }) ?? {}),
      false,
      'Non-boolean is treated as not written',
    );
  });

  test('Dialogue action linkage switch: Boolean is brought out as it is, missing or non-Boolean will not be included in the patch', () => {
    assert.equal(readMainConfig({ main: { pets: [], chatAnimationEnabled: false } })?.chatAnimationEnabled, false);
    assert.equal('chatAnimationEnabled' in (readMainConfig({ main: { pets: [] } }) ?? {}), false);
    assert.equal(
      'chatAnimationEnabled' in (readMainConfig({ main: { pets: [], chatAnimationEnabled: 1 } }) ?? {}),
      false,
      'Non-boolean is treated as not written',
    );
  });

  test('The entry persona is brought out as it is for preview of "what to follow when left blank"', () => {
    assert.equal(readMainConfig({ main: { pets: [], whisperPrompt: '条目人设' } })?.entryPrompt, '条目人设');
  });
});

describe('readConfigEntries —— resolved configuration → item instance list', () => {
  test('Flatten by entry: main first, file pets marked with assetRoot and pack', () => {
    const entries = readConfigEntries({
      main: { pets: [{ id: 'm1', position: { corner: 'top-left', marginX: 0, marginY: 0 } }] },
      glm: { pets: [{ id: 'g1', position: { corner: 'top-right', marginX: 1, marginY: 2 } }] },
    });
    assert.deepEqual(
      entries?.map((entry) => [entry.key, entry.kind]),
      [
        ['main', 'main'],
        ['glm', 'pack'],
      ],
    );
    assert.equal(entries?.[1].pets[0].assetRoot, 'glm', 'Instances need to remember which category they belong to');
  });

  test('Position deep copy: the editing list and the resolved value list are two pieces of data', () => {
    const merged = { main: { pets: [{ id: 'm1', position: { corner: 'top-left', marginX: 1, marginY: 2 } }] } };
    const entries = readConfigEntries(merged);
    assert.ok(entries);
    entries[0].pets[0].position.marginX = 99;
    assert.equal(merged.main.pets[0].position.marginX, 1, 'Sharing the same position object is not allowed');
  });

  test('Do not hang item-level large objects on the instance (the submission body should not be expanded by the animation pool)', () => {
    const entries = readConfigEntries({
      main: {
        pets: [{ id: 'm1', position: { corner: 'top-left', marginX: 0, marginY: 0 } }],
        animations: { idle: ['x'] },
      },
    });
    assert.equal('animations' in (entries?.[0].pets[0] ?? {}), false);
  });

  test('main.pets is missing or not an array: return null (response broken)', () => {
    assert.equal(readConfigEntries({}), null);
    assert.equal(readConfigEntries({ main: {} }), null);
    assert.equal(readConfigEntries({ main: { pets: 'oops' } }), null);
  });

  test('Each entry persona brings out: pack follows its own type, and does not share main', () => {
    const entries = readConfigEntries({
      main: { pets: [], whisperPrompt: '主宠物人设' },
      glm: { pets: [], whisperPrompt: 'GLM 人设' },
    });
    assert.equal(entries?.[0].entryPrompt, '主宠物人设');
    assert.equal(entries?.[1].entryPrompt, 'GLM 人设');
  });
});
