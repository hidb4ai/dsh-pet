/**
 * Contract test of the "eat free rice" menu controller - verify three judgments: read the three inputs of the click,
 * register the precondition of the menu, and search for the playback request attribute entry. These three
 * determinations do not touch DOM and are the only part of this logic that can be separated from the browser
 * assertion.
 *
 * The fake transport layer and fake performance only implement the called members; `retryMs` passes a negative number,
 * so that the first shot must enter the complement register branch.
 *
 * Running method: node --experimental-strip-types --test src/client/baifan/menu.test.ts
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import type { ActivityAssets } from './assets.ts';
import { createMenu } from './menu.ts';
import type { Show } from './show.ts';
import type { Transport } from './transport.ts';

/** Record an interface call. */
interface CallRecord {
  /** HTTP method. */
  method: string;
  /** Path (without prefix). */
  path: string;
  /** Request body (record if available). */
  body?: unknown;
}

/** Fake transport layer: only `call` is implemented, and the remaining members are implemented empty. */
function fakeTransport(reply: (rec: CallRecord) => Record<string, unknown>): {
  transport: Transport;
  calls: CallRecord[];
} {
  const calls: CallRecord[] = [];
  const transport: Transport = {
    attach: () => {},
    call: async (method, path, body) => {
      const rec: CallRecord = { method, path };
      if (body !== undefined) rec.body = body;
      calls.push(rec);
      return reply(rec);
    },
    pose: () => null,
    progress: () => null,
    waitPlayback: async () => ({ status: 'gone' }),
  };
  return { transport, calls };
}

/** Fake show: only record start request. */
function fakeShow(): { show: Show; starts: Array<{ petId: string; assets: ActivityAssets }> } {
  const starts: Array<{ petId: string; assets: ActivityAssets }> = [];
  const show: Show = {
    start: (petId, assets) => {
      starts.push({ petId, assets });
    },
    halt: async () => {},
    isRunning: () => false,
  };
  return { show, starts };
}

/** Wait for the asynchronous chain to finish running: there is only one await in `launch`, two rounds of setImmediate are enough. */
async function flush(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));
}

/** Create a default dependency; the return value of `get` is overwritten according to use cases. */
function makeMenu(get: (name: string) => unknown, transport: Transport, show: Show): ReturnType<typeof createMenu> {
  return createMenu({
    get,
    transport,
    show,
    signal: new AbortController().signal,
    // Negative number: `performance.now() - 0` is always greater than it, and the first beat must enter the complement register branch.
    retryMs: -1,
  });
}

describe('createMenu', () => {
  test('Read click: The service in the page is missing → add register menu, no playback request', async () => {
    const { transport, calls } = fakeTransport(() => ({ ok: true }));
    const { show, starts } = fakeShow();
    const menu = makeMenu(() => undefined, transport, show);

    menu.tick();
    await flush();

    assert.deepEqual(
      calls.map((rec) => rec.method + ' ' + rec.path),
      ['GET /config'],
      'When the service is missing, only register should be added, and playback request should not occur.',
    );
    assert.equal(starts.length, 0, 'The show should not start without clicks');
  });

  test('Read click: owner has not entered the snapshot (ok:false) → add register menu', async () => {
    const { transport, calls } = fakeTransport(() => ({ ok: true }));
    const { show } = fakeShow();
    const menu = makeMenu(() => ({ menuEvents: () => ({ ok: false }) }), transport, show);

    menu.tick();
    await flush();

    assert.deepEqual(
      calls.map((rec) => rec.method + ' ' + rec.path),
      ['GET /config'],
      'Retry register at intervals when owner is not in the snapshot',
    );
  });

  test('Read click: Hit "Eat for free" → Press petId to find the entry and start the performance', async () => {
    const { transport, calls } = fakeTransport(() => ({
      main: { pets: [{ id: 'pet-1' }], animations: { baifan: ['a', 'b'] } },
    }));
    const { show, starts } = fakeShow();
    const menu = makeMenu(() => ({ menuEvents: () => ({ ok: true, events: { 吃白饭: 'pet-1' } }) }), transport, show);

    menu.tick();
    await flush();

    assert.deepEqual(
      calls.map((rec) => rec.method + ' ' + rec.path),
      ['GET /config'],
      'Read-only configuration after hit, no more register',
    );
    assert.equal(starts.length, 1, 'Found the belonging entry and should start the show once');
    assert.equal(starts[0].petId, 'pet-1', 'The show starts with the pet that was selected.');
  });

  test('register menu: main does not match animations.baifan → does not send POST', async () => {
    const { transport, calls } = fakeTransport(() => ({ main: { animations: {} } }));
    const { show } = fakeShow();
    const menu = makeMenu(() => undefined, transport, show);

    await menu.ensureMenu();

    assert.deepEqual(
      calls.map((rec) => rec.method + ' ' + rec.path),
      ['GET /config'],
      'Without this method, you should not go to the host register menu item',
    );
  });

  test('register menu: equipped with animations.baifan → POST with owner', async () => {
    const { transport, calls } = fakeTransport(() => ({ ok: true, main: { animations: { baifan: ['a'] } } }));
    const { show } = fakeShow();
    const menu = makeMenu(() => undefined, transport, show);

    await menu.ensureMenu();

    const post = calls.find((rec) => rec.method === 'POST');
    assert.ok(post !== undefined, 'Equipped with gameplay, POST / menu/item should be issued');
    assert.equal(post.path, '/menu/item');
    assert.deepEqual(
      (post.body as Record<string, unknown>).owner,
      'dsh-pet-baifan',
      'Menu item owner is fixed for eating rice',
    );
  });

  test('playback request: The clicked pet does not belong to any entry → the show will not start', async () => {
    const { transport } = fakeTransport(() => ({ main: { pets: [{ id: 'other' }], animations: { baifan: ['a'] } } }));
    const { show, starts } = fakeShow();
    const menu = makeMenu(() => ({ menuEvents: () => ({ ok: true, events: { 吃白饭: 'pet-1' } }) }), transport, show);

    menu.tick();
    await flush();

    assert.equal(starts.length, 0, 'The performance will not be performed if the attribution entry cannot be found.');
  });

  test('After dispose: No more reading clicks', async () => {
    const { transport, calls } = fakeTransport(() => ({ ok: true }));
    const { show } = fakeShow();
    const menu = makeMenu(() => ({ menuEvents: () => ({ ok: true, events: { 吃白饭: 'pet-1' } }) }), transport, show);

    menu.dispose();
    menu.tick();
    await flush();

    assert.equal(calls.length, 0, 'No more requests should be sent after unmounting');
  });
});
