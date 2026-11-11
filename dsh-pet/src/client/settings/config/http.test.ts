/**
 * Contract test of the contract between the settings page and host HTTP.
 *
 * Three contracts:
 * 1. Failure is not thrown: `null` is returned if the interface fails to be read, and discriminative union is returned
 * if the interface fails to be written. The caller only handles branches and text;
 * 2. Write configuration to force explicit `force` : Only strict `true` can be used to spell `?force=1` (event objects
 * must not pretend to be true values to bypass the damage pre-check);
 * 3. If failed, check `reason` in the body: `user-config-unparsable` = damaged (bring out the real write path given by
 * the host), `bad-request` / `invalid-json` = verification failure, other negative entities and non-2 xx = general
 * error.
 *
 * Replace `globalThis.fetch` in each use case and restore it at the end - no real requests are sent.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSaveBody,
  loadConfig,
  loadMeta,
  loadModelCatalog,
  saveConfig,
  syncConfig,
  type SaveFields,
} from './http.ts';

/** A requested record. */
interface Call {
  url: string;
  init?: RequestInit;
}

/** Replace the global fetch, run a use case, and finally restore. */
async function withFetch(
  handler: (url: string, init?: RequestInit) => Response,
  run: (calls: Call[]) => Promise<void>,
): Promise<void> {
  const previous = globalThis.fetch;
  const calls: Call[] = [];
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return Promise.resolve(handler(String(input), init));
  }) as typeof fetch;
  try {
    await run(calls);
  } finally {
    globalThis.fetch = previous;
  }
}

/** JSON response. */
const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('loadConfig - Read resolved configuration', () => {
  test('2 xx returns aggregate; non-2 xx and network errors return null', async () => {
    await withFetch(
      () => json({ main: { pets: [] } }),
      async () => {
        assert.deepEqual(await loadConfig(), { main: { pets: [] } });
      },
    );
    await withFetch(
      () => json({}, 500),
      async () => {
        assert.equal(await loadConfig(), null);
      },
    );
    await withFetch(
      () => {
        throw new Error('断网');
      },
      async () => {
        assert.equal(await loadConfig(), null, 'Network errors cannot cause the settings page to crash');
      },
    );
  });

  test('Bring AbortSignal into the request (can be interrupted when unmounting)', async () => {
    const controller = new AbortController();
    await withFetch(json0, async (calls) => {
      await loadConfig(controller.signal);
      assert.equal(calls[0].init?.signal, controller.signal);
    });
  });
});

/** Fixed returning empty object. */
function json0(): Response {
  return json({ main: { pets: [] } });
}

describe('loadMeta / loadModelCatalog - Read meta information and candidate list', () => {
  test('meta: 2 xx returns to the original text, not 2 xx returns to null', async () => {
    await withFetch(
      () => json({ user: 'u', default: 'd', animations: 'a' }),
      async () => {
        assert.equal((await loadMeta())?.user, 'u');
      },
    );
    await withFetch(
      () => json({}, 404),
      async () => {
        assert.equal(await loadMeta(), null);
      },
    );
  });

  test('Candidate list: providers is recognized only if it is an array, otherwise null is returned (the selector shows that the pull failed)', async () => {
    await withFetch(
      () => json({ providers: [{ id: 'a', name: 'A', models: [] }] }),
      async () => {
        assert.deepEqual(await loadModelCatalog(), [{ id: 'a', name: 'A', models: [] }]);
      },
    );
    await withFetch(
      () => json({ providers: 'nope' }),
      async () => {
        assert.equal(await loadModelCatalog(), null);
      },
    );
    await withFetch(
      () => json({}, 503),
      async () => {
        assert.equal(await loadModelCatalog(), null);
      },
    );
  });
});

