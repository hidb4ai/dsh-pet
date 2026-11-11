/**
 * Multi-screen heterogeneous DPI probe: Verify that "the same DIP rectangle is mapped to different physical
 * locations/sizes depending on the screen to which the window belongs."
 *
 * Background ( Chromium ui/display/win/screen_win.cc ):
 * ScreenWin::DIPToScreenRect (hwnd, dip) uses **hwnd's current screen** (dipOrigin, pixelOrigin, scale) to do affine
 * transformation - origin goes to DIPToScreenPoint (dip.origin, thatDisplay ), size goes dip.size × thatDisplay.scale.
 * The ownership of hwnd is determined by the area ratio of MonitorFromWindow (MONITOR_DEFAULTTONEAREST), and it will
 * flip when sewing. The two screens scale are different ⇒ The same DIP value falls into different physical pixels
 * before and after flipping; scale is the same ⇒ The two screens share the same affine transformation, and flipping
 * has no effect.
 *
 * Running method (harness comes with electron): % APPDATA %\ dsh-desktop-dev \ harness \ electron \ electron.exe tools
 * \ probe-dpi.cjs % APPDATA %\ dsh-desktop-dev \ harness \ electron \ electron.exe tools \ probe-dpi.cjs --
 * force-device-scale-factor =1
 *
 * Interpretation: The DELTA segment is all 0 = the DIP value is not affected by the window ownership (the DPI
 * conversion has been linearized); non-0 = the seam flip will jump, and the value is the jump amplitude (physical
 * pixel). After adding --force-device-scale-factor, they should all be reset to zero.
 */
'use strict';
const { app, BrowserWindow, screen } = require('electron');

const forced = process.argv.find((a) => a.startsWith('--force-device-scale-factor='));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmt = (r) => `${r.x},${r.y} ${r.width}×${r.height}`;

/** Move the window to the specified screen and wait for Windows to finish processing WM_DPICHANGED / ownership update */
async function park(win, display) {
  const a = display.workArea;
  win.setContentBounds({ x: Math.round(a.x + 20), y: Math.round(a.y + 20), width: 200, height: 200 }, false);
  await sleep(250);
  return screen.getDisplayNearestPoint(win.getBounds()).id;
}

