/**
 * Desktop helper "click-through fallback channel" judgment test (adopting the patch from the reporter of issue #55).
 *
 * Background: The window defaults to click-through for the entire window, and only relies on the forward low-level
 * mouse hook of Electron to forward mousemove to the renderer for hit determination - the entire link has only one
 * entry point. This hook will fail silently on Windows (the callback timeout is removed by the system/interferenced by
 * hooks from other software), and there is no way out after the failure: the cursor does not trigger the glove cursor
 * when it is hovering, it cannot be dragged, and there is no response when clicking or right-clicking. The reporter's
 * modification: The main process independently determines and flips the real cursor position, without relying on that
 * forwarding link.
 *
 * This file verifies three things: ① Judgment rules (on pet = interactive; window margin area = keep current,
 * menu/pop-up window can be clicked; outside the window = click-through); ② Geometry: window rectangle → pet body hit
 * area (must have the same origin as the hit determination of renderer sprite.js, otherwise the two channels
 * conflict); ③ Source code guard: There must be a fallback in main.js of helper Display and fallback polling (Electron
 * cannot get up, can only read source code assertion).
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
const {
  HIT_BOX,
  CANVAS_H,
  STAGE_W,
  FEET_Y,
  POINTER_POLL_MS,
  OFF_BODY_RELEASE_MS,
  spriteHitRect,
  pointerZone,
  decideWindowIgnore,
} = require(helper + 'pointer-target.js');

/** Source code of files in the package (for guarding; relative to src/host / parsing) */
const readSource = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

/** The source code of the renderer pet body: has been split into sprite.js and sprite -*.js according to responsibilities. Guards must read the entire copy. */
const spriteSource = (): string =>
  [
    readSource(helper + 'sprite.js'),
    ...readdirSync(fileURLToPath(new URL(helper + 'sprite/', import.meta.url))).map((name) =>
      readSource(helper + 'sprite/' + name),
    ),
  ].join('\n');

/** Real window rectangle ( DIP ): pet size 462 → window = 462 + 231 on each side = 924; height = canvas + bottomPad + margin on both sides */
const bounds = { x: 1000, y: 500, width: 924, height: 743 };

