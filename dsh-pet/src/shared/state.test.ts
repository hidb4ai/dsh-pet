/**
 * Polling client-side logical unit test for unified state S (pull fault tolerance/flattening/comparison/balance leaf
 * parsing).
 *
 * Invariants of verify:
 * - The first pull only remembers the baseline and does not produce changes (otherwise the page refresh will replay
 * the old bubble);
 * - counter unchanged → not produced (the same sentence will not be rendered repeatedly);
 * - The new section / pets are automatically included (no need to change this logic when adding leaves in the future);
 * - Dirty data (counter non-number/leaf non-object) is discarded and garbage is not sent to the rendering layer;
 * - The balance leaf should be parsed into the client view (raw.data flattened) and manually marked with host;
 * - The path only cuts the leaf name according to the last point (pet id is allowed to contain dots).
 *
 * Running method: node --experimental-strip-types --test src/shared/state.test.ts
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  flattenCounters,
  readAnim,
  readBalance,
  readPosition,
  readSay,
  readSleep,
  readThrow,
  resolveLeafPath,
  takeChanged,
  type PollState,
} from './state.ts';

/** Make a copy of S: sections / pets with abbreviation (leaf value = counter, data with data field) */
function makeState(
  sections: Record<string, [number, unknown]>,
  pets: Record<string, Record<string, [number, unknown]>> = {},
): PollState {
  const leaf = ([counter, data]: [number, unknown]) => ({ counter, data });
  return {
    sections: Object.fromEntries(Object.entries(sections).map(([k, v]) => [k, leaf(v)])),
    pets: Object.fromEntries(
      Object.entries(pets).map(([petId, leaves]) => [
        petId,
        Object.fromEntries(Object.entries(leaves).map(([k, v]) => [k, leaf(v)])),
      ]),
    ),
  };
}

describe('flattenCounters——First pull baseline', () => {
  test('The path is sections .<name> / pets .< id >.<name>', () => {
    const s = makeState({ balance: [11, {}] }, { main: { say: [22, {}] } });
    assert.deepEqual(flattenCounters(s), { 'sections.balance': 11, 'pets.main.say': 22 });
  });

  test('Empty S → Empty baseline (not thrown)', () => {
    assert.deepEqual(flattenCounters({ sections: {}, pets: {} }), {});
  });
});

describe('takeChanged —— counter is a change only when it changes', () => {
  test('No change → No output (the same sentence will not be rendered repeatedly)', () => {
    const baseline = { 'sections.balance': 11 };
    const changes = takeChanged(makeState({ balance: [11, { ok: true }] }), baseline);
    assert.deepEqual(changes, []);
  });

  test('Changed → Produce the leaf and advance the baseline in place (the same content will not be produced next time)', () => {
    const baseline: Record<string, number> = {};
    const s = makeState({ balance: [12, { ok: true }] });
    const first = takeChanged(s, baseline);
    assert.equal(first.length, 1);
    assert.equal(first[0].path, 'sections.balance');
    assert.deepEqual(first[0].leaf.data, { ok: true });
    assert.equal(baseline['sections.balance'], 12, 'Baseline must be advanced');
    assert.deepEqual(takeChanged(s, baseline), [], 'The same S should not be produced again when compared again.');
  });

  test('Leaves that are not in the baseline (new pets/section) are also considered changes', () => {
    const baseline = { 'sections.balance': 11 };
    const changes = takeChanged(
      makeState({ balance: [11, {}] }, { 'pet-9': { say: [7, { text: '新来的' }] } }),
      baseline,
    );
    assert.deepEqual(
      changes.map((c) => c.path),
      ['pets.pet-9.say'],
    );
  });

  test('Multiple leaves change at the same time → all output (sequence: sections first, pets last)', () => {
    const baseline = { 'sections.balance': 1, 'pets.main.say': 1 };
    const changes = takeChanged(makeState({ balance: [2, {}] }, { main: { say: [2, {}] } }), baseline);
    assert.deepEqual(
      changes.map((c) => c.path),
      ['sections.balance', 'pets.main.say'],
    );
  });

  test('Pet id can be correctly distinguished even if it contains dot numbers (the baseline is keyed by the entire path)', () => {
    const baseline: Record<string, number> = {};
    const changes = takeChanged(makeState({}, { 'a.b': { say: [5, { text: 'x' }] } }), baseline);
    assert.deepEqual(
      changes.map((c) => c.path),
      ['pets.a.b.say'],
    );
  });
});

