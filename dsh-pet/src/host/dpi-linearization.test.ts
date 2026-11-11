/**
 * Determination test of desktop helper "global DPI linearization" - fix for macOS desktop pet that is doubled in size.
 *
 * Background: DIP ↔Physical pixel conversion of Chromium on Windows is a monitor-by-monitor affine transformation.
 * When the window crosses the seam, the two coordinate systems jump horizontally (drag across the screen seam to
 * "flicker"). The correction method is to collapse the coordinate system into an identity mapping before starting
 * `--force-device-scale-factor=1` , and then press the detected real home screen scaleFactor to enlarge the pet back
 * to its original look and feel. However, the premise of compensation "this switch will convert DIP into physical
 * pixels" is only true for Windows: DIP of macOS is always equal to "points", and the compensation becomes pure
 * amplification - size =462 under Retina (2 x) is rendered into a 924-point width window. 1848×1487 pixels, while the
 * same configuration in the browser overlay is 462 CSS pixels.
 *
 * This document nails three things: ① Pure judgment rules: darwin will never be enabled; win32/linux will maintain the
 * original behavior; detect child processes and
 * DSH_PET_FORCE_DSF ='0' respective short-circuit; two-step conversion of forced value and renderer scaling; ②
 * End-to-end invariant: macOS's pet size must be equal to the configuration value, while Windows 150% screen is still
 * compensated by 1.5; ③ Source code guard: platform exception only lives in dpi-linearization.js, main.js is only
 * wired, and the new module has been included in the release required list (helper will crash at startup if it is
 * omitted).
 *
 * Use Node to build test runner (node:test) without introducing any npm dependencies.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const helper = '../../runtime/electron-helper/';
const { shouldLinearize, resolveForcedScale, resolvePetScale } = require(helper + 'dpi-linearization.js');

/** Source code of files in the package (for guarding; relative to src/host / parsing) */
const readSource = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('shouldLinearize - Platform exception (fix for this PR)', () => {
  test('darwin will never be enabled: DIP is already a "point", forcing DSF without changing the coordinate system, and there is nothing to compensate for', () => {
    // Actual measured value of real machine: 1920×1080 screen, backingScaleFactor =2 → The detected main screen scaleFactor is 2
    assert.equal(shouldLinearize({ platform: 'darwin', dpiProbe: false }), false);
    assert.equal(shouldLinearize({ platform: 'darwin', dpiProbe: false, forceDsf: '1' }), false);
    assert.equal(shouldLinearize({ platform: 'darwin', dpiProbe: false, forceDsf: '2' }), false);
  });

  test('win32 / linux maintain the original behavior (this fix does not affect any non-macOS platforms)', () => {
    assert.equal(shouldLinearize({ platform: 'win32', dpiProbe: false }), true);
    assert.equal(shouldLinearize({ platform: 'linux', dpiProbe: false }), true);
    assert.equal(shouldLinearize({ platform: 'win32', dpiProbe: false, forceDsf: '1' }), true);
  });

  test('DSH_PET_FORCE_DSF =0 turns off the entire mechanism (recognized by any platform)', () => {
    assert.equal(shouldLinearize({ platform: 'win32', dpiProbe: false, forceDsf: '0' }), false);
    assert.equal(shouldLinearize({ platform: 'linux', dpiProbe: false, forceDsf: 0 }), false);
  });

  test('The detection sub-process does not do it by itself (it will create another spawn detection sub-process, infinite recursion)', () => {
    assert.equal(shouldLinearize({ platform: 'win32', dpiProbe: true }), false);
    assert.equal(shouldLinearize({ platform: 'linux', dpiProbe: true, forceDsf: '2' }), false);
  });
});

describe('resolveForcedScale - what number to force (0 = not enabled)', () => {
  test('Real main screen zoom detected → Locked 1 (identical mapping, no conversion of cross-screen geometry)', () => {
    assert.equal(resolveForcedScale({ primaryScale: 2 }), 1);
    assert.equal(resolveForcedScale({ primaryScale: 1.5 }), 1);
  });

  test('Detection failed → 0: Would rather return to the screen-by-screen DIP behavior before the repair than do uncompensated zooming', () => {
    assert.equal(resolveForcedScale({ primaryScale: 0 }), 0);
    assert.equal(resolveForcedScale({}), 0);
  });

  test('Prioritize positive number coverage (for troubleshooting, it will step on the main.js bug mentioned in the comment)', () => {
    assert.equal(resolveForcedScale({ forceDsf: '2', primaryScale: 2 }), 2);
    assert.equal(resolveForcedScale({ forceDsf: 1.75, primaryScale: 0 }), 1.75);
  });

  test('Invalid coverage value (0 / negative number / non-number) does not take effect, fallback normal path', () => {
    assert.equal(resolveForcedScale({ forceDsf: '0', primaryScale: 2 }), 1);
    assert.equal(resolveForcedScale({ forceDsf: '-1', primaryScale: 2 }), 1);
    assert.equal(resolveForcedScale({ forceDsf: 'abc', primaryScale: 2 }), 1);
    assert.equal(resolveForcedScale({ forceDsf: 'abc', primaryScale: 0 }), 0);
  });
});

