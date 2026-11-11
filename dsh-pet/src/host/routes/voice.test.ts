/**
 * Contract test of voice route (src/host/routes/voice.ts). Only assertion protocol layer: method determination, JSON
 * determination, and mapping the conclusion of the voice service to a response; no real request is sent.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PetRouteDeps } from './types.ts';
import { handleVoiceRoutes } from './voice.ts';

const VOICES = [{ id: 'zh-CN-XiaoxiaoNeural', name: '晓晓', tag: '女 · 通用', default: true }];

/** Provide only voice and speech; this route does not access other dependencies. */
function makeDeps(
  speak: (raw: unknown) => Promise<unknown>,
  hear: (raw: unknown, signal?: AbortSignal) => Promise<unknown> = async () => ({ ok: true, text: '你好' }),
): PetRouteDeps {
  return { voice: { listVoices: () => VOICES, speak }, speech: { hear } } as unknown as PetRouteDeps;
}

/** Create a route input. */
function input(rest: string, method: string, body?: string) {
  return { url: new URL(`http://127.0.0.1:1/dsh-pet-7340/${rest}`), rest, method, body };
}

test('GET /voice/voices: Return to the tone list', async () => {
  const result = await handleVoiceRoutes(
    makeDeps(async () => ({ ok: true, file: '/x.mp3' })),
    input('voice/voices', 'GET'),
  );
  assert.equal(result?.kind, 'json');
  if (result?.kind !== 'json') return;
  assert.equal(result.status, 200);
  assert.deepEqual((result.obj as { voices: unknown }).voices, VOICES);
});

test('POST /voice/speak Success: Return the mp3 file', async () => {
  const result = await handleVoiceRoutes(
    makeDeps(async () => ({ ok: true, file: '/cache/a.mp3' })),
    input('voice/speak', 'POST', '{"text":"hi"}'),
  );
  assert.deepEqual(result, { kind: 'file', file: '/cache/a.mp3', contentType: 'audio/mpeg' });
});

test('POST /voice/speak business failure: 200 + failed entity (not made into 4 xx)', async () => {
  const result = await handleVoiceRoutes(
    makeDeps(async () => ({ ok: false, reason: 'bad-request', message: 'nope' })),
    input('voice/speak', 'POST', '{"text":""}'),
  );
  assert.equal(result?.kind, 'json');
  if (result?.kind !== 'json') return;
  assert.equal(result.status, 200);
  assert.equal((result.obj as { reason: string }).reason, 'bad-request');
});

test('POST /voice/speak request body is not JSON: 400', async () => {
  const result = await handleVoiceRoutes(
    makeDeps(async () => ({ ok: true, file: '/x' })),
    input('voice/speak', 'POST', 'not json'),
  );
  assert.equal(result?.kind, 'json');
  if (result?.kind === 'json') assert.equal(result.status, 400);
});

test('POST /voice/hear Success: Return recognition text', async () => {
  const result = await handleVoiceRoutes(
    makeDeps(async () => ({ ok: true, file: '/x.mp3' })),
    input('voice/hear', 'POST', '{"audio":"AAAA"}'),
  );
  assert.equal(result?.kind, 'json');
  if (result?.kind !== 'json') return;
  assert.equal(result.status, 200);
  assert.deepEqual(result.obj, { ok: true, text: '你好' });
});

test('POST /voice/hear business failure: 200 + failed entities (same conventions as / chat)', async () => {
  const result = await handleVoiceRoutes(
    makeDeps(
      async () => ({ ok: true, file: '/x.mp3' }),
      async () => ({
        ok: false,
        reason: 'unsupported',
        message: 'host has no speech provider enabled',
      }),
    ),
    input('voice/hear', 'POST', '{"audio":"AAAA"}'),
  );
  assert.equal(result?.kind, 'json');
  if (result?.kind !== 'json') return;
  assert.equal(result.status, 200);
  assert.equal((result.obj as { reason: string }).reason, 'unsupported');
});

test('POST /voice/hear request body is not JSON: 400', async () => {
  const result = await handleVoiceRoutes(
    makeDeps(async () => ({ ok: true, file: '/x' })),
    input('voice/hear', 'POST', 'nope'),
  );
  assert.equal(result?.kind === 'json' ? result.status : 0, 400);
});

test('POST /voice/hear hand over the disconnect signal to the identification service', async () => {
  let received: AbortSignal | undefined;
  const abort = new AbortController();
  await handleVoiceRoutes(
    makeDeps(
      async () => ({ ok: true, file: '/x.mp3' }),
      async (_raw, signal) => {
        received = signal;
        return { ok: true, text: '好' };
      },
    ),
    { ...input('voice/hear', 'POST', '{"audio":"AAAA"}'), signal: abort.signal },
  );
  assert.equal(received, abort.signal, 'Recognition should be aborted when the caller is disconnected');
});

test('Wrong method: all three endpoints are 405', async () => {
  const speak = await handleVoiceRoutes(
    makeDeps(async () => ({ ok: true, file: '/x' })),
    input('voice/speak', 'GET'),
  );
  assert.equal(speak?.kind === 'json' ? speak.status : 0, 405);
  const voices = await handleVoiceRoutes(
    makeDeps(async () => ({ ok: true, file: '/x' })),
    input('voice/voices', 'POST'),
  );
  assert.equal(voices?.kind === 'json' ? voices.status : 0, 405);
  const hear = await handleVoiceRoutes(
    makeDeps(async () => ({ ok: true, file: '/x' })),
    input('voice/hear', 'GET'),
  );
  assert.equal(hear?.kind === 'json' ? hear.status : 0, 405);
});

test('Irrelevant path: hand back undefined and let next processor take over', async () => {
  const result = await handleVoiceRoutes(
    makeDeps(async () => ({ ok: true, file: '/x' })),
    input('state', 'GET'),
  );
  assert.equal(result, undefined);
});
