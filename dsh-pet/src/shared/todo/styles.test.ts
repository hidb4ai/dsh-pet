/**
 * Size budget of the to-do panel (src/shared/todo/styles.ts): The panel scales with the font size, and the upper
 * margin of the window can fit the entire panel.
 *
 * Only the pure calculation and constant parts are covered; the actual look and feel of CSS is manually accepted.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { BUBBLE_OVERLAP_RATIO, DEFAULT_FONT, bubbleTopMarginPx, resolveFontPx } from '../fonts.ts';
import { TODO_CSS, TODO_FONT_SCALE, TODO_PANEL_METRICS, todoPanelTopMarginPx } from './styles.ts';
import type { FontConfig } from '../types.ts';

/** The height of the panel itself (px): Take the higher of single state and calendar state, and have the same budget as todoPanelTopMarginPx. */
function panelHeightPx(font: FontConfig | undefined, size: number): number {
  const m = TODO_PANEL_METRICS;
  const lower = Math.max(m.list + m.hint, m.calendar);
  return (m.head + m.form + lower) * resolveFontPx(font, size).bubble * TODO_FONT_SCALE;
}

describe('todoPanelTopMarginPx ——top margin of desktop window', () => {
  test('Default configuration: The panel budget is higher than that of pure bubble, and the window must be raised according to the panel.', () => {
    const px = todoPanelTopMarginPx(DEFAULT_FONT, 462);
    assert.ok(
      px > bubbleTopMarginPx(DEFAULT_FONT, 462),
      'The panel is higher than the bubble, the window should be raised according to the panel',
    );
    assert.ok(px < 400, `Text size must stay within the expected range; got ${px}px`);
  });

  test('Increase the font size: the top margin increases proportionally with the panel', () => {
    const base = todoPanelTopMarginPx(DEFAULT_FONT, 462);
    const big = todoPanelTopMarginPx({ ...DEFAULT_FONT, size: 42 }, 462);
    assert.ok(
      big > base * 1.5,
      `After doubling the font size, the top margin should be significantly larger, resulting in ${big} px`,
    );
  });

  test('The pet is reduced and the font size does not follow: the panel budget exceeds the bubble budget, the window must be raised according to the panel', () => {
    const font = { ...DEFAULT_FONT, followPet: false };
    const panel = todoPanelTopMarginPx(font, 200);
    assert.ok(panel > bubbleTopMarginPx(font, 200), `The panel is higher, the actual value is ${panel} px`);
    assert.ok(
      panel >= panelHeightPx(font, 200) - 200 * BUBBLE_OVERLAP_RATIO,
      'The top margin should cover the panel minus the protruding portion of the bottom edge',
    );
  });

  test('font is missing: converted according to default conventions, NaN or negative numbers are not output', () => {
    const px = todoPanelTopMarginPx(undefined, 462);
    assert.ok(Number.isFinite(px) && px > 0, `Actual: ${px}`);
  });
});

describe('TODO_CSS —— size anchor font size', () => {
  test('Font size and width are derived from --f, no more hard-coding pixels', () => {
    assert.ok(TODO_CSS.includes('var(--f)'), 'Panel size should be anchored -- f');
    assert.ok(!TODO_CSS.includes('font-size:13px'), 'The font size 13 px should no longer be hardcoded');
    assert.ok(!TODO_CSS.includes('width:308px'), '308 px width should no longer be hardcoded');
  });
});
