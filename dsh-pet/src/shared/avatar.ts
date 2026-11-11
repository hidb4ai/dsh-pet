/**
 * The only assemble location for the pet avatar address: it is used for both the message avatar in the chat panel and
 * the preview of the settings page.
 *
 * Do not put it in client/chat: the settings page must also be used, and the settings page should not rely on the data
 * access module of the dialog panel.
 * @module dsh-pet/src/shared/avatar
 */
import { ROUTE_PATH } from './constants.ts';

/** Plugin logo address: The default image sent back by the host when no avatar has been uploaded. */
export const LOGO_URL = ROUTE_PATH + '/logo';

/**
 * Pet avatar address: According to the asset root, if it has not been uploaded before, the host will fall back to the
 * default logo.
 *
 * The parameter name is deliberately `root` instead of `pet` : it is not the same as `pet` (pet instance id, such as
 * `main` ) of other endpoints. Here is the asset root (directory prefix, such as `baimao` ). If the same name is not
 * synonymous, the third party will silently get the default image after calling it according to the existing semantics
 * of `pet` .
 *
 * `v` is only used to break the cache - after changing the avatar, the same URL will be remembered by the browser, and
 * the image will be re-fetched only with the version number of this rendering.
 *
 * @param assetRoot - the entry to which the pet belongs (asset root); the empty string is treated as "only the default
 * logo".
 * @param version - The version number of this rendering, change it when the panel is opened/refreshed/uploaded
 * successfully.
 */
export function avatarUrl(assetRoot: string, version: number): string {
  const root = assetRoot.trim();
  const query = root === '' ? '' : 'root=' + encodeURIComponent(root) + '&';
  return ROUTE_PATH + '/logo?' + query + 'v=' + version;
}
