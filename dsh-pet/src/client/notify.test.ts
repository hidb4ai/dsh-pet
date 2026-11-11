/**
 * Unit test of session name injection (`sessionTitleFrom`): whether the notification title can recognize "which
 * session is back" depends on it. In the four unavailable situations, it must be returned to undefined and handed over
 * to the shared side fallback fixed copy; errors must be collected here, otherwise a failed name will bring down the
 * pop-up window itself.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { sessionTitleFrom, type SessionNavigator } from './notify.ts';

/** Only a substitute for naming ability is implemented; jump does not participate in this test. */
const namedBy = (title: string): SessionNavigator => ({ openSession: () => {}, sessionTitle: () => title });

describe('sessionTitleFrom', () => {
  test('Service returns unchanged when given a name', () => {
    assert.equal(sessionTitleFrom(namedBy('修复通知标题'), 's1'), '修复通知标题');
  });

  test('When the frame does not carry sessionId, it returns undefined. Do not use empty id to check.', () => {
    assert.equal(sessionTitleFrom(namedBy('任何名字'), undefined), undefined);
  });

  test('Returns undefined when there is no injector (old host)', () => {
    assert.equal(sessionTitleFrom(undefined, 's1'), undefined);
  });

  test('undefined is returned when the service does not have naming capabilities', () => {
    assert.equal(sessionTitleFrom({ openSession: () => {} }, 's1'), undefined);
  });

  test('Stop when the service is thrown incorrectly, and the pop-up window will not be affected.', () => {
    const navigator: SessionNavigator = {
      openSession: () => {},
      sessionTitle: () => {
        throw new Error('会话列表还没加载');
      },
    };
    assert.equal(sessionTitleFrom(navigator, 's1'), undefined);
  });
});
