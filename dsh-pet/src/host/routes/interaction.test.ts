/**
 * Contract test of / whisper in session interaction route (src/host/routes/interaction.ts): ? image = transparently
 * passed to the generation function, ? surface = completed voiceTo, not provided by default, failed reason is exposed
 * as is. The three branches of locking/feeding/clearing bubbles each have their own coverage. Here is only the link
 * verify/whisper.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { handleInteractionRoutes } from './interaction.ts';
import type { GeneratedReply, PetRouteDeps, RouteInput } from './types.ts';

/** Create a dependency that only satisfies the /whisper branch: the pet positioning is always hit, and the generated behavior is given by the caller. */
function harness(whisper: (petId: string, image?: string) => Promise<GeneratedReply>) {
  const calls: { petId: string; image?: string; voiceTo?: string }[] = [];
  const deps = {
    requirePet: () => ({ ok: true, petId: 'main', entry: 'main', conf: {}, pet: {} }),
    publishWhisper: (petId: string, image?: string, voiceTo?: string) => {
      calls.push({ petId, image, voiceTo });
      return whisper(petId, image);
    },
  } as unknown as PetRouteDeps;
  const call = (query: string) =>
    handleInteractionRoutes(deps, {
      url: new URL('http://127.0.0.1/dsh-pet-7340/whisper' + query),
      rest: 'whisper',
      method: 'POST',
    } as RouteInput);
  return { calls, call };
}

describe('handleInteractionRoutes —— / voiceTo of whisper (whoever clicks it reads it)', () => {
  test('surface = web / desktop falls to voiceTo as it is', async () => {
    const web = harness(async () => ({ ok: true, text: '好' }));
    await web.call('?pet=main&surface=web');
    assert.equal(web.calls[0]?.voiceTo, 'web');

    const desktop = harness(async () => ({ ok: true, text: '好' }));
    await desktop.call('?pet=main&surface=desktop');
    assert.equal(desktop.calls[0]?.voiceTo, 'desktop');
  });

  test('surface = both / any is not enough to specify one end → do not pass, leave it to display for derivation', async () => {
    for (const want of ['both', 'any']) {
      const probe = harness(async () => ({ ok: true, text: '好' }));
      await probe.call('?pet=main&surface=' + want);
      assert.equal(probe.calls[0]?.voiceTo, undefined, `surface = ${want} should not be specified as one end`);
    }
  });
});

describe('handleInteractionRoutes——/Specified picture of whisper', () => {
  test('With ? image =: The picture name is handed over to the generation function as it is. A successful response will still bring back the text and picture.', async () => {
    const { calls, call } = harness(async (_petId, image) => ({ ok: true, text: '好呀', image }));
    const result = await call('?pet=main&image=' + encodeURIComponent('大的要来啦'));
    assert.deepEqual(
      calls,
      [{ petId: 'main', image: '大的要来啦', voiceTo: undefined }],
      'The picture title must be transparently transmitted as it is without decoding and misalignment.',
    );
    assert.equal((result as { obj: { image?: string } }).obj.image, '大的要来啦');
  });

  test('Without ? image =: The generation function received undefined (the old path of random/plain text)', async () => {
    const { calls, call } = harness(async () => ({ ok: true, text: '好呀' }));
    await call('?pet=main');
    assert.deepEqual(calls, [{ petId: 'main', image: undefined, voiceTo: undefined }]);
  });

  test('The picture is not in the pool: unknown-image is revealed as it is, not blurred into generate-error', async () => {
    const { call } = harness(async () => ({ ok: false, reason: 'unknown-image', message: '表情包不在池内：查无此图' }));
    const result = await call('?pet=main&image=' + encodeURIComponent('查无此图'));
    const body = (result as { status: number; obj: { ok: boolean; reason?: string } }).obj;
    assert.equal((result as { status: number }).status, 200, 'Business failure uses "HTTP 200 + failed entity"');
    assert.equal(body.ok, false);
    assert.equal(body.reason, 'unknown-image', 'The caller branches according to reason and cannot be normalized.');
  });
});
