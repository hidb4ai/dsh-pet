/**
 * Standalone mode pseudo-ctx "shutdown capability" test (issue #178: system tray exit).
 *
 * Pure function layer: `createStandaloneContext({ shutdown })` must link the capability to ctx as `shutdownApp` , and
 * only when it is passed in - DSH host uses real ctx. The absence of this field is the basis for "system tray does not
 * display exit" (host route / quit presses `typeof ctx.shutdownApp === 'function'` to judge canQuit).
 *
 * The shutdown itself still uses the existing `/shutdown` cleanup of cli.ts. We will not repeat the test of that path
 * here.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { createStandaloneContext } from './context.ts';
import type { StandaloneLogger } from './context.ts';

const silentLogger: StandaloneLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

describe('standalone pseudo ctx’s shutdown capability (system tray exit)', () => {
  test('Incoming shutdown → ctx.shutdownApp can be called, and reason is transparently transmitted as it is.', () => {
    const reasons: string[] = [];
    const sc = createStandaloneContext({
      port: 0,
      logger: silentLogger,
      shutdown: (reason) => reasons.push(reason),
    });
    const shutdownApp = (sc.ctx as { shutdownApp?: (reason: string) => void }).shutdownApp;
    assert.equal(typeof shutdownApp, 'function', 'When passing in shutdown, you must hang out shutdownApp');
    shutdownApp?.('托盘退出');
    assert.deepEqual(reasons, ['托盘退出']);
  });

  test('Don’t pass shutdown → Don’t hang this field (DSH side has the same behavior as the old caller)', () => {
    const sc = createStandaloneContext({ port: 0, logger: silentLogger });
    assert.equal(
      'shutdownApp' in sc.ctx,
      false,
      'You cannot create one out of thin air when there is no shutdown capability.',
    );
  });
});
