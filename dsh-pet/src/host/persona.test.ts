/**
 * persona assemble unit test: verify whisper/conversation shares the segmented structure of system (persona + name
 * declaration + time background + optional historical description).
 *
 * Why only test this: assemble was previously inlined in petSystemPrompt of host/index.ts (it needs to start the host
 * to run), so the three items of "instance-level persona fallback", "name always appended" and "time calculated each
 * time" can only be tested manually. After extracting the pure function, pin it directly in node:test; if you change
 * assemble in the future (for example, add a section), it will also be red here first.
 *
 * Running method: node --experimental-strip-types --test src/host/persona.test.ts
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { composeSystemPrompt, petPersona } from './persona.ts';

/** Fixed time: 2026-10-21 (Wednesday) 14:15, no holiday window - the time line is stable and assertion is possible */
const NOW = new Date(2026, 9, 21, 14, 15);

describe('petPersona —— instance level → entry level → empty', () => {
  test('Instance written → use instance (completely replaces entry, no concatenate)', () => {
    const conf = { whisperPrompt: '条目人设' };
    assert.equal(petPersona(conf, { whisperPrompt: '实例人设' }), '实例人设');
  });

  test('The instance is not written → fallback entry persona', () => {
    assert.equal(petPersona({ whisperPrompt: '条目人设' }, {}), '条目人设');
  });

  test('The instance writes an empty string/pure blank → it is regarded as not written, fallback entry', () => {
    const conf = { whisperPrompt: '条目人设' };
    assert.equal(petPersona(conf, { whisperPrompt: '' }), '条目人设');
    assert.equal(petPersona(conf, { whisperPrompt: '  \n\t ' }), '条目人设');
  });

  test('The instance writes a non-character string (number/object/array) → it is regarded as not written, fallback entry', () => {
    const conf = { whisperPrompt: '条目人设' };
    for (const bad of [42, { a: 1 }, ['x'], true, null]) {
      assert.equal(petPersona(conf, { whisperPrompt: bad }), '条目人设', `${JSON.stringify(bad)} should be ignored`);
    }
  });

  test('There are no two levels/the entry is also invalid → empty string (the assemble layer is processed as "no persona")', () => {
    assert.equal(petPersona({}, {}), '');
    assert.equal(petPersona({ whisperPrompt: 42 }, {}), '');
    assert.equal(petPersona({ whisperPrompt: '' }, {}), '');
  });
});

describe('composeSystemPrompt - segmented assemble', () => {
  test('persona + name + time: fixed order, single line break between lines', () => {
    const out = composeSystemPrompt({ prompt: '你是小女仆', name: '蓝毛', id: 'main', now: NOW });
    const lines = out.split('\n');
    assert.equal(lines[0], '你是小女仆');
    assert.equal(lines[1], '你的名字是“蓝毛”。');
    assert.ok(
      lines[2].startsWith('【当下】现在是2026年10月21日星期三 14:15，下午，工作日'),
      'The third line must be the time background',
    );
    assert.equal(lines.length, 3, 'No more and no less than three paragraphs without historical explanation');
  });

  test('historyTimes → Add [history] segment at the end, still after the time background', () => {
    const out = composeSystemPrompt({ prompt: '你是小女仆', name: '蓝毛', id: 'main', now: NOW, historyTimes: true });
    const lines = out.split('\n');
    assert.equal(lines.length, 4, 'There are four paragraphs with historical explanation.');
    assert.ok(
      lines[3].startsWith('【历史】对话记录里，主人的话前面标着 [月日 时:分]'),
      `Line 4 must contain the localized history marker: ${lines[3]}`,
    );
    assert.ok(lines[3].includes('不要写时间'), 'Writing time in the reply text must be explicitly prohibited');
  });

  test('historyTimes But the time is invalid → [History] is not added (it refers to "now" in the whole sentence)', () => {
    const out = composeSystemPrompt({
      prompt: '',
      name: '蓝毛',
      id: 'main',
      now: new Date('nope'),
      historyTimes: true,
    });
    assert.equal(out, '你的名字是“蓝毛”。');
  });

  test('historyTimes default / false → [History] does not appear (whisper has no history)', () => {
    for (const parts of [{}, { historyTimes: false }]) {
      const out = composeSystemPrompt({ prompt: '你是小女仆', name: '蓝毛', id: 'main', now: NOW, ...parts });
      assert.ok(!out.includes('【历史】'));
    }
  });

  test('No persona → does not start with a newline (only name + time)', () => {
    const out = composeSystemPrompt({ prompt: '', name: '蓝毛', id: 'main', now: NOW });
    assert.ok(out.startsWith('你的名字是“蓝毛”。'), `Actual beginning: ${JSON.stringify(out.slice(0, 12))}`);
    assert.equal(out.split('\n')[0], '你的名字是“蓝毛”。');
  });

  test('name is empty → use id (same semantics as mergePet "If name is missing, treat it as id")', () => {
    const out = composeSystemPrompt({ prompt: '', name: '', id: 'pet-7', now: NOW });
    assert.ok(out.startsWith('你的名字是“pet-7”。'));
  });

  test('name and id are both empty → the entire name declaration is omitted (no blank lines or empty quotes)', () => {
    const out = composeSystemPrompt({ prompt: '你是小女仆', name: '', id: '', now: NOW });
    assert.ok(out.startsWith('你是小女仆\n【当下】'), `Actual: ${JSON.stringify(out.slice(0, 20))}`);
    assert.ok(!out.includes('你的名字是'));
    assert.ok(!out.includes('“”'));
  });

  test('Invalid time (NaN) → do not add the entire line and leave no trailing newline', () => {
    const out = composeSystemPrompt({ prompt: '你是小女仆', name: '蓝毛', id: 'main', now: new Date('nope') });
    assert.equal(out, '你是小女仆\n你的名字是“蓝毛”。');
  });

  test('Keep multi-line personas as they are (not flattened or truncated)', () => {
    const prompt = '第一行\n第二行\n第三行';
    const out = composeSystemPrompt({ prompt, name: '蓝毛', id: 'main', now: new Date('nope') });
    assert.equal(out, prompt + '\n你的名字是“蓝毛”。');
  });

  test('The time background is calculated each time: two moments other than the same second produce different time lines', () => {
    const a = composeSystemPrompt({ prompt: '', name: '蓝毛', id: 'main', now: new Date(2026, 9, 21, 9, 0) });
    const b = composeSystemPrompt({ prompt: '', name: '蓝毛', id: 'main', now: new Date(2026, 9, 21, 21, 0) });
    assert.match(a, /上午/);
    assert.match(b, /晚上/);
    assert.notEqual(a, b);
  });
});