describe('resolveLeafPath - Path parsed into drop point (unique conventions for distribution rules)', () => {
  test('The six leaves of sections are each resolved into landing points.', () => {
    for (const name of ['config', 'balance', 'workStatus', 'notify', 'menu', 'focusSession'] as const) {
      assert.deepEqual(resolveLeafPath('sections.' + name), { where: 'section', name });
    }
  });

  test('Each of the five types of leaves pets brings pets id', () => {
    for (const name of ['say', 'anim', 'position', 'throw', 'lock'] as const) {
      assert.deepEqual(resolveLeafPath('pets.main.' + name), { where: 'pet', name, petId: 'main' });
    }
  });

  test('Pet id contains dot number: only press the last dot to cut the leaf name (the pet of `pets.a.b.say` is `a.b`)', () => {
    assert.deepEqual(resolveLeafPath('pets.a.b.say'), { where: 'pet', name: 'say', petId: 'a.b' });
  });

  test('The leaf name is invalid → null (`say.text` and the like are not regarded as leaf names)', () => {
    assert.equal(resolveLeafPath('pets.main.say.text'), null);
    assert.equal(resolveLeafPath('sections.balances'), null);
    assert.equal(resolveLeafPath('pets.main.unknown'), null);
  });

  test('Empty pet id / Empty leaf name / Missing leaf name → null (none of them are valid landing points)', () => {
    assert.equal(resolveLeafPath('pets..say'), null);
    assert.equal(resolveLeafPath('pets.main.'), null);
    assert.equal(resolveLeafPath('pets.main'), null);
    assert.equal(resolveLeafPath('sections.'), null);
  });

  test('Key that does not belong to any family → null (top-level counter, empty string, key of other plugins)', () => {
    assert.equal(resolveLeafPath(''), null);
    assert.equal(resolveLeafPath('counter'), null);
    assert.equal(resolveLeafPath('sectionsx.config'), null);
    assert.equal(resolveLeafPath('pet.main.say'), null);
  });
});

describe('readBalance —— Balance leaf → Client view', () => {
  test('money: raw.data flattened to the top of the view (including multi-currency wallet and peak and valley decoration)', () => {
    const hit = readBalance({
      counter: 1,
      data: {
        ok: true,
        provider: 'deepseek',
        shape: 'money',
        data: {
          wallets: [{ currency: 'CNY', total: '10.00', granted: '0.00', toppedUp: '10.00', fullBalance: '20' }],
          tier: 'idle',
        },
      },
    });
    assert.deepEqual(hit, {
      state: {
        provider: 'deepseek',
        shape: 'money',
        ok: true,
        wallets: [{ currency: 'CNY', total: '10.00', granted: '0.00', toppedUp: '10.00', fullBalance: '20' }],
        tier: 'idle',
      },
      manual: false,
    });
  });

  test('windows: The three-window usage is recognized only if it is a number, not a number → null (NaN is not sent to the display layer)', () => {
    const good = readBalance({
      counter: 1,
      data: { ok: true, provider: 'opencode', shape: 'windows', data: { rolling: 1, weekly: 2, monthly: 3 } },
    });
    assert.equal(good?.state.ok, true);
    const bad = readBalance({
      counter: 1,
      data: { ok: true, provider: 'opencode', shape: 'windows', data: { rolling: 'x', weekly: 2, monthly: 3 } },
    });
    assert.equal(bad, null);
  });

  test('Unavailable: reason is retained as is, invalid reason is normalized to fetch-error', () => {
    const hit = readBalance({ counter: 1, data: { ok: false, provider: 'p', reason: 'credential-missing' } });
    assert.deepEqual(hit?.state, { provider: 'p', ok: false, reason: 'credential-missing', message: undefined });
    const weird = readBalance({ counter: 1, data: { ok: false, provider: 'p', reason: '???' } });
    assert.equal(weird?.state.ok === false && weird.state.reason, 'fetch-error');
  });

  test('manual Mark: host Target true is considered a manual trigger (determine "must play when unavailable")', () => {
    const manual = readBalance({ counter: 1, data: { ok: false, provider: 'p', reason: 'unsupported', manual: true } });
    assert.equal(manual?.manual, true);
    const auto = readBalance({ counter: 1, data: { ok: false, provider: 'p', reason: 'unsupported' } });
    assert.equal(auto?.manual, false);
    const notBool = readBalance({
      counter: 1,
      data: { ok: false, provider: 'p', reason: 'unsupported', manual: 'yes' },
    });
    assert.equal(notBool?.manual, false, 'Only strictly true counts');
  });

  test('Dirty data → null (consumer skips this beat and does not throw it)', () => {
    assert.equal(readBalance({ counter: 1, data: null }), null);
    assert.equal(readBalance({ counter: 1, data: 'nope' }), null);
    assert.equal(readBalance({ counter: 1, data: { ok: true, provider: 'p', shape: '未知' } }), null);
    assert.equal(
      readBalance({ counter: 1, data: { ok: true, provider: 'p', shape: 'money' } }),
      null,
      'Missing data segment',
    );
  });
});

