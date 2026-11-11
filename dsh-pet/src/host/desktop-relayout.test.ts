/**
 * Desktop screen switching returns: The event sequence of "dual screen → temporary 3840 wide main screen → narrowed to
 * 1920" during remote connection is reproduced.
 *
 * Why load the real script instead of extracting the pure function: The problem lies in the linkage between `relayout`
 * and `position()` and `anchorPixel` - the clamping result is written as a custom position, and the pure function
 * cannot detect this layer of wiring. Here node:vm is used to create a clean global picture and drive the real
 * `sprite.js` . The assertion is the behavior (position and customPos), not the source code text.
 */
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';

import { rebaseCenter } from '../shared/displays.ts';
import { anchorPixel } from '../shared/motion.ts';

/** Workspace height: 1080 minus 48 px taskbar. */
const AREA_HEIGHT = 1032;
/** Pet width (same order as the configuration of this issue). */
const PET_SIZE = 320;
/** The body height is calculated as 16:9, which is consistent with the conventions of {@link anchorPixel}. */
const PET_HEIGHT = (PET_SIZE * 9) / 16;

/** Viewport: Shape of VIEW in classic script. */
interface ViewRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Workspace: Shape of AREAS / PRIMARY_AREA elements in classic script. */
interface Area {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The part of the instance state that will be used by the script under test. */
interface Sprite {
  pos: { x: number; y: number };
  customPos: { rx: number; ry: number } | null;
  position(): void;
  relayout(prevView: ViewRect): void;
}

const script = readFileSync(new URL('../../runtime/electron-helper/sprite.js', import.meta.url), 'utf8');

/**
 * Create a pet installed in vm and use the widened home screen to simulate remote desktop access/disconnection.
 *
 * @param manual - Whether there is already a custom position (the user dragged or dropped it).
 * @returns pet instance, current viewport, and action to change the home screen to a single `width` wide workspace.
 */
function loadSprite(manual: boolean): {
  sprite: Sprite;
  view: ViewRect;
  setPrimary(width: number): void;
} {
  const view: ViewRect = { x: 0, y: 0, w: 3840, h: AREA_HEIGHT };
  const left: Area = { x: 0, y: 0, width: 1920, height: AREA_HEIGHT };
  const context: Record<string, unknown> = {
    navigator: { platform: 'Win32', userAgent: 'test' },
    BASE: '',
    VIEW: view,
    AREAS: [left, { ...left, x: left.width }],
    PRIMARY_AREA: left,
    S: { rebaseCenter, anchorPixel },
  };
  const proto = runInNewContext(script + '\nPetSprite.prototype', context) as object;
  const sprite = Object.create(proto) as Sprite;
  // Only complement position()/ relayout() The actual read status: The method in vm can be accessed at any time according to the attributes, and it can be run after completing it.
  Object.assign(sprite as unknown as Record<string, unknown>, {
    size: PET_SIZE,
    halfW: PET_SIZE / 2,
    halfH: PET_HEIGHT / 2,
    pet: { position: { corner: 'bottom-right', marginX: 0, marginY: 60 } },
    customPos: manual ? { rx: 3000 / view.w, ry: 600 / AREA_HEIGHT } : null,
    dragState: { active: false },
    throwRef: null,
    pos: { x: 0, y: 0 },
    stopMove: (): void => undefined,
    sendBounds: (x: number, y: number): void => {
      sprite.pos = { x, y };
    },
  });
  sprite.position();
  const setPrimary = (width: number): void => {
    const area: Area = { x: 0, y: 0, width, height: AREA_HEIGHT };
    context.AREAS = [area];
    context.PRIMARY_AREA = area;
    view.w = width;
  };
  return { sprite, view, setPrimary };
}

test('Screen switching: Corner mode is recalculated according to the corners and margins of the new home screen, and no custom position is written.', () => {
  const { sprite, view, setPrimary } = loadSprite(false);
  assert.deepEqual(
    sprite.pos,
    { x: 1920 - PET_SIZE, y: AREA_HEIGHT - PET_HEIGHT - 60 },
    'Starting point: in the lower right corner of the main screen when dual-screen is used, margin 0/60',
  );

  const before = { ...view };
  setPrimary(3840); // Remote access: Two screens are synthesized into a 3840 wide temporary main screen
  sprite.relayout(before);
  assert.deepEqual(
    sprite.pos,
    { x: 3840 - PET_SIZE, y: AREA_HEIGHT - PET_HEIGHT - 60 },
    'Temporary home screen: follow to its lower right corner',
  );

  const wide = { ...view };
  setPrimary(1920); // Narrow back to single screen after about 4 seconds
  sprite.relayout(wide);
  assert.deepEqual(
    sprite.pos,
    { x: 1920 - PET_SIZE, y: AREA_HEIGHT - PET_HEIGHT - 60 },
    'After narrowing, it must return to the configured corners and margins instead of stopping at the right edge.',
  );
  assert.equal(sprite.customPos, null, 'Clamping results cannot be recorded as custom positions');
});

test('Cut the screen: The customized position retains the desktop coordinates, and is only clipped back to the visible area when it crosses the boundary.', () => {
  const { sprite, view, setPrimary } = loadSprite(true);
  assert.deepEqual(
    sprite.pos,
    { x: 3000 - PET_SIZE / 2, y: 600 - PET_HEIGHT / 2 },
    'Starting point: center at (3000, 600)',
  );

  const before = { ...view };
  setPrimary(3840);
  sprite.relayout(before);
  assert.deepEqual(
    sprite.pos,
    { x: 3000 - PET_SIZE / 2, y: 600 - PET_HEIGHT / 2 },
    'Temporary home screen: world coordinates remain unchanged',
  );

  const wide = { ...view };
  setPrimary(1920);
  sprite.relayout(wide);
  assert.deepEqual(
    sprite.pos,
    { x: 1919 - PET_SIZE / 2, y: 600 - PET_HEIGHT / 2 },
    'Clip back to the right edge after exceeding the new home screen',
  );
  assert.notEqual(sprite.customPos, null, 'Custom location continues to be valid within the session');
});