app.whenReady().then(async () => {
  const displays = screen.getAllDisplays();
  console.log('=== DISPLAYS ===');
  for (const [i, d] of displays.entries()) {
    console.log(
      `  #${i} ${d.label} id=${d.id} scale=${d.scaleFactor} rot=${d.rotation}` +
        `  bounds=${fmt(d.bounds)}  workArea=${fmt(d.workArea)}`,
    );
  }
  console.log('forceDeviceScaleFactor =', forced || '(none)');
  // Whether global linearization is established: DIP ↔Physics Is it a single affine transformation that has nothing to
  // do with "which screen it belongs to". The necessary and sufficient condition is that each screen satisfies
  // pixelOrigin == dipOrigin × scale (the origin and scaling have the same origin).
  // dipToScreenRect ( null , r ) Let Chromium select the screen according to the rectangular position, and compare it
  // with the screen-by-screen calculation to see the offset.
  console.log("\n=== Per-display affine mapping (dipOrigin * scale versus actual pixelOrigin) ===");
  for (const [i, d] of displays.entries()) {
    const oneDip = { x: d.bounds.x, y: d.bounds.y, width: 10, height: 10 };
    const phys = screen.dipToScreenRect(null, oneDip);
    console.log(
      `  #${i} dipOrigin=${d.bounds.x},${d.bounds.y} *${d.scaleFactor} => expected ${d.bounds.x * d.scaleFactor},${d.bounds.y * d.scaleFactor}   actual pixelOrigin=${phys.x},${phys.y}`,
    );
  }

  // The union area of the external rectangle vs working areas: P1 void ratio
  const x0 = Math.min(...displays.map((d) => d.workArea.x));
  const y0 = Math.min(...displays.map((d) => d.workArea.y));
  const x1 = Math.max(...displays.map((d) => d.workArea.x + d.workArea.width));
  const y1 = Math.max(...displays.map((d) => d.workArea.y + d.workArea.height));
  const hullArea = (x1 - x0) * (y1 - y0);
  const sumArea = displays.reduce((s, d) => s + d.workArea.width * d.workArea.height, 0);
  console.log('\n=== HULL vs UNION ===');
  console.log(`hull = ${x0},${y0} ${x1 - x0}×${y1 - y0}  area=${hullArea}`);
  console.log(`sum(workArea) = ${sumArea}   hole = ${(((hullArea - sumArea) / hullArea) * 100).toFixed(1)}%`);

  const win = new BrowserWindow({
    width: 200,
    height: 200,
    show: true,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    useContentSize: true,
    webPreferences: { offscreen: false },
  });
  win.setIgnoreMouseEvents(true, { forward: true });
  await sleep(300);

  // DIP rectangle for testing: typical size of pet window 924×600, take both sides of the gap + depth of each screen
  const W = 924;
  const H = 600;
  // tag must have a subscript: dual screens of the same model label are exactly the same, and using label to make key will cover each other.
  const probes = [];
  displays.forEach((d, i) => {
    const a = d.workArea;
    probes.push({ tag: `#${i} ${d.label}@origin`, x: a.x + 10, y: a.y + 10 });
    probes.push({
      tag: `#${i} ${d.label}@center`,
      x: Math.round(a.x + a.width / 2 - W / 2),
      y: Math.round(a.y + a.height / 2),
    });
    probes.push({ tag: `#${i} ${d.label}@far-edge`, x: Math.round(a.x + a.width - W - 10), y: Math.round(a.y + 10) });
  });

  const table = [];
  for (const [i, d] of displays.entries()) {
    const parkedOn = await park(win, d);
    const row = { parkedOn: `#${i} ${d.label}(id=${d.id}, scale=${d.scaleFactor})`, nearest: parkedOn, map: {} };
    for (const p of probes) {
      row.map[p.tag] = screen.dipToScreenRect(win, { x: p.x, y: p.y, width: W, height: H });
    }
    table.push(row);
  }

  console.log("\n=== DIP -> PHYSICAL, grouped by window placement ===");
  console.log(`Test rectangle DIP size = ${W}x${H}`);
  for (const row of table) {
    console.log(`\n-- Window placed on ${row.parkedOn} --`);
    for (const [tag, r] of Object.entries(row.map)) console.log(`   ${tag.padEnd(28)} → ${fmt(r)}`);
  }

  if (table.length >= 2) {
    console.log("\n=== DELTA (group 2 - group 1; all zeros means independent of window placement) ===");
    const a = table[0].map;
    const b = table[1].map;
    for (const tag of Object.keys(a)) {
      const d = {
        dx: b[tag].x - a[tag].x,
        dy: b[tag].y - a[tag].y,
        dw: b[tag].width - a[tag].width,
        dh: b[tag].height - a[tag].height,
      };
      const flag = d.dx || d.dy || d.dw || d.dh ? '  <-- jump' : '';
      console.log(`   ${tag.padEnd(28)} dx=${d.dx} dy=${d.dy} dw=${d.dw} dh=${d.dh}${flag}`);
    }
  }

  // setContentBounds round trip: Suppose DIP → read back DIP, see why the main process "readback deduplicate" is never equal
  console.log("\n=== setContentBounds round trip (readback differing from the target causes repeated updates) ===");
  for (const d of displays) {
    const a = d.workArea;
    const target = { x: Math.round(a.x + a.width / 2 - W / 2), y: Math.round(a.y + 100), width: W, height: H };
    win.setContentBounds(target, false);
    await sleep(250);
    const back = win.getContentBounds();
    const same = target.x === back.x && target.y === back.y && target.width === back.width && target.height === back.height;
    console.log(`   ${d.label}(scale=${d.scaleFactor}): set ${fmt(target)} → get ${fmt(back)}  ${same ? 'equal' : 'DIFF'}`);
  }

  win.destroy();
  app.exit(0);
});