describe('readAnim - playback request animation leaf (name or address + receipt number)', () => {
  test('Both the name and playbackId are obtained (the renderer reports the true status at four opportunities accordingly)', () => {
    const hit = readAnim({ counter: 1, data: { name: '拉侧栏-拉拽', playbackId: 'pb-abc-1' } });
    assert.deepEqual(hit, { name: '拉侧栏-拉拽', url: undefined, playbackId: 'pb-abc-1', facing: undefined });
  });

  test('url form (issue #122 Article 1): Address obtained, name absent', () => {
    const hit = readAnim({ counter: 1, data: { url: 'https://cdn.example.com/拉侧栏.webm' } });
    assert.deepEqual(hit, {
      name: undefined,
      url: 'https://cdn.example.com/拉侧栏.webm',
      playbackId: undefined,
      facing: undefined,
    });
  });

  test('url has the same form with playbackId (the receipt semantics of the two routes are the same)', () => {
    const hit = readAnim({ counter: 1, data: { url: 'http://127.0.0.1:8080/a/x.webm', playbackId: 'pb-1' } });
    assert.equal(hit?.url, 'http://127.0.0.1:8080/a/x.webm');
    assert.equal(hit?.playbackId, 'pb-1');
  });

  test('The old host does not write playbackId → undefined (processed as "no receipt", not invalid data)', () => {
    const hit = readAnim({ counter: 1, data: { name: '东张西望' } });
    assert.equal(hit?.name, '东张西望');
    assert.equal(hit?.playbackId, undefined);
  });

  test('playbackId invalid shape (non-character string/empty string) → normalize to undefined, does not affect the name', () => {
    assert.equal(readAnim({ counter: 1, data: { name: 'A', playbackId: 42 } })?.playbackId, undefined);
    assert.equal(readAnim({ counter: 1, data: { name: 'A', playbackId: '' } })?.playbackId, undefined);
    assert.equal(readAnim({ counter: 1, data: { name: 'A', playbackId: null } })?.name, 'A');
  });

  test('When both are given, both are obtained (host decision layer guarantees that it will not be written like this; consumer gives priority to url)', () => {
    const hit = readAnim({ counter: 1, data: { name: 'A', url: 'https://x/y.webm' } });
    assert.equal(hit?.name, 'A');
    assert.equal(hit?.url, 'https://x/y.webm');
  });

  test('Dirty data → null (consumer skips this beat)', () => {
    assert.equal(readAnim({ counter: 1, data: null }), null);
    assert.equal(readAnim({ counter: 1, data: 'nope' }), null);
    // Both are absent = invalid shape: the host writer guarantees exactly one, the reader does not guess for it
    assert.equal(readAnim({ counter: 1, data: { name: '' } }), null);
    assert.equal(readAnim({ counter: 1, data: { name: 42 } }), null);
    assert.equal(readAnim({ counter: 1, data: { url: '' } }), null);
    assert.equal(readAnim({ counter: 1, data: { url: 42 } }), null);
    assert.equal(
      readAnim({ counter: 1, data: { playbackId: 'pb-1' } }),
      null,
      'Only the receipt number does not count as an instruction',
    );
  });

  test('facing (orientation parameter of POST /anim): valid value is obtained, both forms of name / url are applicable', () => {
    assert.equal(readAnim({ counter: 1, data: { name: '东张西望', facing: 'right' } })?.facing, 'right');
    assert.equal(readAnim({ counter: 1, data: { url: 'https://x/y.webm', facing: 'left' } })?.facing, 'left');
  });

  test('facing default → undefined (= **immobile orientation**, not fallback left)', () => {
    assert.equal(readAnim({ counter: 1, data: { name: 'A' } })?.facing, undefined);
    assert.equal(readAnim({ counter: 1, data: { name: 'A', facing: null } })?.facing, undefined);
  });

  test('facing invalid shape → normalize to undefined, and does not affect the instruction itself', () => {
    for (const bad of ['LEFT', 'Right', 'up', '', '   ', 42, true, {}]) {
      const hit = readAnim({ counter: 1, data: { name: 'A', facing: bad } });
      assert.equal(hit?.facing, undefined, JSON.stringify(bad) + ' 不应被当成朝向');
      assert.equal(
        hit?.name,
        'A',
        'Dirty facing The entire command should not be invalidated (it will still be played, but the direction will not change)',
      );
    }
  });
});

