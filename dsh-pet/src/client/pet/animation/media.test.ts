/**
 * Contract test for asset format detection (src/client/pet/animation/media.ts).
 *
 * Three contracts:
 * 1. Chromium series (including Electron) and Firefox must support webm - they natively support VP9-alpha;
 * 2. Only WebKit of macOS requires mov (HEVC-alpha): Safari can decode VP9 but will lose alpha and appear as a black
 * background;
 * 3. The extension is cached once per session: after the first frame is set, it will no longer change with UA.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { prefersMov, thumbExt } from './media.ts';
import { ANIMATION_EXT } from '../../../shared/constants.ts';

/** Install a fake navigator and return the restoration function. */
function withNavigator(userAgent: string, platform: string): () => void {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', {
    value: { userAgent, platform },
    configurable: true,
  });
  return () => {
    if (previous === undefined) delete (globalThis as { navigator?: unknown }).navigator;
    else Object.defineProperty(globalThis, 'navigator', previous);
  };
}

describe('prefersMov —— Is HEVC-alpha required?', () => {
  test('Safari on macOS wants mov', () => {
    const restore = withNavigator('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15', 'MacIntel');
    try {
      assert.equal(prefersMov(), true);
    } finally {
      restore();
    }
  });

  test('Chrome / Electron do not want mov on macOS (native VP9-alpha)', () => {
    const restore = withNavigator(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0 Safari/537.36',
      'MacIntel',
    );
    try {
      assert.equal(prefersMov(), false);
    } finally {
      restore();
    }
  });

  test('Firefox and Edge go the same way webm', () => {
    for (const ua of ['Mozilla/5.0 Firefox/121.0', 'Mozilla/5.0 Chrome/120 Edg/120.0']) {
      const restore = withNavigator(ua, 'Win32');
      try {
        assert.equal(prefersMov(), false, ua);
      } finally {
        restore();
      }
    }
  });

  test('WebKit of non-Mac platform (unknown UA other than iOS) does not need mov', () => {
    const restore = withNavigator('Mozilla/5.0 AppleWebKit/605.1.15', 'Win32');
    try {
      assert.equal(prefersMov(), false);
    } finally {
      restore();
    }
  });
});

describe('thumbExt - fixed extension within session', () => {
  test('The same result will be used after the first judgment, and will not change with UA', () => {
    const restore = withNavigator(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0 Safari/537.36',
      'MacIntel',
    );
    try {
      const first = thumbExt();
      // The static type of ANIMATION_EXT is narrowed to '. webm ', the user may still change it to . mov: press string to read and then compare.
      const explicit: string = ANIMATION_EXT;
      const expected = explicit === '.mov' ? '.mov' : '.webm';
      assert.equal(first, expected, 'Explicit constants take precedence, otherwise judged by renderer');
      // Change the environment to "require mov", the cache should not be changed when the cache hits.
      const restore2 = withNavigator('Mozilla/5.0 AppleWebKit/605.1.15', 'MacIntel');
      try {
        assert.equal(thumbExt(), first, 'Extensions are cached once per session');
      } finally {
        restore2();
      }
    } finally {
      restore();
    }
  });
});
