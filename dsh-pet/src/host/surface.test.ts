/**
 * Decision-making layer single test of `?surface=` (caller expects renderer) - issue #122 Article 1.
 *
 * Three core articles of the contract:
 * 1. Only four literals are recognized, the rest (default/case incompatibility/blank/non-character string) are all
 * `null` ;
 * 2. `display: none` is not satisfied unconditionally, and `any` is not satisfied either;
 * 3. `both` is only satisfied by `both` (it is stricter than "no transmission/any" and is not a synonym of "either end
 * is OK").
 *
 * This module only relies on two character strings and can be completely tested offline. Use Node to build test runner
 * without introducing any npm dependencies.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  SURFACES,
  SURFACE_TEXT,
  displayCovers,
  isDisplayed,
  normalizeSurface,
  pickVoiceSurface,
  voiceTargetOfSurface,
} from './surface.ts';

describe('normalizeSurface——The value is narrowed', () => {
  test('Four literals passed unchanged', () => {
    for (const s of SURFACES) assert.equal(normalizeSurface(s), s);
  });

  test('Default/non-character string/empty string/incompatible case/blank/other enumeration value → null', () => {
    for (const bad of [undefined, null, '', '   ', 'WEB', 'Web', 'Desktop', 'none', 'all', 42, true, {}, []]) {
      assert.equal(normalizeSurface(bad), null, JSON.stringify(bad) + ' 不应通过');
    }
  });
});

describe('displayCovers —— 4×4 matching matrix', () => {
  /** Expected table: display (rows) × want (columns) */
  const TABLE: Record<string, Record<string, boolean>> = {
    web: { web: true, desktop: false, both: false, any: true },
    desktop: { web: false, desktop: true, both: false, any: true },
    both: { web: true, desktop: true, both: true, any: true },
    none: { web: false, desktop: false, both: false, any: true },
  };

  test('All four rows are correct: both is only satisfied by both; any does not select the display mode (none is also allowed)', () => {
    for (const [display, row] of Object.entries(TABLE)) {
      for (const want of SURFACES) {
        assert.equal(displayCovers(want, display), row[want], `display=${display} want=${want}`);
      }
    }
  });

  test('display is invalid (the configuration verification should block it) and will not be satisfied and will not be thrown.', () => {
    for (const bad of ['', 'nope', 'WEB', 'Both', 'undefined', ' web']) {
      for (const want of SURFACES) assert.equal(displayCovers(want, bad), false, `display=${bad} want=${want}`);
    }
  });
});

describe('isDisplayed——If either end is visible, it will be displayed.', () => {
  test('web / desktop / both are visible, none and invalid values are not visible', () => {
    for (const display of ['web', 'desktop', 'both']) {
      assert.equal(isDisplayed(display), true, `display = ${display} should be visible on one end`);
    }
    for (const display of ['none', '', 'nope', 'Both']) {
      assert.equal(isDisplayed(display), false, `display = ${display} should not be considered visible`);
    }
  });
});

describe('pickVoiceSurface——Which side should you pronounce this sentence?', () => {
  test('Desktop priority: both → desktop, desktop → desktop', () => {
    assert.equal(pickVoiceSurface('both'), 'desktop', 'When both ends are displayed, hand it to the desktop.');
    assert.equal(pickVoiceSurface('desktop'), 'desktop');
  });

  test('Only displayed on the web page → web', () => {
    assert.equal(pickVoiceSurface('web'), 'web');
  });

  test('Neither end is displayed / invalid value → null (no one should read it)', () => {
    for (const display of ['none', '', 'nope']) {
      assert.equal(pickVoiceSurface(display), null, `display = ${display} should not pick one end`);
    }
  });
});

describe('voiceTargetOfSurface——Which side should I read when requesting completion?', () => {
  test('The specific end is left intact.', () => {
    assert.equal(voiceTargetOfSurface('web'), 'web');
    assert.equal(voiceTargetOfSurface('desktop'), 'desktop');
  });

  test('both / any is not enough to specify one end → undefined (return to display derivation)', () => {
    assert.equal(voiceTargetOfSurface('both'), undefined);
    assert.equal(voiceTargetOfSurface('any'), undefined);
  });
});

describe('SURFACE_TEXT - shares the same sentence with the document', () => {
  test('All four values appear in the copy (if the value set is changed, it will be red)', () => {
    for (const s of SURFACES) assert.ok(SURFACE_TEXT.includes(s), '文案缺 ' + s);
  });
});
