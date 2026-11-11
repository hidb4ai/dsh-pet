/**
 * Desktop geometry: Summarize the per-monitor bounds/workArea into the hull required by the renderer, per-screen area
 * and complete panel (pure calculation, do not touch Electron). macOS brings the top edge of the workspace to the top
 * edge of the panel (pet-accessible menu bar strip), but keeps the exclusion on the Dock side.
 * @module dsh-pet/runtime/electron-helper/desktop-geometry
 */
'use strict';

const { HIT_BOX, STAGE_W, CANVAS_H, FEET_Y } = require('./pointer-target.js');

/**
 * Calculate desktop geometry (screen coordinates) from monitor list.
 *
 * @param displays - Display list (including bounds/workArea/id).
 * @param primaryId - Home screen id.
 * @param platform - process.platform.
 */
function buildDeskGeometry(displays, primaryId, platform) {
  const workAreas = displays.map((d) => ({ ...d.workArea }));
  const panels = displays.map((d) => ({ ...d.bounds }));
  const areas = workAreas.map((a, i) => {
    if (platform !== 'darwin') return { ...a };
    // Keep the bottom/side exclusion of Dock, but the visible height should reach the top edge of the panel.
    return { ...a, y: panels[i].y, height: a.y + a.height - panels[i].y };
  });
  const x = Math.min(...areas.map((a) => a.x));
  const y = Math.min(...areas.map((a) => a.y));
  return {
    hull: {
      x,
      y,
      width: Math.max(...areas.map((a) => a.x + a.width)) - x,
      height: Math.max(...areas.map((a) => a.y + a.height)) - y,
    },
    areas,
    workAreas,
    panels,
    primaryIndex: Math.max(
      0,
      displays.findIndex((d) => d.id === primaryId),
    ),
    topInsetRatio: platform === 'darwin' ? (HIT_BOX.y0 + CANVAS_H - FEET_Y) / STAGE_W : 0,
  };
}

module.exports = { buildDeskGeometry };