describe('decideWindowIgnore - Determination rules for fallback channel (issue #55 Reporter’s actual measurement table)', () => {
  test('The cursor is on the pet body → not click-through (interactive)', () => {
    const r = spriteHitRect(bounds);
    const center = { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 };
    assert.equal(decideWindowIgnore(bounds, center, true), false);
    assert.equal(decideWindowIgnore(bounds, center, false), false);
  });

  test('The window margin area maintains the current state: if it is currently interactive, it will be maintained (obtained from the self-drawn menu/pop-up window point), if it is currently click-through, it will be maintained click-through.', () => {
    const margin = { x: bounds.x + 20, y: bounds.y + 20 }; // Margin area in the upper left corner of the window (outside pets)
    assert.equal(
      decideWindowIgnore(bounds, margin, false),
      false,
      'When the menu is opened, the mouse cannot be moved back to the margin area click-through',
    );
    assert.equal(
      decideWindowIgnore(bounds, margin, true),
      true,
      'When there is no interaction, the margin area must remain click-through and do not block desktop icons.',
    );
  });

  test('Stay timeout in the margin area → restore click-through; the current state will remain until the point is reached', () => {
    const margin = { x: bounds.x + 20, y: bounds.y + 20 };
    assert.equal(
      decideWindowIgnore(bounds, margin, false, false, OFF_BODY_RELEASE_MS - 1),
      false,
      'Not yet reached: remain interactive',
    );
    assert.equal(
      decideWindowIgnore(bounds, margin, false, false, OFF_BODY_RELEASE_MS),
      true,
      'To point: restore click-through',
    );
    assert.equal(
      decideWindowIgnore(bounds, margin, true, false, OFF_BODY_RELEASE_MS),
      true,
      'click-through: maintain click-through',
    );
  });

  test('busy still takes precedence over timeout: click-through cannot be rolled back due to timeout during the lease period', () => {
    const margin = { x: bounds.x + 20, y: bounds.y + 20 };
    assert.equal(decideWindowIgnore(bounds, margin, false, true, OFF_BODY_RELEASE_MS * 100), false);
    assert.equal(decideWindowIgnore(bounds, margin, true, true, OFF_BODY_RELEASE_MS * 100), false);
  });

  test('Timeout does not cross the boundary: the body does not click-through due to timeout, and the window does not remain interactive due to zero duration.', () => {
    const r = spriteHitRect(bounds);
    const center = { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 };
    assert.equal(decideWindowIgnore(bounds, center, false, false, OFF_BODY_RELEASE_MS * 100), false);
    assert.equal(decideWindowIgnore(bounds, { x: bounds.x - 1, y: bounds.y + 100 }, false, false, 0), true);
  });

  test('pointerZone: The only source of window partitions', () => {
    const r = spriteHitRect(bounds);
    assert.equal(pointerZone(bounds, { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 }), 'body');
    assert.equal(pointerZone(bounds, { x: bounds.x + 2, y: bounds.y + 2 }), 'margin');
    assert.equal(pointerZone(bounds, { x: bounds.x - 1, y: bounds.y + 100 }), 'outside');
  });

  test('The margin area release threshold is a named constant (400 ms)', () => {
    assert.equal(OFF_BODY_RELEASE_MS, 400);
  });

  test('Cursor outside window → restore click-through (four directions)', () => {
    const cases = [
      { x: bounds.x - 1, y: bounds.y + 100 },
      { x: bounds.x + bounds.width, y: bounds.y + 100 },
      { x: bounds.x + 100, y: bounds.y - 1 },
      { x: bounds.x + 100, y: bounds.y + bounds.height },
    ];
    for (const p of cases) assert.equal(decideWindowIgnore(bounds, p, false), true, JSON.stringify(p));
  });

  test('Boundary rounding: the upper left corner of the window is counted as inside the window, and the lower right corner is counted as outside the window.', () => {
    assert.equal(decideWindowIgnore(bounds, { x: bounds.x, y: bounds.y }, false), false);
    assert.equal(
      decideWindowIgnore(bounds, { x: bounds.x + bounds.width - 1, y: bounds.y + bounds.height - 1 }, false),
      false,
    );
  });

  test('The window size has not been settled (renderer before the first frame is reported). No misjudgment: no "interactive" is generated in a very small rectangle.', () => {
    const tiny = { x: 0, y: 0, width: 4, height: 4 };
    assert.equal(decideWindowIgnore(tiny, { x: 0, y: 0 }, true), true);
  });
});

describe('Enter the lease (busy) - 0.2.10 "If you throw it too fast, it will fly out even if you don\'t let go" fix', () => {
  /** The pet lags behind the cursor during dragging: the cursor runs outside the window rectangle (it will definitely happen when you drag it fast, the amount of lag is > half the pet) */
  const ahead = { x: bounds.x + bounds.width + 120, y: bounds.y + 300 };

  test('busy = false: The position rule takes effect as it is (the judgment of 0.2.10 remains unchanged)', () => {
    assert.equal(decideWindowIgnore(bounds, ahead, false, false), true, 'Outside the window → click-through');
    assert.equal(
      decideWindowIgnore(bounds, { x: bounds.x + 20, y: bounds.y + 20 }, false, false),
      false,
      'Margin area→keep current (interactive)',
    );
    assert.equal(
      decideWindowIgnore(bounds, { x: bounds.x + 20, y: bounds.y + 20 }, true, false),
      true,
      'Margin area→Keep perspective',
    );
  });

  test('busy = true: The cursor cannot be click-through even if it is outside the window - this is the positive assertion of this return', () => {
    assert.equal(
      decideWindowIgnore(bounds, ahead, true, true),
      false,
      'When this click returns to click-through, the dragging window level event chain is broken: the pointer is still pressed, but the pet flies out at the old speed.',
    );
  });

  test('busy = true: No matter how far away the cursor is or what its current status is, it will always remain interactive (the position is not involved at all)', () => {
    const spots = [
      { x: bounds.x - 900, y: bounds.y - 900 },
      { x: bounds.x + bounds.width + 3000, y: bounds.y + 10 },
      { x: bounds.x + 20, y: bounds.y + 20 },
      { x: 0, y: 0 },
    ];
    for (const p of spots) {
      assert.equal(decideWindowIgnore(bounds, p, true, true), false, 'busy 时不得穿透 ' + JSON.stringify(p));
      assert.equal(decideWindowIgnore(bounds, p, false, true), false, 'busy 时不得穿透 ' + JSON.stringify(p));
    }
  });

  test('busy is a veto: it overrides the position determination (any "near as close" threshold will reintroduce the hysteresis condition)', () => {
    // Counter-evidence: Even if the cursor is far away from the window, it can only be interactive during busy
    const veryFar = { x: bounds.x + 99999, y: bounds.y };
    assert.equal(decideWindowIgnore(bounds, veryFar, true, true), false);
  });

  test('busy returns to the position immediately after release (no stickiness left when letting go/closing the menu/closing the pop-up window)', () => {
    assert.equal(decideWindowIgnore(bounds, ahead, false, true), false, 'busy period: interactive');
    assert.equal(
      decideWindowIgnore(bounds, ahead, false, false),
      true,
      'busy release: restore immediately at the same position click-through',
    );
  });

  test('The polling interval is still there (60 ms, issue #55 reporter measured value)', () => {
    assert.equal(POINTER_POLL_MS, 60);
  });
});

