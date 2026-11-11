/**
 * Shared constant leaves: canvas geometry, playback extension and plugin HTTP mount path. The path has different
 * semantics for both ends - host only recognizes the route segment of the server, and the browser only has the mount
 * prefix, so it is split into two exports. No import module: The host side directly references this file without going
 * through the shared/index bucket (there is DOM mounting code in the bucket).
 * @module dsh-pet/src/shared/constants
 */
/** thumb canvas height. */
export const CANVAS_H = 360;
/** thumb y coordinates of the soles of the feet on the canvas (the character stands on the y =330 line). */
export const FEET_Y = 330;
/** Click and drag hit rectangle (thumb 640×360 pixel coordinates). */
export const HIT_BOX = { x0: 200, y0: 50, x1: 440, y1: 335 };
/** Drag judgment threshold (px). */
export const DRAG_THRESHOLD = 5;
/**
 * Visible lower limit of out-of-bounds placement (px): Leave at least this much of the hit area in the visible area,
 * which can only be obtained by right-clicking. The web page is clamped by clampReachableBox when submitting the
 * position, and the desktop is positioned by the window and leaves the border according to the same rule.
 */
export const MIN_REACHABLE_PX = 24;
/**
 * Slingshot window (ms): If the interval between two presses is less than this, the slingshot will be pressed. It has
 * nothing to do with how long you drag it or when you let go. Only the left button is recognized, and there is no
 * pulling state (see physics.ts for conversion).
 */
export const SLINGSHOT_DOUBLE_MS = 200;
/**
 * Scaling reference for moving distance (px): minDist/maxDist in the configuration is the pixels under the base pet
 * width of 462 px. When running, it is scaled according to the "actual size/base" ratio. The distance traveled under
 * any scaling is proportional to the size of the character itself.
 */
export const PET_REF_WIDTH = 462;

/**
 * The route segment of host register: server path, never with browser mounting prefix. Use it for route register,
 * matching, and desktop/standalone mode address spelling; addresses with prefixes are wrong on the server side.
 */
export const ROUTE_SEGMENT = '/dsh-pet-7340';

/**
 * Take the mount prefix from the document base address (directory part of baseURI).
 *
 * dsh injects `<base href="./">` when returning index, so baseURI is exactly "the directory where the host provides
 * UI", which is also the benchmark for browsers to parse relative requests; when the reverse generation/application
 * gateway hangs UI in the subpath, this prefix is missing.
 *
 * @param baseURI - Document base address; neither the host main process nor the desktop local page nor the Node test
 * have it.
 * @returns removes the directory part of the trailing slash; empty strings, non-http (s), and invalid addresses are
 * all `''` , and no exception is thrown.
 */
export function mountPrefixOf(baseURI: string | undefined): string {
  if (baseURI === undefined || baseURI === '') return '';
  try {
    const url = new URL(baseURI);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    return url.pathname.replace(/\/+$/, '');
  } catch {
    return '';
  }
}

/**
 * Calculate the browser side address in one place: mount prefix + route segment, used for module loading and single
 * testing.
 *
 * @param baseURI - document base address; by default, it is processed without prefix.
 * @returns is the common prefix between request and asset, in the form of `/app/x/dsh-pet-7340` .
 */
export function routePathOf(baseURI: string | undefined): string {
  return mountPrefixOf(baseURI) + ROUTE_SEGMENT;
}

/**
 * Browser side address: request, asset and CSS url() are all parsed according to the document benchmark and must have
 * a mount prefix. The three places without `document` (host, main process side of desktop Helper, standalone mode)
 * obtain pure route segments.
 */
export const ROUTE_PATH = routePathOf(typeof document === 'undefined' ? undefined : document.baseURI);

/**
 * Play animation extension (centralized switch): The default . webm ( VP9-alpha ) can be played directly and
 * transparently at both ends; macOS’s Safari/WKWebView does not recognize webm alpha (rendering black background), and
 * needs to be changed to . mov ( HEVC-with-Alpha ) - asset from the warehouse Take the assets-mov tag of Release, put
 * it into main-animation/mov / and rebuild it; npm contains the constants of the same name in the product that users
 * can modify.
 */
export const ANIMATION_EXT = '.webm';
