/**
 * Testing of the dialog window data layer: `GET /chat` response shaping, round grouping, image fetching address,
 * delete request shape and memory boundary.
 *
 * Direct testing of pure functions; HTTP is required to go through the `fetch` pile, and the assertion request shape
 * is normalized to the failure (not connected to the Internet).
 *
 * Running method: node --experimental-strip-types --test src/client/chat/api.test.ts
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  attachmentUrl,
  clearHistory,
  deleteRounds,
  fetchChatConfig,
  groupRounds,
  memeUrl,
  memoryBoundaryIndex,
  personaText,
  playAction,
  roundsToRevealMemory,
  toChatMessages,
} from './api.ts';

describe('toChatMessages —— GET /chat response shaping', () => {
  test('Normal message → Leave role / content / ts as is', () => {
    const list = toChatMessages({
      ok: true,
      messages: [
        { role: 'user', content: '在吗', ts: 1000 },
        { role: 'assistant', content: '在的', ts: 1000 },
      ],
      rounds: 5,
    });
    assert.deepEqual(list, [
      { role: 'user', text: '在吗', ts: 1000 },
      { role: 'assistant', text: '在的', ts: 1000 },
    ]);
  });

  test('messages is not an array → empty list (no error thrown)', () => {
    for (const bad of [null, undefined, {}, 42, { messages: 'x' }]) {
      assert.deepEqual(toChatMessages(bad), []);
    }
  });

  test('Single piece of bad data → discard this piece and display the rest as usual', () => {
    const list = toChatMessages({
      messages: [
        { role: 'user', content: '好的', ts: 1 },
        null,
        { role: 'system', content: '不该出现', ts: 2 },
        { role: 'user', ts: 3 },
        { role: 'assistant', content: '收到', ts: 4 },
      ],
    });
    assert.deepEqual(
      list.map((m) => m.text),
      ['好的', '收到'],
    );
  });

  test('ts is not a number → marked as 0 (the rendering layer does not display the time accordingly)', () => {
    const list = toChatMessages({ messages: [{ role: 'user', content: '嗨' }] });
    assert.equal(list[0]?.ts, 0);
  });
});

describe('groupRounds - Group by round (display and delete at the same granularity)', () => {
  const user = (text: string, ts: number) => ({ role: 'user' as const, text, ts });
  const pet = (text: string, ts: number) => ({ role: 'assistant' as const, text, ts });

  test('Questions and answers for the same ts synthesis round', () => {
    const rounds = groupRounds([user('在吗', 1000), pet('在的', 1000)]);
    assert.equal(rounds.length, 1);
    assert.equal(rounds[0]?.user?.text, '在吗');
    assert.equal(rounds[0]?.assistant?.text, '在的');
  });

  test('different ts → each form a wheel, the order remains unchanged', () => {
    const rounds = groupRounds([user('一', 1), pet('一答', 1), user('二', 2), pet('二答', 2)]);
    assert.deepEqual(
      rounds.map((round) => round.ts),
      [1, 2],
    );
  });

  test('ts is 0 → each message forms its own round (otherwise messages without timestamps will be squeezed into one round)', () => {
    const rounds = groupRounds([user('甲', 0), pet('乙', 0)]);
    assert.equal(rounds.length, 2);
  });

  test('Only one side is left (deleted or truncated) → only half of the round is left, no gaps are filled', () => {
    const rounds = groupRounds([pet('孤零零的回答', 5)]);
    assert.equal(rounds.length, 1);
    assert.equal(rounds[0]?.user, undefined);
    assert.equal(rounds[0]?.assistant?.text, '孤零零的回答');
  });
});

describe('toChatMessages ——Picture information', () => {
  const REF = { attachmentId: 'sha256:abc', mediaType: 'image/png', bytes: 12, width: 8, height: 6 };

  test('user with picture → Accept the attachment reference, and the rendering layer will be assembled accordingly / attachment', () => {
    const list = toChatMessages({ messages: [{ role: 'user', content: '看图', ts: 1, image: REF }] });
    assert.deepEqual(list[0]?.image, REF);
  });

  test('assistant with accompanying picture name → write down meme and do not quote it as an attachment', () => {
    const list = toChatMessages({ messages: [{ role: 'assistant', content: '好耶', ts: 1, meme: '可爱' }] });
    assert.equal(list[0]?.meme, '可爱');
    assert.equal(list[0]?.image, undefined);
  });

  test('Wrong reference shape (old record/bad data) → Treat as no picture, does not affect the text', () => {
    for (const bad of [null, 'x', {}, { attachmentId: '' }, { attachmentId: 42 }]) {
      const list = toChatMessages({ messages: [{ role: 'user', content: '嗨', ts: 1, image: bad }] });
      assert.equal(list[0]?.image, undefined);
      assert.equal(list[0]?.text, '嗨');
    }
  });

  test('assistant drive action name → write down action for the replay button on the right side of the speaker', () => {
    const list = toChatMessages({
      messages: [{ role: 'assistant', content: '好耶', ts: 1, action: '优雅女仆舞' }],
    });
    assert.equal(list[0]?.action, '优雅女仆舞');
    assert.equal(list[0]?.meme, undefined);
  });

  test('The action name is an empty string or a non-character string → it is treated as no action is performed.', () => {
    for (const bad of ['', 42, null, {}]) {
      const list = toChatMessages({ messages: [{ role: 'assistant', content: '嗯', ts: 1, action: bad }] });
      assert.equal(list[0]?.action, undefined);
    }
  });
});

describe('Image retrieval address', () => {
  test('attachmentUrl encodes attachmentId as URL', () => {
    assert.equal(
      attachmentUrl({ attachmentId: 'sha256:a b', mediaType: 'image/png', bytes: 1, width: 1, height: 1 }),
      '/dsh-pet-7340/attachment?id=sha256%3Aa%20b',
    );
  });

  test('memeUrl with asset root; when the asset root is empty, the two-stage form is returned.', () => {
    assert.equal(memeUrl('可爱', 'main'), '/dsh-pet-7340/pic/memes/main/%E5%8F%AF%E7%88%B1.png');
    assert.equal(memeUrl('可爱', '  '), '/dsh-pet-7340/pic/memes/%E5%8F%AF%E7%88%B1.png');
  });
});

describe('playAction - Replay action move / anim', () => {
  /** Run once with the given response double and recycle the request and return value. */
  async function withFetch<T>(
    body: unknown,
    run: () => Promise<T>,
  ): Promise<{ calls: { url: string; method: string; body: unknown }[]; value: T }> {
    const calls: { url: string; method: string; body: unknown }[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), method: init?.method ?? 'GET', body: init?.body });
      return new Response(JSON.stringify(body), { status: 200 });
    }) as typeof fetch;
    try {
      return { calls, value: await run() };
    } finally {
      globalThis.fetch = original;
    }
  }

  test('POST /anim ? pet =& surface = any, body only takes the action name', async () => {
    const { calls, value } = await withFetch({ ok: true, playbackId: 'pb_1' }, () => playAction('main', '优雅女仆舞'));
    assert.deepEqual(
      calls.map((call) => call.url),
      // surface is a required field of / anim: without it, the host will directly 400, and the button will appear as "no response when clicked"
      ['/dsh-pet-7340/anim?pet=main&surface=any'],
    );
    assert.equal(calls[0]?.method, 'POST');
    assert.deepEqual(JSON.parse(String(calls[0]?.body)), { name: '优雅女仆舞' });
    assert.equal(value, true);
  });

  test('host rejected (name is not in the pool/pet is not displayed) → return false, no error is thrown', async () => {
    const { value } = await withFetch({ ok: false, reason: 'unknown-animation' }, () =>
      playAction('main', '不存在的动作'),
    );
    assert.equal(value, false);
  });
});