describe('spriteHitRect - has the same origin as renderer hit determination (otherwise the two channels will flip back to each other)', () => {
  test('The real window of size 462: the hit area falls within the body rectangle, and the center = the center of the window (the actual measurement of the real machine is consistent)', () => {
    const r = spriteHitRect(bounds);
    // Window = canvas + margin (231) on both sides; canvas 462×260, body hit area is 200..440 / 50..335 of canvas 640×360
    const margin = 231;
    const stageH = (462 * CANVAS_H) / STAGE_W;
    const bottomPad = (stageH * (CANVAS_H - FEET_Y)) / CANVAS_H;
    const near = (actual: number, expected: number) => Math.abs(actual - expected) < 0.01;
    assert.ok(near(r.left, bounds.x + margin + (200 / STAGE_W) * 462), 'left=' + r.left);
    assert.ok(near(r.right, bounds.x + margin + (440 / STAGE_W) * 462), 'right=' + r.right);
    assert.ok(near(r.top, bounds.y + margin + bottomPad + (50 / CANVAS_H) * stageH), 'top=' + r.top);
    assert.ok(near(r.bottom, bounds.y + margin + bottomPad + (335 / CANVAS_H) * stageH), 'bottom=' + r.bottom);
    // The hit area must fall completely within the window (otherwise it will never trigger + it will misjudge the window)
    assert.ok(r.left > bounds.x && r.right < bounds.x + bounds.width);
    assert.ok(r.top > bounds.y && r.bottom < bounds.y + bounds.height);
    // It is consistent with the measured landing point on the real machine: when I inject the cursor into the center of the window, the center of the hit area is exactly the center of the window.
    assert.ok(Math.abs((r.left + r.right) / 2 - (bounds.x + bounds.width / 2)) < 0.01);
  });

  test('The hit area scales proportionally with the window size (the pet still fits after zooming in/out)', () => {
    const small = { x: 0, y: 0, width: 600, height: 482 }; // size 300: 300 + 150 on each side
    const r = spriteHitRect(small);
    assert.ok(r.left > 150 && r.left < 300);
    assert.ok(r.right > 300 && r.right < 450);
  });

  test('The body is offset within the window (X11 after clamping the window back to the workspace) → The entire hit area is offset and the left and right are no longer symmetrical.', () => {
    // The measured window of issue #274: 880×782, body 440 wide. When attaching the lower right corner, the window is
    // clamped to (1040,258), the body offset becomes left 416 / upper 524.5, and only 880 − 416 − 440 = 24 is left on
    // the right
    const clamped = { x: 1040, y: 258, width: 880, height: 782 };
    const r = spriteHitRect(clamped, { l: 416, t: 524.5, r: 24 });
    // The expected value is hard-coded and the measured formula is not recalculated: the hit area falls within the window in proportion to the body width 440, with the left edge 200/640×440 = 137.5 and the right edge 440/640×440 = 302.5
    assert.ok(
      Math.abs(r.left - 1593.5) < 0.01,
      `The left edge of the hit area should be 1593.5, and the actual value is ${r.left}`,
    );
    assert.ok(
      Math.abs(r.right - 1758.5) < 0.01,
      `The right edge of the hit area should be 1758.5, and the actual value is ${r.right}`,
    );
    assert.ok(
      r.left > spriteHitRect(clamped).left,
      'After offset, the hit area must be moved to the right as a whole, and cannot still be calculated according to "window width/4"',
    );
    assert.ok(r.right <= clamped.x + clamped.width, 'The hit area must not exceed the right edge of the window');
    assert.ok(r.bottom <= clamped.y + clamped.height, 'The hit area must not exceed the lower edge of the window');
  });
});

