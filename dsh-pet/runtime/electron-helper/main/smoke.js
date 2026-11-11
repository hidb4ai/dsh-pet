'use strict';
/**
 * Smoke self-check: DSH_PET_SMOKE =1 time delay to check the window, rendering, animation and interactive links, and
 * exit after taking a screenshot.
 *
 * It is only entered during development and troubleshooting; the check item requires reading the window table and
 * click-through image on the main process side, so it is passed in by the caller and does not maintain its own state.
 * @module dsh-pet/runtime/electron-helper/main-smoke
 */

const path = require('node:path');
const { writeFileSync } = require('node:fs');

/**
 * Run a smoke check.
 * @param deps.app - Electron app (exit with temporary directory).
 * @param deps.windows - Pet window table.
 * @param deps.windowIgnore - Whether each window is currently click-through (main process mirrored).
 * @param deps.setPointerFallbackPaused - Check click-through to pause fallback polling during round trip.
 */
function runSmokeCheck({ app, windows, windowIgnore, setPointerFallbackPaused }) {
  const smokeOut = process.env.DSH_PET_SMOKE_OUT || path.join(app.getPath('temp'), 'dsh-pet-smoke.png');
  const afterMs = Number(process.env.DSH_PET_SMOKE_AFTER_MS || 9000);
  const target = windows.values().next().value;
  if (target) {
    // Forward renderer console (positioning animation/balance/error issue)
    target.webContents.on('console-message', (event) => {
      console.log(`[renderer:${event.level}] ${event.message}`);
    });
  }
  setTimeout(async () => {
    try {
      const first = windows.values().next().value;
      if (first && !first.isDestroyed()) {
        const dump = await first.webContents.executeJavaScript(`(async () => ({
          hasBridge: typeof window.petBridge !== 'undefined',
          hasSetInteractive: typeof window.petBridge?.setInteractive === 'function',
          viewport: window.innerWidth + 'x' + window.innerHeight,
          dpr: window.devicePixelRatio,
          debug: window.__dshPetDebug || null,
          sprites: document.querySelectorAll('.pet-sprite').length,
          errorVisible: document.getElementById('pet-error').classList.contains('visible'),
          errorText: document.getElementById('pet-error').textContent,
          firstBubble: (document.querySelector('.pet-bubble.is-on') || { textContent: '' }).textContent.slice(0, 120),
          hitCursor: (function () {
            var hit = document.querySelector('.pet-hit');
            return hit ? getComputedStyle(hit).cursor : '';
          })(),
          dragTransform: (function () {
            var hit = document.querySelector('.pet-hit');
            var stage = document.querySelector('.pet-stage');
            if (!hit || !stage) return 'no-sprite';
            var out = { idle: stage.style.transform };
            hit.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 120, clientY: 120, screenX: 120, screenY: 120, pointerId: 91 }));
            out.duringClick = stage.style.transform;
            hit.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 120, clientY: 120, screenX: 120, screenY: 120, pointerId: 91 }));
            out.afterClick = stage.style.transform;
            hit.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 200, clientY: 200, screenX: 200, screenY: 200, pointerId: 92 }));
            hit.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 280, clientY: 240, screenX: 280, screenY: 240, pointerId: 92 }));
            out.duringDrag = stage.style.transform;
            window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 280, clientY: 240, screenX: 280, screenY: 240, pointerId: 92 }));
            out.afterDrag = stage.style.transform;
            return out;
          })(),
          releaseKeptPosition: await (async function () {
            // Independent invariant: Drag the pet to a fixed safe point (600,300) in the work area first. After letting
            // go, the window position must remain in place.
            // Under drag and throw physics (spring follows hand + throw): the spring needs ~0.3 s to converge after the
            // pointer jumps long distance.
            // Staying for more than RELEASE_STALE_MS (150 ms) before letting go will be judged as "gentle release"
            // (estimate speed null, no throwing)——
            // Therefore, wait until the spring is in place and then stop before letting go. Only test "whether there is
            // displacement at the moment of release."
            var d = window.__dshPetDebug;
            var hit = document.querySelector('.pet-hit');
            if (!d || !d.dragPos || !hit) return null;
            var P = { x: d.dragPos.x, y: d.dragPos.y };
            var T = { x: 600, y: 300 }; // 目标窗口左上角（1708×1020 工作区内，远离四边）
            var upX = 1000 + (T.x - P.x);
            var upY = 600 + (T.y - P.y);
            var sleep = function (ms) {
              return new Promise(function (r) {
                setTimeout(r, ms);
              });
            };
            hit.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 1000, clientY: 600, screenX: 1000, screenY: 600, pointerId: 93 }));
            hit.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: upX, clientY: upY, screenX: upX, screenY: upY, pointerId: 93 }));
            await sleep(400); // 弹簧跟随收敛
            var during = { x: d.dragPos.x, y: d.dragPos.y };
            await sleep(200); // 轨迹过期 → 估速 null → 温柔放下（不抛掷）
            window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: upX, clientY: upY, screenX: upX, screenY: upY, pointerId: 93 }));
            await sleep(80); // 释放处理完成
            var released = d.lastDragRelease ? { x: d.lastDragRelease.x, y: d.lastDragRelease.y } : null;
            return {
              during: during,
              released: released,
              kept: !!(released && Math.abs(released.x - during.x) <= 1 && Math.abs(released.y - during.y) <= 1),
            };
          })(),
          interactiveFlip: (function () {
            // Click-through hit judgment: the cursor is within the hit area → interactive; moves out → click-through;
            // dragging (pointer has been captured) → forced interactive.
            //  hitRect is the sprite coordinate, mousemove uses the window coordinate - the test event needs to add the
            // offset of the body in the window winOffset.
            var d = window.__dshPetDebug;
            var hit = document.querySelector('.pet-hit');
            if (!d || !d.hitRect || !d.winOffset || !hit) return null;
            var r = d.hitRect;
            var m = d.winOffset;
            var xIn = m.x + r.x + r.w / 2;
            var yIn = m.y + r.y + r.h / 2;
            var xOut = Math.max(0, m.x + r.x - 20);
            var yOut = Math.max(0, m.y + r.y - 20);
            var out = {};
            window.dispatchEvent(new MouseEvent('mousemove', { clientX: xIn, clientY: yIn, screenX: xIn, screenY: yIn }));
            out.inside = d.interactive === true;
            window.dispatchEvent(new MouseEvent('mousemove', { clientX: xOut, clientY: yOut, screenX: xOut, screenY: yOut }));
            out.outside = d.interactive === false;
            hit.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: xIn, clientY: yIn, screenX: xIn, screenY: yIn, pointerId: 94 }));
            window.dispatchEvent(new MouseEvent('mousemove', { clientX: xOut, clientY: yOut, screenX: xOut, screenY: yOut }));
            out.duringDragForced = d.interactive === true;
            window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: xOut, clientY: yOut, screenX: xOut, screenY: yOut, pointerId: 94 }));
            return out;
          })(),
          videoSrcA: (document.querySelectorAll('.pet-sprite video')[0] || { src: '' }).src,
          videoSrcB: (document.querySelectorAll('.pet-sprite video')[1] || { src: '' }).src,
          // Right-click menu self-test: dispatch contextmenu in the hit area → verify menu mounting/root
          // copy/sub-panel/running error
          menuSmoke: await (async function () {
            // The previous drag/release/interactive test has just been dragged: justDragged 100 ms Right click on the
            // inner shield,
            // Real users will not right-click immediately after dragging - wait 250 ms first to eliminate the timing
            // impact
            await new Promise(function (resolve) {
              setTimeout(resolve, 250);
            });
            var hit = document.querySelector('.pet-hit');
            var d = window.__dshPetDebug;
            if (!hit || !d) return null;
            var errsBefore = (d.errors || []).length;
            try {
              hit.dispatchEvent(
                new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: 400, clientY: 260, screenX: 400, screenY: 260 }),
              );
            } catch (err) {
              return { threw: String(err), menuMounted: false };
            }
            var menu = document.querySelector('.dsh-pet-menu');
            var out = {
              threw: null,
              menuMounted: !!menu,
              menuOpen: d.menuOpen === true,
              rootText: menu ? menu.textContent.slice(0, 60) : '',
              errsNew: (d.errors || []).length - errsBefore,
            };
            if (menu) {
              var branch = menu.querySelector('.dsh-pet-menu-branch');
              if (branch) {
                branch.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false, relatedTarget: menu }));
                var panels = Array.prototype.slice.call(
                  menu.querySelectorAll('.dsh-pet-menu-column'),
                );
                var visible = function () {
                  return panels.filter(function (p) {
                    return p.style.display !== 'none';
                  });
                };
                out.panelCount = panels.length;
                out.lvl2AfterHoverRoot = visible().length;
                // Level 2: Hover the first category under "Action" → Open the level 3 panel (specific animation)
                var panel1 = visible().filter(function (p) {
                  return p !== panels[0];
                })[0];
                if (panel1) {
                  var cat = panel1.querySelector('.dsh-pet-menu-branch');
                  if (cat) {
                    cat.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false, relatedTarget: panel1 }));
                    await new Promise(function (resolve) {
                      setTimeout(resolve, 50);
                    });
                    out.lvl3AfterHoverCat = visible().length;
                    // Replay user path: Move the mouse from the category item to the third-level panel (leave the category item
                    // first and enter the 4 px gap,
                    // Then enter the third-level panel) - mouseleave in the gap will queue 160 ms to close the timer
                    cat.dispatchEvent(
                      new MouseEvent('mouseleave', { bubbles: false, relatedTarget: document.body }),
                    );
                    await new Promise(function (resolve) {
                      setTimeout(resolve, 60);
                    });
                    var panel2 = visible()[visible().length - 1];
                    if (panel2) {
                      panel2.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
                    }
                    await new Promise(function (resolve) {
                      setTimeout(resolve, 220);
                    });
                    out.lvl3SurvivedAfterReenter = visible().length;
                    // Extreme case: the gap stays longer than the closing delay (mouse hesitates)
                    cat.dispatchEvent(
                      new MouseEvent('mouseleave', { bubbles: false, relatedTarget: document.body }),
                    );
                    await new Promise(function (resolve) {
                      setTimeout(resolve, 260);
                    });
                    out.lvl3AfterGapHover = visible().length;
                  }
                }
              }
            }
            return out;
          })(),
        }))()`);
        console.log(
          '[dsh-pet-desktop-helper] smoke dump: windows=' +
            windows.size +
            ' ids=' +
            JSON.stringify([...windows.keys()]) +
            ' => ' +
            JSON.stringify(dump),
        );
        console.log('[dsh-pet-desktop-helper] smoke bounds:', JSON.stringify(first.getContentBounds()));
        // Click-through round-trip: true → window capture input, false → restore the entire window click-through; the
        // status is taken from the main process image. Pause during fallback polling: it flips according to the real
        // cursor. When the mouse is not on the pet when the smoke is emitted, the state of this assertion will be
        // overwritten.
        setPointerFallbackPaused(true);
        await first.webContents.executeJavaScript('window.petBridge.setInteractive(true); true;');
        await new Promise((r) => setTimeout(r, 80));
        const interactiveIgnoring = windowIgnore.get(first.id);
        await first.webContents.executeJavaScript('window.petBridge.setInteractive(false); true;');
        await new Promise((r) => setTimeout(r, 80));
        const passthroughIgnoring = windowIgnore.get(first.id);
        setPointerFallbackPaused(false);
        console.log(
          '[dsh-pet-desktop-helper] smoke interactive round-trip:',
          JSON.stringify({ interactiveIgnoring, passthroughIgnoring }),
        );
        const image = await first.webContents.capturePage();
        writeFileSync(smokeOut, image.toPNG());
        console.log('[dsh-pet-desktop-helper] smoke capture:', smokeOut);
      }
    } catch (error) {
      console.error('[dsh-pet-desktop-helper] smoke capture failed:', error);
    }
    setTimeout(() => app.quit(), 500);
  }, afterMs);
}

module.exports = { runSmokeCheck };