describe('Delete conversation memory - request shape and failure normalization', () => {
  /** Run once with the given response double and recycle the request and return value. */
  async function withFetch<T>(
    body: unknown,
    run: () => Promise<T>,
  ): Promise<{ calls: { url: string; method: string }[]; value: T }> {
    const calls: { url: string; method: string }[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), method: init?.method ?? 'GET' });
      return new Response(JSON.stringify(body), { status: 200 });
    }) as typeof fetch;
    try {
      return { calls, value: await run() };
    } finally {
      globalThis.fetch = original;
    }
  }

  test('deleteRounds uses DELETE and treats each ts as a duplicate query parameter', async () => {
    const { calls, value } = await withFetch({ ok: true, removed: 2 }, () => deleteRounds('main', [1000, 2000]));
    assert.deepEqual(calls, [{ url: '/dsh-pet-7340/chat?pet=main&ts=1000&ts=2000', method: 'DELETE' }]);
    assert.deepEqual(value, { ok: true, removed: 2 });
  });

  test('clearHistory without ts (= clear whole)', async () => {
    const { calls } = await withFetch({ ok: true, removed: 0 }, () => clearHistory('main'));
    assert.deepEqual(calls, [{ url: '/dsh-pet-7340/chat?pet=main', method: 'DELETE' }]);
  });

  test('Empty selection does not send request (no round to delete)', async () => {
    const { calls, value } = await withFetch({ ok: true, removed: 0 }, () => deleteRounds('main', []));
    assert.deepEqual(calls, [], 'Should not disturb the host when not checked');
    assert.deepEqual(value, { ok: true, removed: 0 });
  });

  test('Business failure → Bring back the server copy without throwing errors', async () => {
    const { value } = await withFetch({ ok: false, reason: 'unknown-pet', message: '没有这只桌宠' }, () =>
      deleteRounds('nobody', [1]),
    );
    assert.deepEqual(value, { ok: false, message: '没有这只桌宠' });
  });
});