describe('readSay——Talking leaves (play bubble / clear in two forms)', () => {
  /** Only take the "bubble" form (clear / dirty data belongs to null) and make the assertion shorter */
  const say = (data: unknown) => {
    const hit = readSay({ counter: 1, data });
    return hit && hit.kind === 'say' ? hit : null;
  };

  test('Play bubble: text and pictures are obtained; without duration/anim/voiceTo, all three are undefined (= old behavior 10 s + linkage + no reading)', () => {
    assert.deepEqual(say({ text: '主人今天也要加油哦～', image: '可爱' }), {
      kind: 'say',
      text: '主人今天也要加油哦～',
      image: '可爱',
      url: undefined,
      duration: undefined,
      anim: undefined,
      voiceTo: undefined,
    });
  });

  test('Pictured url form (issue #122 Article 1): Address obtained, image absent', () => {
    const hit = say({ text: 'x', url: 'https://cdn.example.com/拒绝.png' });
    assert.equal(hit?.url, 'https://cdn.example.com/拒绝.png');
    assert.equal(hit?.image, undefined);
  });

  test('The two forms of pictures are juxtaposed and distinguished by field names: when both are given, both are obtained (host, the judgment layer guarantees that it will not be written like this)', () => {
    const hit = say({ text: 'x', image: '可爱', url: 'https://cdn.example.com/拒绝.png' });
    assert.equal(hit?.image, '可爱');
    assert.equal(hit?.url, 'https://cdn.example.com/拒绝.png');
  });

  test('url dirty value is treated as "not given" (non-character string does not ruin the whole shot), the text is displayed as usual', () => {
    for (const v of [42, {}, null, undefined]) {
      assert.equal(
        say({ text: 'x', url: v })?.url,
        undefined,
        `url = ${JSON.stringify(v)} should be converted into undefined`,
      );
    }
    // The empty string has the same conventions as image: transparent transmission as it is - the reader only narrows
    // the type and does not make trim / non-null determination (non-null is guaranteed by the host write end). When
    // the consumer gets the empty string, it will take the plain text path, without side effect.
    assert.equal(say({ text: 'x', url: '' })?.url, '');
    assert.equal(say({ text: 'x', url: 42 })?.text, 'x');
  });

  test('duration / anim are brought out as they are (including the two "meaningful false values" of 0 and false)', () => {
    assert.equal(
      say({ text: 'x', duration: 0, anim: false })?.duration,
      0,
      'duration =0 cannot be used as the default',
    );
    assert.equal(say({ text: 'x', duration: 0, anim: false })?.anim, false);
    assert.equal(say({ text: 'x', duration: 3000, anim: true })?.duration, 3000);
    assert.equal(say({ text: 'x', duration: 3000, anim: true })?.anim, true);
  });

  test('voiceTo: Only recognize web / desktop, and treat the others as not given (undefined)', () => {
    assert.equal(say({ text: 'x', voiceTo: 'web' })?.voiceTo, 'web');
    assert.equal(say({ text: 'x', voiceTo: 'desktop' })?.voiceTo, 'desktop');
    for (const v of ['both', 'any', 'WEB', 1, null, {}]) {
      assert.equal(
        say({ text: 'x', voiceTo: v })?.voiceTo,
        undefined,
        `voiceTo = ${JSON.stringify(v)} should be normalized to undefined`,
      );
    }
  });

  test('clear form: { clear : true } → { kind : " clear " } (**empty text cannot express it**)', () => {
    assert.deepEqual(readSay({ counter: 1, data: { clear: true } }), { kind: 'clear' });
    // Empty text is invalid and the whole beat is skipped - this is why "clear" must have an independent form. Pure
    // blanks are not covered here: host has been trim before writing, and readSay is only used for shape verification.
    assert.equal(readSay({ counter: 1, data: { text: '' } }), null);
    assert.equal(say({ text: '   ' })?.text, '   ');
  });

  test('clear takes precedence over text: press clear when both are present (host will not be written like this, but the shape must be determined)', () => {
    assert.deepEqual(readSay({ counter: 1, data: { clear: true, text: 'x' } }), { kind: 'clear' });
  });

  test('clear only recognizes strict true (" yes "/1 and the like are not counted, to prevent dirty data from accidentally clearing the bubble)', () => {
    for (const v of ['yes', 1, {}, null]) {
      assert.equal(
        say({ clear: v, text: 'x' })?.text,
        'x',
        `clear = ${JSON.stringify(v)} should not be judged as clear`,
      );
    }
  });

  test('duration dirty value should be treated as "not given" (negative number / NaN / Infinity / character string) without ruining the whole shot', () => {
    for (const v of [-1, NaN, Infinity, '3000', {}]) {
      assert.equal(
        say({ text: 'x', duration: v })?.duration,
        undefined,
        `duration = ${JSON.stringify(v)} should be normalized to undefined`,
      );
    }
  });

  test('Dirty data → null (consumer skips this beat)', () => {
    assert.equal(readSay({ counter: 1, data: null }), null);
    assert.equal(readSay({ counter: 1, data: 'nope' }), null);
    assert.equal(readSay({ counter: 1, data: {} }), null);
    assert.equal(readSay({ counter: 1, data: { text: 42 } }), null);
  });
});

