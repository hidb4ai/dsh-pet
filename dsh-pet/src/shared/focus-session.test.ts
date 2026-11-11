/**
 * The parsing boundary of the jump session signal: the judgment water level and the replay window.
 *
 * These two errors are very subtle - repeated jumps will cause the page to switch back and forth between sessions, and
 * if the window is too large, the page will be forcibly dragged away when it is opened. Running method: node --
 * experimental-strip-types --test src/shared/focus-session.test.ts
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { FOCUS_REPLAY_WINDOW_MS, readFocusSession } from './focus-session.ts';

describe('readFocusSession——Should it jump?', () => {
  test('New signal → give session and time', () => {
    assert.deepEqual(readFocusSession({ sessionId: 's1', ts: 1000 }, 1000, 0), { sessionId: 's1', ts: 1000 });
  });

  test('Same as or older than the water level → null (the increment after the first pull jump will no longer jump once)', () => {
    assert.equal(readFocusSession({ sessionId: 's1', ts: 1000 }, 1000, 1000), null);
    assert.equal(readFocusSession({ sessionId: 's1', ts: 999 }, 1000, 1000), null);
  });

  test('Exceeded replay window → null (when opening the page, it should not be dragged away by a click long ago)', () => {
    const stale = FOCUS_REPLAY_WINDOW_MS + 1;
    assert.equal(readFocusSession({ sessionId: 's1', ts: 1000 }, 1000 + stale, 0), null);
    assert.deepEqual(readFocusSession({ sessionId: 's1', ts: 1000 }, 1000 + FOCUS_REPLAY_WINDOW_MS, 0), {
      sessionId: 's1',
      ts: 1000,
    });
  });

  test('Invalid shape → null (empty id / non-character string / missing ts / non-finite number / non-object)', () => {
    for (const raw of [
      null,
      undefined,
      'x',
      {},
      { sessionId: '' },
      { sessionId: 42 },
      { sessionId: 's1' },
      { sessionId: 's1', ts: '1000' },
      { sessionId: 's1', ts: Number.NaN },
      { sessionId: 's1', ts: Number.POSITIVE_INFINITY },
    ]) {
      assert.equal(readFocusSession(raw, 1000, 0), null);
    }
  });
});