describe('The menu/chat box only occupies the control rectangle and does not swallow up other application clicks.', () => {
  const input = { dragging: false, rects: [{ x: 10, y: 10, width: 150, height: 200 }] };
  test('Maintain interaction within the control, transparent margin immediately click-through, even if busy = true', () => {
    assert.equal(decideWindowIgnore(bounds, { x: 1020, y: 520 }, true, true, 0, input), false);
    assert.equal(decideWindowIgnore(bounds, { x: 1200, y: 520 }, false, true, 0, input), true);
    assert.equal(decideWindowIgnore(bounds, { x: 0, y: 0 }, false, true, 0, input), true);
  });
  test('You can click on the body even when the menu is open; dragging across the window still retains the input', () => {
    const r = spriteHitRect(bounds);
    assert.equal(decideWindowIgnore(bounds, { x: r.left + 1, y: r.top + 1 }, true, true, 0, input), false);
    assert.equal(
      decideWindowIgnore(bounds, { x: -9999, y: -9999 }, true, true, 0, { ...input, dragging: true }),
      false,
    );
  });
  test('Each panel of a multi-level menu is interactive, and the transparent gaps between panels remain click-through', () => {
    const cascade = { dragging: false, rects: [...input.rects, { x: 180, y: 10, width: 150, height: 300 }] };
    assert.equal(decideWindowIgnore(bounds, { x: 1190, y: 520 }, true, true, 0, cascade), false);
    assert.equal(decideWindowIgnore(bounds, { x: 1170, y: 520 }, false, true, 0, cascade), true);
  });
});

