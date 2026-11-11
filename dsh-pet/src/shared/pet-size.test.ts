/**
 * Unit test for percentage size parsing: verify "size is the upper limit, percentage only centralize" and the boundary
 * of the default fallback.
 *
 * Running method: node --experimental-strip-types --test src/shared/pet-size.test.ts
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { isValidSizePercent, resolvePetSizePx, SIZE_PERCENT_MIN } from './pet-size.ts';

describe('isValidSizePercent - a finite number not less than 1 (no upper limit)', () => {
  test('Valid: Contains a value greater than 100', () => {
    for (const value of [SIZE_PERCENT_MIN, 40, 99.5, 100, 150, 400]) {
      assert.equal(isValidSizePercent(value), true, `${value} should be legal`);
    }
  });

  test('Non-numbers and values less than the lower limit are invalid.', () => {
    for (const value of [0, 0.5, -1, Number.NaN, Number.POSITIVE_INFINITY, '40', null, undefined, true, { a: 1 }]) {
      assert.equal(isValidSizePercent(value), false, `${String(value)} should be illegal`);
    }
  });
});

describe('resolvePetSizePx ——The percentage is converted into frame width based on the character body.', () => {
  test('No percentage configured → According to the default 20: the wide window is equal to px, and the narrow window is sandwiched by the screen width', () => {
    assert.equal(resolvePetSizePx(400, undefined, 1920), 400);
    assert.equal(resolvePetSizePx(400, undefined, 375), 200);
  });

  test('Narrow screen: 20% character → frame 200 px (body 75 px = screen width 20%)', () => {
    assert.equal(resolvePetSizePx(462, 20, 375), 200);
  });

  test('Widescreen: The frame calculated by percentage exceeds size → still take px (the desktop look and feel remains unchanged)', () => {
    assert.equal(resolvePetSizePx(400, 40, 1920), 400);
  });

  test('Take this value when it happens to be stuck on size', () => {
    // 375 × 40% = 150 body → frame 400, exactly equal to size
    assert.equal(resolvePetSizePx(400, 40, 375), 400);
  });

  test('The viewport cannot be reached (0 / negative number / non-number) → fallback to px', () => {
    for (const width of [0, -100, Number.NaN]) {
      assert.equal(resolvePetSizePx(400, 40, width), 400, `${width} should fallback`);
    }
  });

  test('Invalid percentage → fallback to px (dirty values are configured not to be rendered)', () => {
    for (const value of [0, 101, Number.NaN]) {
      assert.equal(resolvePetSizePx(400, value, 375), 400, `${value} should fallback`);
    }
  });

  test('Tablet vertical screen: 15% figure → frame 307.2 (body 115.2 = 15% of 768)', () => {
    assert.equal(resolvePetSizePx(462, 15, 768), 307.2);
  });
});