describe('resolvePetScale —— renderer CONFIG.scale', () => {
  test('Not enabled (forcedScale =0) → equal to the baseline given by host, no compensation', () => {
    assert.equal(resolvePetScale({ baseScale: '1', primaryScale: 2, forcedScale: 0 }), 1);
  });

  test('Main screen detection failed (primaryScale =0) → no compensation (the denominator is 0 is the source of NaN)', () => {
    assert.equal(resolvePetScale({ baseScale: '1', primaryScale: 0, forcedScale: 1 }), 1);
    assert.equal(resolvePetScale({ baseScale: '1', primaryScale: 0, forcedScale: 0 }), 1);
  });

  test('After enabling, press primary/forced to zoom back to the original look and feel (150% screen → ×1.5)', () => {
    assert.equal(resolvePetScale({ baseScale: '1', primaryScale: 1.5, forcedScale: 1 }), 1.5);
    assert.equal(resolvePetScale({ baseScale: '2', primaryScale: 1.5, forcedScale: 1 }), 3);
  });

  test('base default/invalid → fallback 1', () => {
    assert.equal(resolvePetScale({}), 1);
    assert.equal(resolvePetScale({ baseScale: '', primaryScale: 2, forcedScale: 0 }), 1);
    assert.equal(resolvePetScale({ baseScale: 'oops', primaryScale: 2, forcedScale: 0 }), 1);
  });
});

/** Run the entire link in the same sequence as the main.js wiring: enable judgment → force value → renderer scaling */
function petScaleOf(platform: string, primaryScale: number, forceDsf?: string): number {
  const enabled = shouldLinearize({ platform, dpiProbe: false, forceDsf });
  const primary = enabled ? primaryScale : 0;
  const forced = enabled ? resolveForcedScale({ forceDsf, primaryScale: primary }) : 0;
  return resolvePetScale({ baseScale: '1', primaryScale: primary, forcedScale: forced });
}

describe('End-to-end invariants – what the user actually sees', () => {
  const SIZE = 462; // Pet width of built-in default configuration (assets/config.jsonc)

  test('macOS ( Retina 2 x ): pet size must be equal to configured value - before fix this measured to 924 points', () => {
    assert.equal(SIZE * petScaleOf('darwin', 2), 462);
  });

  test('macOS: Detection failed / No cache will be affected (will never compensate if not enabled)', () => {
    assert.equal(SIZE * petScaleOf('darwin', 0), 462);
  });

  test('Windows 150% screen: Still compensated by 1.5 (the main screen looks and feels the same pixel by pixel as before repair)', () => {
    assert.equal(SIZE * petScaleOf('win32', 1.5), 693);
  });

  test('Windows 100% screen: detected 1 → forced 1 → compensation degraded to ×1 (no change)', () => {
    assert.equal(SIZE * petScaleOf('win32', 1), 462);
  });
});

describe('Source code guard - main-dpi.js is only wired, the rules live in dpi-linearization.js', () => {
  /** main process source code: main.js is the assembly root, and the behaviors are scattered in modules under main /. The guard must read the entire copy. */
  const mainSource = (dir: string): string =>
    [
      readSource(dir + 'main.js'),
      ...readdirSync(fileURLToPath(new URL(dir + 'main/', import.meta.url)))
        .filter((name) => name.endsWith('.js'))
        .map((name) => readSource(dir + 'main/' + name)),
    ].join('\n');
  const main = mainSource(helper);
  // DPI / The pointer has been removed to main-dpi.js: refer to the wiring rules, and the assembly still refers to main.js
  const dpi = readSource(helper + 'main/dpi.js');

  test('main-dpi.js requires require new module', () => {
    assert.ok(/require\('\.\.\/dpi-linearization\.js'\)/.test(dpi), 'Required require dpi-linearization.js');
  });

  test('All three rules are taken from the module and cannot be inlined.', () => {
    assert.ok(/shouldLinearize\(/.test(dpi), 'shouldLinearize must be used to enable the judgment');
    assert.ok(/resolveForcedScale\(/.test(dpi), 'The forced value must be resolveForcedScale');
    assert.ok(/resolvePetScale\(/.test(dpi), 'renderer scaling must be resolvePetScale');
    assert.ok(
      !/PRIMARY_SCALE \/ FORCED_SCALE/.test(dpi),
      'Compensation formula is no longer allowed to be inlined in main.js',
    );
  });

  test('switch of DSF must be within the judgment of shouldLinearize (otherwise macOS will be amplified again)', () => {
    const guardAt = dpi.indexOf('shouldLinearize(');
    const switchAt = dpi.indexOf("appendSwitch('force-device-scale-factor'");
    assert.ok(guardAt >= 0 && switchAt >= 0, 'Both places must be in place');
    assert.ok(switchAt > guardAt, 'switch must be ranked after the judgment (within the same branch)');
  });

  test('renderer side page scaling is still taken from petScale() (both ends share the same source)', () => {
    assert.ok(/setZoomFactor\(scale\)/.test(main), 'Window scaling must come from petScale ()');
    assert.ok(
      /const scale = dpi\.petScale\(\)/.test(main),
      'petScale () must be evaluated once before building the window',
    );
  });
});

describe('Guard: dpi-linearization.js must be in the release required list', () => {
  test('required of prepack-check.js contains it (main.js require, if it is missing, it will crash at startup)', () => {
    const src = readSource('../../scripts/prepack-check.js');
    assert.ok(
      /'runtime\/electron-helper\/dpi-linearization\.js'/.test(src),
      'If it is missing, the npm package is missing a necessary module for main.js',
    );
  });
});
