/**
 * The address of the animation asset assemble: if the playback request gives the complete url, use it, otherwise press
 * "asset root + animation name + extension" to spell host route. Both paragraphs pass `encodeURIComponent` - Chinese
 * characters and spaces are allowed in the animation name and asset root. Without encoding, the route will not match.
 * The extension is passed in after detection by caller (`thumbExt()` reads UA). This module does not touch the browser
 * environment.
 * @module dsh-pet/src/client/pet/animation/assets
 */
import { ROUTE_PATH } from '../../../shared/constants.ts';

/** Input of asset address. */
export interface AssetSource {
  /** The complete address given by the third-party playback request (has been restricted by host http/https); if given, it will be used first. */
  cueUrl?: string | null;
  /** asset root (= configuration file prefix); multiple instances share the same asset directory. */
  assetRoot: string;
  /** Pet id, fallback when asset root is missing. */
  id: string;
  /** Animation name. */
  anim: string;
  /** Extension (including dots, such as `.webm`). */
  ext: string;
}

/**
 * The asset address of the animation.
 *
 * @param source - address source and identification.
 * @returns can directly address fetch; `cueUrl` takes precedence.
 */
export function animationAssetUrl(source: AssetSource): string {
  if (source.cueUrl) return source.cueUrl;
  const root = source.assetRoot === '' ? source.id : source.assetRoot;
  return ROUTE_PATH + '/thumb/' + encodeURIComponent(root) + '/' + encodeURIComponent(source.anim) + source.ext;
}