describe('readPosition —— Position command leaf (center normalized coordinates + motion mode)', () => {
  test('instant / spring: Both coordinates and mode are obtained, duration is always 0 (these two modes do not use time)', () => {
    assert.deepEqual(readPosition({ counter: 1, data: { x: 0.5, y: 0.35, mode: 'instant' } }), {
      x: 0.5,
      y: 0.35,
      mode: 'instant',
      duration: 0,
    });
    assert.deepEqual(readPosition({ counter: 1, data: { x: 0.5, y: 0.35, mode: 'spring' } }), {
      x: 0.5,
      y: 0.35,
      mode: 'spring',
      duration: 0,
    });
  });

  test('line: duration are obtained together (`0` is also valid = in place immediately)', () => {
    assert.deepEqual(readPosition({ counter: 1, data: { x: 0.5, y: 0.35, mode: 'line', duration: 1200 } }), {
      x: 0.5,
      y: 0.35,
      mode: 'line',
      duration: 1200,
    });
    assert.equal(readPosition({ counter: 1, data: { x: 0.5, y: 0.35, mode: 'line', duration: 0 } })?.duration, 0);
  });

  test('Boundary values 0 and 1 are valid (the center can reach the edge of the screen)', () => {
    assert.deepEqual(readPosition({ counter: 1, data: { x: 0, y: 1, mode: 'spring' } }), {
      x: 0,
      y: 1,
      mode: 'spring',
      duration: 0,
    });
  });

  test('mode invalid/missing → null (old leaf { x , y , smooth } is no longer accepted: no guessing mode for caller)', () => {
    assert.equal(readPosition({ counter: 1, data: { x: 0.5, y: 0.5 } }), null);
    assert.equal(readPosition({ counter: 1, data: { x: 0.5, y: 0.5, mode: 'ease' } }), null);
    assert.equal(readPosition({ counter: 1, data: { x: 0.5, y: 0.5, mode: 'LINE' } }), null);
    assert.equal(readPosition({ counter: 1, data: { x: 0.5, y: 0.5, smooth: true } }), null);
  });

  test('line is missing duration (or invalid) → null (host must be written; if it is wrong, you would rather skip this beat than guess a time)', () => {
    assert.equal(readPosition({ counter: 1, data: { x: 0.5, y: 0.5, mode: 'line' } }), null);
    assert.equal(readPosition({ counter: 1, data: { x: 0.5, y: 0.5, mode: 'line', duration: -1 } }), null);
    assert.equal(readPosition({ counter: 1, data: { x: 0.5, y: 0.5, mode: 'line', duration: NaN } }), null);
    assert.equal(readPosition({ counter: 1, data: { x: 0.5, y: 0.5, mode: 'line', duration: '1200' } }), null);
  });

  test('Dirty data → null (missing coordinates / non-numeric / NaN / Infinity are rejected, NaN will not be sent to kinematics)', () => {
    assert.equal(readPosition({ counter: 1, data: null }), null);
    assert.equal(readPosition({ counter: 1, data: 'nope' }), null);
    assert.equal(readPosition({ counter: 1, data: { y: 0.5, mode: 'spring' } }), null);
    assert.equal(readPosition({ counter: 1, data: { x: 0.5, mode: 'spring' } }), null);
    assert.equal(readPosition({ counter: 1, data: { x: '0.5', y: 0.5, mode: 'spring' } }), null);
    assert.equal(readPosition({ counter: 1, data: { x: NaN, y: 0.5, mode: 'spring' } }), null);
    assert.equal(readPosition({ counter: 1, data: { x: 0.5, y: Infinity, mode: 'spring' } }), null);
  });
});