describe('memoryBoundaryIndex - memory boundary line location', () => {
  test('The total number of rounds is more than the number of memory rounds → return to the dividing index (the line before the line is the archive)', () => {
    assert.equal(memoryBoundaryIndex(10, 5), 5);
    assert.equal(memoryBoundaryIndex(3, 1), 2);
  });

  test('Everything is in memory → No lines drawn', () => {
    assert.equal(memoryBoundaryIndex(5, 5), null);
    assert.equal(memoryBoundaryIndex(3, 9), null);
  });

  test('Turn off memory (0) or there is no such value in the configuration → no line is drawn', () => {
    assert.equal(memoryBoundaryIndex(10, 0), 10);
    assert.equal(memoryBoundaryIndex(10, undefined), null);
  });

  test('No message → No line drawn', () => {
    assert.equal(memoryBoundaryIndex(0, 5), null);
  });
});

describe('roundsToRevealMemory - How many rounds do you need to put the memory line into the window?', () => {
  test('The line is before the penultimate round N: at least N + 1 round is required before there is one round to display on the line', () => {
    assert.equal(roundsToRevealMemory(5), 6);
    assert.equal(roundsToRevealMemory(1), 2);
  });

  test('No memory (0 or negative number) → 0, caller does not need to release the turn', () => {
    assert.equal(roundsToRevealMemory(0), 1);
    assert.equal(roundsToRevealMemory(-3), 0);
  });
});

describe('fetchChatConfig —— Bring out the memory round number in the same copy / config', () => {
  test('Read chatMemoryRounds by entry, while flattening the pet list', async () => {
    const body = {
      main: { pets: [{ id: 'main', name: '主宠' }], chatMemoryRounds: 7 },
      extra: { pets: [{ id: 'pig', name: '猪' }], chatMemoryRounds: 3 },
      broken: { pets: [], chatMemoryRounds: 'nope' },
    };
    const original = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify(body), { status: 200 })) as typeof fetch;
    try {
      const config = await fetchChatConfig();
      assert.deepEqual(
        config.roundsByEntry,
        { main: 7, extra: 3 },
        'Illegal rounds should not be entered into the table',
      );
      assert.deepEqual(
        config.pets.map((pet) => pet.id),
        ['main', 'pig'],
      );
      assert.equal(config.pets[0]?.assetRoot, 'main');
    } finally {
      globalThis.fetch = original;
    }
  });

  test('The same request brings back the persona of each pet: the instance level takes priority, if not, use the one belonging to the entry.', async () => {
    const body = {
      main: {
        pets: [
          { id: 'main', name: '主宠' },
          { id: 'cat', name: '猫', whisperPrompt: '我自己的人设' },
        ],
        whisperPrompt: '条目默认人设',
      },
      pack: { pets: [{ id: 'pig', name: '猪' }], whisperPrompt: '种类人设' },
    };
    const original = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify(body), { status: 200 })) as typeof fetch;
    try {
      const config = await fetchChatConfig();
      assert.deepEqual(config.personaByPet, {
        main: '条目默认人设',
        cat: '我自己的人设',
        pig: '种类人设',
      });
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe('personaText ——Which persona is displayed on the panel?', () => {
  test('Instance-level non-blank → Use the original text of the instance (replace the entry copy and retain the typesetting)', () => {
    assert.equal(personaText('  我的猫娘人设\n第二行 ', '条目人设'), '  我的猫娘人设\n第二行 ');
  });

  test('The instance level is completely blank or missing → fallback to the top level of the entry it belongs to', () => {
    assert.equal(personaText('   ', '条目人设'), '条目人设');
    assert.equal(personaText(undefined, '条目人设'), '条目人设');
  });

  test('Neither → Empty string (the built-in default is guaranteed by configuration merging, no text is created out of thin air here)', () => {
    assert.equal(personaText(undefined, undefined), '');
    assert.equal(personaText('', ''), '');
  });

  test('Dirty value of non-character string → Treat as unwritten and do not display the object to the user', () => {
    assert.equal(personaText({ text: '对象' }, '条目人设'), '条目人设');
    assert.equal(personaText(undefined, 42), '');
  });
});