describe('saveConfig ——Write configuration', () => {
  const body = { pets: [] };

  test('Success: PUT + JSON header, return resolved configuration; without force parameter', async () => {
    await withFetch(
      () => json({ main: { pets: [] } }),
      async (calls) => {
        const outcome = await saveConfig(body, false);
        assert.equal(outcome.kind, 'ok');
        assert.deepEqual(outcome.kind === 'ok' ? outcome.merged : null, { main: { pets: [] } });
        assert.equal(calls[0].url.endsWith('/config'), true, 'URL cannot exist without parameters? force =1');
        assert.equal(calls[0].init?.method, 'PUT');
        assert.equal((calls[0].init?.headers as Record<string, string>)['content-type'], 'application/json');
        assert.equal(calls[0].init?.body, JSON.stringify(body));
      },
    );
  });

  test('force is strictly for true? force =1 (event objects are not counted)', async () => {
    await withFetch(
      () => json({ main: { pets: [] } }),
      async (calls) => {
        await saveConfig(body, true);
        assert.equal(calls[0].url.endsWith('/config?force=1'), true);
      },
    );
    await withFetch(
      () => json({ main: { pets: [] } }),
      async (calls) => {
        // React will pass MouseEvent as the first argument to onClick, which reproduces the input of "true value but not true".
        await saveConfig(body, { type: 'click' } as unknown as boolean);
        assert.equal(calls[0].url.endsWith('/config'), true, 'Non-strict true must not be spelled force');
      },
    );
  });

  test('user-config-unparsable: Return corrupted results and bring out the real write path given by host', async () => {
    await withFetch(
      () => json({ ok: false, reason: 'user-config-unparsable', userFile: 'C:/x/main-config.jsonc' }),
      async () => {
        assert.deepEqual(await saveConfig(body, true), { kind: 'corrupt', userFile: 'C:/x/main-config.jsonc' });
      },
    );
    await withFetch(
      () => json({ ok: false, reason: 'user-config-unparsable' }),
      async () => {
        assert.deepEqual(
          await saveConfig(body, true),
          { kind: 'corrupt', userFile: null },
          'Cannot throw when there is no userFile',
        );
      },
    );
  });

  test('bad-request is a verification failure, and the remaining negative entities are non-2. xx is a general error, and network errors are also general errors.', async () => {
    await withFetch(
      () => json({ ok: false, reason: 'bad-request' }),
      async () => {
        assert.deepEqual(await saveConfig(body, false), { kind: 'invalid' });
      },
    );
    await withFetch(
      () => json({}, 500),
      async () => {
        assert.deepEqual(await saveConfig(body, false), { kind: 'error' });
      },
    );
    await withFetch(
      () => {
        throw new Error('断网');
      },
      async () => {
        assert.deepEqual(await saveConfig(body, false), { kind: 'error' });
      },
    );
  });
});

describe('syncConfig - synchronous built-in default', () => {
  test('The resolved configuration is returned successfully, and null is returned if it fails.', async () => {
    await withFetch(
      () => json({ main: { pets: [] } }),
      async (calls) => {
        assert.deepEqual(await syncConfig(), { main: { pets: [] } });
        assert.equal(calls[0].init?.method, 'POST');
      },
    );
    await withFetch(
      () => json({}, 500),
      async () => {
        assert.equal(await syncConfig(), null);
      },
    );
  });
});

describe('buildSaveBody ——Request body field', () => {
  test('The key name corresponds to the host verification field one-to-one, one is no more and the other is less.', () => {
    const fields = {
      pets: [],
      notificationsEnabled: true,
      clickSoundEnabled: false,
      whisperImageEnabled: false,
      chatImageEnabled: false,
      chatAnimationEnabled: false,
      confineToScreen: false,
      trayEnabled: true,
      voiceEnabled: true,
      voiceName: 'zh-CN-XiaoyiNeural',
      physics: {},
      whisperModel: { provider: '', model: '' },
      chatModel: { provider: '', model: '' },
      chatMemoryRounds: 5,
      chatImageLimit: 10,
      font: {},
      animationWeights: { idle: 10, turn: 5, move: 5 },
    } as unknown as SaveFields;
    assert.deepEqual(Object.keys(buildSaveBody(fields)).sort(), [
      'animationWeights',
      'chatAnimationEnabled',
      'chatImageEnabled',
      'chatImageLimit',
      'chatMemoryRounds',
      'chatModel',
      'clickSoundEnabled',
      'confineToScreen',
      'font',
      'notificationsEnabled',
      'pets',
      'physics',
      'trayEnabled',
      'voiceEnabled',
      'voiceName',
      'voiceNotifyEnabled',
      'voiceTodoEnabled',
      'voiceVolume',
      'voiceWhisperEnabled',
      'whisperImageEnabled',
      'whisperModel',
    ]);
  });

  test('Take out the value as it is without secondary packaging.', () => {
    const fields = {
      pets: [{ id: 'pet-1' }],
      notificationsEnabled: false,
      clickSoundEnabled: true,
      whisperImageEnabled: true,
      chatImageEnabled: true,
      chatAnimationEnabled: true,
      confineToScreen: true,
      trayEnabled: false,
      physics: { gravity: 3 },
      whisperModel: { provider: 'a', model: 'b' },
      chatModel: { provider: '', model: '' },
      chatMemoryRounds: 0,
      chatImageLimit: 3,
      font: { size: 20 },
    } as unknown as SaveFields;
    const body = buildSaveBody(fields);
    assert.equal(body.chatMemoryRounds, 0);
    assert.deepEqual(body.physics, { gravity: 3 });
    assert.equal(body.notificationsEnabled, false);
  });
});