describe('readThrow —— Throwing command leaf (angle + strength)', () => {
  test('Both angle and intensity are obtained (angles are not normalized, negative values are retained as they are)', () => {
    assert.deepEqual(readThrow({ counter: 1, data: { angle: 45, power: 1 } }), { angle: 45, power: 1 });
    assert.deepEqual(readThrow({ counter: 1, data: { angle: -90, power: 3 } }), { angle: -90, power: 3 });
  });

  test('Dirty data → null (power ≤ 0 is also rejected: that is not an initial velocity)', () => {
    assert.equal(readThrow({ counter: 1, data: null }), null);
    assert.equal(readThrow({ counter: 1, data: 'nope' }), null);
    assert.equal(readThrow({ counter: 1, data: { angle: 45 } }), null);
    assert.equal(readThrow({ counter: 1, data: { power: 1 } }), null);
    assert.equal(readThrow({ counter: 1, data: { angle: '45', power: 1 } }), null);
    assert.equal(readThrow({ counter: 1, data: { angle: 45, power: 0 } }), null);
    assert.equal(readThrow({ counter: 1, data: { angle: 45, power: -1 } }), null);
    assert.equal(readThrow({ counter: 1, data: { angle: 45, power: NaN } }), null);
  });
});

describe('readSleep - Sleeping leaf analysis (status is not an instruction)', () => {
  test('Three forms: sleeping with a three-part name / awake / never written', () => {
    assert.deepEqual(readSleep({ counter: 1, data: { sleeping: true, start: 's', loop: 'l', end: 'e' } }), {
      sleeping: true,
      start: 's',
      loop: 'l',
      end: 'e',
    });
    assert.deepEqual(readSleep({ counter: 1, data: { sleeping: false } }), { sleeping: false });
    assert.equal(readSleep({ counter: 0, data: null }), null);
  });

  test('Invalid shapes will be discarded: missing segment name / empty segment name / non-Boolean sleeping', () => {
    assert.equal(readSleep({ counter: 1, data: { sleeping: true, start: 's', loop: 'l' } }), null);
    assert.equal(readSleep({ counter: 1, data: { sleeping: true, start: 's', loop: 'l', end: '' } }), null);
    assert.equal(readSleep({ counter: 1, data: { sleeping: 'yes' } }), null);
    assert.equal(readSleep({ counter: 1, data: 'sleeping' }), null);
  });
});
