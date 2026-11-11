/**
 * Pure determination and pure conversion of global DPI linearization (not require electron, can be loaded directly by
 * node:test). Windows's DIP ↔The physical conversion is a monitor-by-monitor affine transformation, and the two
 * coordinate systems jump horizontally when riding: force device scale before starting
 * factor = 1 Collapse each screen into an identity mapping, and then scale and compensate according to the detected
 * real main screen to return to the original look and feel. DIP of macOS is the "point". This switch only changes
 * backing store and does not produce differences that require compensation. Therefore, darwin will not be enabled;
 * detection and wiring are not included in this document.
 * @module dsh-pet/runtime/electron-helper/dpi-linearization
 */

'use strict';

/**
 * Whether to enable global DPI linearization (and force device scale factor).
 *
 * @param o.platform - process.platform.
 * @param o.dpiProbe - Is this process a detection sub-process (detecting the sub-process again will result in infinite
 * recursion).
 * @param o.forceDsf - DSH_PET_FORCE_DSF Original value ('0' = turn off this mechanism; positive number = override for
 * troubleshooting).
 * Is @returns enabled?
 */
function shouldLinearize(o = {}) {
  if (o.dpiProbe) return false; // The child process does not detect itself
  if (String(o.forceDsf ?? '') === '0') return false; // Troubleshooting switch: The entire mechanism is turned off
  if (o.platform === 'darwin') return false; // macOS: DIP is already a "point" and there is nothing to compensate for it.
  return true;
}

/**
 * device scale factor actually to be forced (0 = not enabled).
 *
 * Positive number coverage takes priority; only lock 1 (identity mapping) when real main screen scaling is detected;
 * return 0 if detection fails - it would rather return to screen-by-screen DIP behavior than do scaling without
 * compensation.
 *
 * @param o.forceDsf - Troubleshooting coverage value.
 * @param o.primaryScale - Home screen zoom detected.
 * @returns mandatory value.
 */
function resolveForcedScale(o = {}) {
  const override = Number(o.forceDsf);
  if (Number.isFinite(override) && override > 0) return override;
  return Number(o.primaryScale) > 0 ? 1 : 0;
}

/**
 * renderer's CONFIG.scale = base given by host × physical pixel compensation.
 *
 * Compensation is only made when linearization is indeed in effect and real main screen scaling is detected, otherwise
 * it is equal to the baseline (base default/invalid fallback 1).
 */
function resolvePetScale(o = {}) {
  const base = Number(o.baseScale ?? '1') || 1;
  const forced = Number(o.forcedScale) || 0;
  const primary = Number(o.primaryScale) || 0;
  return forced > 0 && primary > 0 ? base * (primary / forced) : base;
}

module.exports = {
  shouldLinearize,
  resolveForcedScale,
  resolvePetScale,
};
