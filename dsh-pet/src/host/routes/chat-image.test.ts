/**
 * `POST /chat` ’s image input contract test: verification sequence, attachment access and reference transparent
 * transmission.
 *
 * Directly test the exported route processing function without using apply(): image access occurs before reading the
 * configuration, and the built-in configuration in the source code form is unreachable (readAllConfig will be thrown),
 * and the entire machine harness cannot reach this layer. The minimal dependency stub also verifies an order invariant
 * - chatWithPet should not be called even once when the image is rejected.
 *
 * Use Node to build test runner (node:test) without introducing any npm dependencies.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import type { PetImageRef, PetImageSink } from '../image-attachment.ts';
import type { PetRouteDeps, RouteInput } from './types.ts';
import { handleChatRoutes } from './chat.ts';

/** Minimum PNG header: 8 bytes, enough to complete the admission process */
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_BASE64 = PNG_BYTES.toString('base64');

/** A chatWithPet call (used to pass assertion route transparently) */
type ChatCall = { petId: string; text: string; image?: PetImageRef };

/** Create minimal route dependencies; only the members used by the chat branch are real, and the rest take up space according to the interface shape. */
function makeDeps(sink?: PetImageSink): { deps: PetRouteDeps; calls: ChatCall[] } {
  const calls: ChatCall[] = [];
  const deps = {
    configPaths: {},
    log: { error: () => {}, info: () => {}, warn: () => {}, debug: () => {} },
    memoryPath: '/tmp/dsh-pet-memory.json',
    memoryRounds: () => 5,
    readMemory: async () => ({}),
    requirePet: () => ({ ok: true, petId: 'main', entry: 'main', conf: {} }),
    optionalService: (name: string) => (name === 'attachments' ? sink : undefined),
    chatWithPet: async (petId: string, text: string, image?: PetImageRef) => {
      calls.push({ petId, text, image });
      return { ok: true as const, text: '嗯' };
    },
  } as unknown as PetRouteDeps;
  return { deps, calls };
}

/** Create an attachment service pile; `saved` records the bytes actually delivered, and `overrides` is used to construct an overrun/thrown error branch. */
function makeSink(overrides: Partial<PetImageSink> = {}): {
  sink: PetImageSink;
  saved: { data: Uint8Array; mediaType: string }[];
} {
  const saved: { data: Uint8Array; mediaType: string }[] = [];
  const sink: PetImageSink = {
    imageLimits: { maxImageBytes: 1024 },
    saveImages: async (inputs) => {
      saved.push(...inputs);
      return inputs.map((input) => ({
        attachmentId: 'sha256:' + 'a'.repeat(64),
        mediaType: input.mediaType,
        bytes: input.data.length,
        width: 8,
        height: 8,
      }));
    },
    ...overrides,
  };
  return { sink, saved };
}

/** A POST /chat call; URL is just a placeholder, pet and surface are determined by the requirePet pile. */
function postChat(body: unknown): RouteInput {
  return {
    url: new URL('http://127.0.0.1/dsh-pet-7340/chat?pet=main&surface=web'),
    rest: 'chat',
    method: 'POST',
    body: JSON.stringify(body),
  };
}

/** Get the JSON body from RouteResult (for assertion). */
function jsonBody(result: Awaited<ReturnType<typeof handleChatRoutes>>): Record<string, unknown> {
  assert.equal(result?.kind, 'json');
  return (result as { obj: Record<string, unknown> }).obj;
}