describe('Source code guard - the two fallbacks of helper must be in place', () => {
  /** main process source code: main.js is the assembly root, and the behaviors are scattered in modules under main /. The guard must read the entire copy. */
  const mainSource = (dir: string): string =>
    [
      readSource(dir + 'main.js'),
      ...readdirSync(fileURLToPath(new URL(dir + 'main/', import.meta.url)))
        .filter((name) => name.endsWith('.js'))
        .map((name) => readSource(dir + 'main/' + name)),
    ].join('\n');
  const main = mainSource(helper);

  test('#55-1 fallback displays: In addition to ready-to-show, there is also "show if it is not displayed after loading is completed"', () => {
    // The callback may be a single line `() => win.showInactive()` , or it may be multiple lines (when there are
    // multiple lines, first keepOffTaskbar and then show): It only restricts "the final use of showInactive inside the
    // callback and does not grab the focus", and does not restrict the writing method itself.
    assert.ok(
      /once\('ready-to-show', \(\) => \{?[\s\S]*?win\.showInactive\(\)/.test(main),
      'The display must not steal the focus from other applications.',
    );
    assert.ok(
      /once\('did-finish-load'/.test(main),
      'There must be did-finish-load fallback (ready-to-show will never trigger when paintWhenInitiallyHidden:false)',
    );
    assert.ok(
      /!win\.isDestroyed\(\) && !win\.isVisible\(\)\) win\.showInactive\(\)/.test(main),
      'fallback must be when "still not shown" show',
    );
  });

  test('#55-2 fallback polling: The main process is determined independently based on the real cursor, and shares the same outlet with the renderer channel', () => {
    assert.ok(/decideWindowIgnore\(/.test(main), 'Pure judgment must be called (does not rely on forward mouse hook)');
    assert.ok(/screen\.getCursorScreenPoint\(\)/.test(main), 'The real cursor position must be read');
    assert.ok(/POINTER_POLL_MS/.test(main), 'polling interval must be a named constant (60 ms)');
    assert.ok(
      (main.match(/setWindowIgnore\(/g) ?? []).length >= 3,
      'All flips must go through setWindowIgnore (create / IPC / fallback polling) so that the mirroring state does not lose synchronization',
    );
    assert.ok(
      !/win\.setIgnoreMouseEvents\(/.test(main.replace(/function setWindowIgnore[\s\S]*?\n}/, '')),
      'No more direct calls bypassing the exit',
    );
    assert.ok(/clearInterval\(pointerTimer\)/.test(main), 'Polling must be stopped when the window is closed');
  });

  test('Input lease closed loop: renderer reports busy, main process determines accordingly, and only takes the only exit', () => {
    assert.ok(/const inputBusy = new Map\(\)/.test(main), 'Must have per-window busy tag table');
    assert.ok(/ipcMain\.on\('pet:input-busy'/.test(main), 'busy report must be accepted');
    // fallback polling must bring busy and the length of stay in the margin area into the judgment (according to semantic assertion, the literal value of the calling line is not nailed)
    const poll = /setInterval\(\(\) => \{([\s\S]*?)\}, POINTER_POLL_MS\);/.exec(main);
    assert.ok(poll, 'fallback polling body not found');
    assert.ok(
      /decideWindowIgnore\(/.test(poll[1]),
      'polling must call pure judgment (does not rely on forward mouse hook)',
    );
    assert.ok(/inputBusy\.get\(win\.id\) === true/.test(poll[1]), 'busy must be brought into the judgment');
    assert.ok(
      /offBodyMs\.get\(win\.id\)/.test(poll[1]),
      'The length of stay in the margin area must be brought into the judgment',
    );
    assert.ok(
      /inputBusy\.delete\(win\.id\)/.test(main),
      'The busy mark must be cleared when the window is closed (to prevent id reuse odor)',
    );
    assert.ok(
      /offBodyMs\.delete\(win\.id\)/.test(main),
      'The dwell timer must be cleared when the window is closed (to prevent id reuse odor)',
    );
    // busy can only take effect through fallback polling, and the window cannot be opened directly in IPC - otherwise the two channels will rush to open the same window.
    assert.ok(
      !/ipcMain\.on\('pet:input-busy'[\s\S]{0,400}?setWindowIgnore\(/.test(main),
      'busy processor must not directly setWindowIgnore (the only exit is in polling, determined according to complete rules)',
    );
    assert.ok(/inputBusy\.set\(win\.id, !!busy\)/.test(main), 'busy only marks, and is decided by next tick polling.');
  });
});

describe('Guard: The hitbox constant of the main process image must not drift with src/shared/constants.ts', () => {
  test('HIT_BOX / CANVAS_H are consistent with shared constants, and the canvas width follows the same convention (literal value 640)', () => {
    const shared = readSource('../shared/constants.ts');
    const num = (name: string): number => {
      const m = new RegExp(String.raw`export const ${name} = (\d+)`).exec(shared);
      assert.ok(m, 'shared 里找不到 ' + name);
      return Number(m[1]);
    };
    assert.equal(CANVAS_H, num('CANVAS_H'));
    assert.equal(FEET_Y, num('FEET_Y'));
    const hit = /export const HIT_BOX = \{ x0: (\d+), y0: (\d+), x1: (\d+), y1: (\d+) \}/.exec(shared);
    assert.ok(hit, 'The shape of HIT_BOX in shared has changed, please synchronize pointer-target.js');
    assert.deepEqual(HIT_BOX, { x0: Number(hit[1]), y0: Number(hit[2]), x1: Number(hit[3]), y1: Number(hit[4]) });
    // The canvas width shared is not exported (literal 640 is used everywhere): The assertion renderer here also has the same convention to prevent us from writing the width as another value
    assert.equal(STAGE_W, 640);
    assert.ok(
      /S\.HIT_BOX\.x0 \/ 640/.test(spriteSource()),
      'The hit determination of sprite.js uses 640 as the canvas width - both sides must be the same agreement',
    );
  });
});

describe('Guard: The input lease of the renderer must be in place (helper is distributed with the package, only the source code assertion can be read)', () => {
  // Ignore standalone comment lines so prose length cannot break the bounded source guards.
  const sprite = spriteSource().replace(/^[ \t]*\/\/[^\n]*\n/gm, '');

  test('The lease source must **exactly** be in the three "Inputting with window" status', () => {
    const m = /inputBusy\(\)\s*\{([\s\S]*?)\n {2}\}/.exec(sprite);
    assert.ok(m, 'inputBusy () cannot be found in sprite.js');
    const body = m[1];
    for (const flag of ['dragState.active', 'menuOpen', 'chatOpen']) {
      assert.ok(body.includes(flag), `The lease must contain ${flag}`);
    }
  });

  test('Establishment point: Drag and drop to establish/menu open/pop-up window to report.', () => {
    // Drag and drop: Report immediately in onPointerDown (without crossing the threshold - the window must remain interactive the moment it is pressed)
    assert.ok(
      /setPointerCapture[\s\S]{0,600}?this\.syncInputBusy\(\)/.test(sprite),
      'onPointerDown must report busy after establishing drag state',
    );
    assert.ok(
      /d\.dragging = true;[\s\S]{0,400}?this\.syncInputBusy\(\)/.test(sprite),
      'It must also be reported when dragging actually starts (it may not have been reported at this time)',
    );
    assert.ok(
      /this\.menuOpen = true;[\s\S]{0,300}?this\.syncInputBusy\(\)/.test(sprite),
      'Menu opening must be reported',
    );
    assert.ok(
      /this\.chatOpen = true;[\s\S]{0,300}?this\.syncInputBusy\(\)/.test(sprite),
      'When a dialogue pop-up window opens, it must be reported',
    );
  });

  test('Release point: Let go / closeMenu / Menu onClose / Pop-up window onClose Report everywhere', () => {
    assert.ok(/this\.syncInputBusy\(\)/.test(sprite), 'There must be a reporting method');
    // Let go (onPointerUp)
    assert.ok(
      /onPointerUp\(e\) \{[\s\S]{0,400}?this\.syncInputBusy\(\)/.test(sprite),
      'Letting go/cancellation must be reported (otherwise the window is stuck and interactive)',
    );
    // closeMenu covers in one place: onAction, mouseleave, destroy of menu items
    assert.ok(
      /closeMenu\(\) \{[\s\S]{0,400}?this\.syncInputBusy\(\)/.test(sprite),
      'closeMenu must be reported (all four closing paths of the menu should be taken)',
    );
    // The menu is clicked out/Esc is closed: mountContextMenu's onClose is used, without closeMenu
    assert.ok(
      /onClose: \(\) => \{\s*this\.menuOpen = false;[\s\S]{0,200}?this\.syncInputBusy\(\)/.test(sprite),
      'Menu onClose (outside point/Esc) must be reported - this path does not go through closeMenu',
    );
    // The dialogue pop-up window is closed
    assert.ok(
      /this\.chatOpen = false;[\s\S]{0,300}?this\.syncInputBusy\(\)/.test(sprite),
      'The closing of the dialogue pop-up window must be reported',
    );
  });

  test('The report is idempotent, only petBridge.setInputBusy is used (IPC is not refreshed frame by frame)', () => {
    assert.ok(
      /if \(busy === this\._inputBusy\) return;/.test(sprite),
      'If the value does not change, it must be returned directly (high-frequency paths such as mouseleave will be called repeatedly during dragging)',
    );
    assert.ok(/window\.petBridge\.setInputBusy\(busy\)/.test(sprite), 'Must be reported via petBridge');
  });

  test('preload exposes setInputBusy (the method name must be consistent with the one called by sprite.js)', () => {
    const preload = readSource(helper + 'preload.js');
    assert.ok(/setInputBusy\(busy\)/.test(preload), 'preload must have setInputBusy');
    assert.ok(/'pet:input-busy'/.test(preload), 'IPC channel name must be consistent with main.js');
  });
});
