/**
 * The request body contract sent by the dialogue: without a picture, it is the same as the old version verbatim, and
 * with a picture, there is an extra attachment.
 *
 * Why it's worth nailing: This is the only online contract between the client and the host. Sending one less field
 * will not cause an error, it will only make the desktop pet "cannot see the picture" - to troubleshoot, you have to
 * work backwards from the model.
 *
 * Use Node to build test runner (node:test) without introducing any npm dependencies.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { sendChat } from './send.ts';

/**
 * Replace global fetch with stub and collect request body.
 *
 * @param response - Pile the JSON body to be returned.
 * @returns collected body and recovery function (called in each use case finally).
 */
function captureFetch(response: unknown): { bodies: string[]; restore: () => void } {
  const bodies: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    bodies.push(String(init?.body ?? ''));
    return new Response(JSON.stringify(response), { status: 200 });
  }) as typeof fetch;
  return {
    bodies,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

describe('sendChat request body', () => {
  test('No picture: only text, which is the same as before adding the picture.', async () => {
    const captured = captureFetch({ ok: true });
    try {
      const state = await sendChat('http://127.0.0.1/dsh-pet-7340/chat', '在吗');
      assert.equal(state.ok, true);
      assert.deepEqual(JSON.parse(captured.bodies[0] ?? '{}'), { text: '在吗' });
    } finally {
      captured.restore();
    }
  });

  test('With picture: one more attachment, the fields are only mediaType and data', async () => {
    const captured = captureFetch({ ok: true });
    const attachment = { mediaType: 'image/jpeg', data: 'AAAA' };
    try {
      await sendChat('http://127.0.0.1/dsh-pet-7340/chat', '看图', attachment);
      assert.deepEqual(JSON.parse(captured.bodies[0] ?? '{}'), { text: '看图', attachment });
    } finally {
      captured.restore();
    }
  });

  test('host returns ok:false → normalizes the reason, and returns message as it is', async () => {
    const captured = captureFetch({ ok: false, reason: 'bad-request', message: '图片过大' });
    try {
      const state = await sendChat('http://127.0.0.1/dsh-pet-7340/chat', '看图');
      assert.deepEqual(state, { ok: false, reason: 'bad-request', message: '图片过大' });
    } finally {
      captured.restore();
    }
  });

  test('Unknown reason normalized into bad-request (the consumer only needs to process four types)', async () => {
    const captured = captureFetch({ ok: false, reason: 'something-new' });
    try {
      const state = await sendChat('http://127.0.0.1/dsh-pet-7340/chat', '在吗');
      assert.deepEqual(state, { ok: false, reason: 'bad-request', message: undefined });
    } finally {
      captured.restore();
    }
  });

  test('Response is not an object → throw error (caller decides how to prompt)', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => new Response('null', { status: 200 })) as typeof fetch;
    try {
      await assert.rejects(() => sendChat('http://127.0.0.1/dsh-pet-7340/chat', '在吗'), /invalid chat response/);
    } finally {
      globalThis.fetch = original;
    }
  });
});