describe('POST /chat of attachment', () => {
  test('Do not transmit attachment: Take the original path, chatWithPet receives the undefined picture → the response and shape remain unchanged', async () => {
    const { sink } = makeSink();
    const { deps, calls } = makeDeps(sink);
    const body = jsonBody(await handleChatRoutes(deps, postChat({ text: '  在吗  ' })));
    assert.equal(body.ok, true);
    assert.deepEqual(calls, [{ petId: 'main', text: '在吗', image: undefined }]);
  });

  test('mediaType is not in the whitelist → bad-request, and chatWithPet is not called', async () => {
    const { deps, calls } = makeDeps(makeSink().sink);
    const body = jsonBody(
      await handleChatRoutes(
        deps,
        postChat({ text: '看图', attachment: { mediaType: 'image/bmp', data: PNG_BASE64 } }),
      ),
    );
    assert.equal(body.ok, false);
    assert.equal(body.reason, 'bad-request');
    assert.equal(calls.length, 0);
  });

  test('base64 contains invalid character → bad-request, and chatWithPet is not called', async () => {
    const { deps, calls } = makeDeps(makeSink().sink);
    const body = jsonBody(
      await handleChatRoutes(
        deps,
        postChat({ text: '看图', attachment: { mediaType: 'image/png', data: PNG_BASE64 + '!' } }),
      ),
    );
    assert.equal(body.reason, 'bad-request');
    assert.match(String(body.message), /base64/);
    assert.equal(calls.length, 0);
  });

  test('No attachment service (standalone mode) → bad-request, the copy indicates that images are not supported', async () => {
    const { deps, calls } = makeDeps(undefined);
    const body = jsonBody(
      await handleChatRoutes(
        deps,
        postChat({ text: '看图', attachment: { mediaType: 'image/png', data: PNG_BASE64 } }),
      ),
    );
    assert.equal(body.reason, 'bad-request');
    assert.match(String(body.message), /不支持图片/);
    assert.equal(calls.length, 0);
  });

  test('After decoding, the deployment limit is exceeded → bad-request, and no attachment is written.', async () => {
    const { sink, saved } = makeSink({ imageLimits: { maxImageBytes: 4 } });
    const { deps, calls } = makeDeps(sink);
    const body = jsonBody(
      await handleChatRoutes(
        deps,
        postChat({ text: '看图', attachment: { mediaType: 'image/png', data: PNG_BASE64 } }),
      ),
    );
    assert.equal(body.reason, 'bad-request');
    assert.match(String(body.message), /图片过大/);
    assert.equal(saved.length, 0);
    assert.equal(calls.length, 0);
  });

  test('Valid image: The attachment service receives the original bytes, and the reference is transparently passed to the conversation layer', async () => {
    const { sink, saved } = makeSink();
    const { deps, calls } = makeDeps(sink);
    const body = jsonBody(
      await handleChatRoutes(
        deps,
        postChat({ text: '屏幕上这个报错是什么', attachment: { mediaType: 'image/png', data: PNG_BASE64 } }),
      ),
    );
    assert.equal(body.ok, true);
    assert.equal(saved.length, 1);
    assert.equal(saved[0]?.mediaType, 'image/png');
    assert.deepEqual(saved[0]?.data, new Uint8Array(PNG_BYTES));
    assert.equal(calls.length, 1);
    // The text is transmitted as it is: the picture does not spell anything into the user's words
    assert.equal(calls[0]?.text, '屏幕上这个报错是什么');
    assert.match(String(calls[0]?.image?.attachmentId), /^sha256:/);
  });

  test('Attachment persist to disk failed → generate-error (not disguised as caller parameter error)', async () => {
    const { sink } = makeSink({
      saveImages: async () => {
        throw new Error('disk full');
      },
    });
    const { deps, calls } = makeDeps(sink);
    const body = jsonBody(
      await handleChatRoutes(
        deps,
        postChat({ text: '看图', attachment: { mediaType: 'image/png', data: PNG_BASE64 } }),
      ),
    );
    assert.equal(body.ok, false);
    assert.equal(body.reason, 'generate-error');
    assert.equal(calls.length, 0);
  });

  test('When the text is empty, press the text first to report an error. It will not be released just because a picture is included.', async () => {
    const { sink } = makeSink();
    const { deps, calls } = makeDeps(sink);
    const body = jsonBody(
      await handleChatRoutes(deps, postChat({ text: '   ', attachment: { mediaType: 'image/png', data: PNG_BASE64 } })),
    );
    assert.equal(body.reason, 'bad-request');
    assert.equal(calls.length, 0);
  });
});
