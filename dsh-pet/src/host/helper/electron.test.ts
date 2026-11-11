/**
 * Contract tests for helperLaunchArgs and shouldForceXWayland in src/host/helper/electron.ts.
 * Place switches before the script path; force X11 on Wayland only when XWayland (DISPLAY) is available.
 * Do not assert DESKTOP_DEBUG_PORT's value: it is a developer-controlled troubleshooting switch.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { DESKTOP_DEBUG_PORT, helperLaunchArgs, shouldForceXWayland } from './electron.ts';

describe('helperLaunchArgs - Desktop Helper startup parameters', () => {
  test('Port 0: only script path, no debugging switch', () => {
    assert.deepEqual(helperLaunchArgs('/x/main.js', { debugPort: 0 }), ['/x/main.js']);
  });

  test('Given port: debug switch precedes script path', () => {
    assert.deepEqual(helperLaunchArgs('/x/main.js', { debugPort: 9222 }), [
      '--remote-debugging-port=9222',
      '/x/main.js',
    ]);
  });

  test('Force XWayland: ozone switch also comes before script path', () => {
    assert.deepEqual(helperLaunchArgs('/x/main.js', { debugPort: 0, forceX11: true }), [
      '--ozone-platform=x11',
      '/x/main.js',
    ]);
  });

  test('XWayland and debug switch exist at the same time: ozone first and then the debug port, the script is still at the end', () => {
    assert.deepEqual(helperLaunchArgs('/x/main.js', { debugPort: 9222, forceX11: true }), [
      '--ozone-platform=x11',
      '--remote-debugging-port=9222',
      '/x/main.js',
    ]);
  });

  test('The default parameter follows DESKTOP_DEBUG_PORT: 0 off, non-0 on', () => {
    const expected =
      DESKTOP_DEBUG_PORT > 0 ? ['--remote-debugging-port=' + DESKTOP_DEBUG_PORT, '/x/main.js'] : ['/x/main.js'];
    assert.deepEqual(helperLaunchArgs('/x/main.js'), expected);
  });
});

describe('shouldForceXWayland ——Wayland session is forced to X11', () => {
  test('linux + Wayland + XWayland: Mandatory', () => {
    assert.equal(shouldForceXWayland({ WAYLAND_DISPLAY: 'wayland-0', DISPLAY: ':0' }, 'linux'), true);
  });

  test('Pure Wayland (without DISPLAY): not mandatory', () => {
    assert.equal(shouldForceXWayland({ WAYLAND_DISPLAY: 'wayland-0' }, 'linux'), false);
  });

  test('X11 session (no WAYLAND_DISPLAY): not mandatory', () => {
    assert.equal(shouldForceXWayland({ DISPLAY: ':0' }, 'linux'), false);
  });

  test('Non-linux platform: not mandatory', () => {
    assert.equal(shouldForceXWayland({ WAYLAND_DISPLAY: 'wayland-0', DISPLAY: ':0' }, 'win32'), false);
    assert.equal(shouldForceXWayland({ WAYLAND_DISPLAY: 'wayland-0', DISPLAY: ':0' }, 'darwin'), false);
  });
});
