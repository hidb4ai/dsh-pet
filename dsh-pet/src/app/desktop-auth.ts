/**
 * Access credential injection for desktop application outbound requests.
 *
 * It is only responsible for attaching tokens to requests "initiated by the local renderer and targeting the plugin
 * route"; it does not generate or verify tokens (verification is done on the host route side). Rely on Electron's
 * session request interception and file:// rendering page. Always true: the token only enters the request header, and
 * is only effective for the plugin route whose top-level renderer points to the local origin. The redirect target is
 * not carried.
 * @module dsh-pet/src/app/desktop-auth
 */

import { pathToFileURL } from 'node:url';
import { ROUTE_SEGMENT } from '../shared/constants.ts';

/** The minimum form of an outbound request: only declare the fields that need to be read to inject credentials. */
interface RequestDetails {
  url: string;
  requestHeaders: Record<string, string>;
  frame?: { url: string; parent: unknown } | null;
}

/** main process defaults to the smallest form of session (only request header interception is used). */
export interface DesktopSession {
  webRequest: {
    onBeforeSendHeaders(
      listener: (
        details: RequestDetails,
        callback: (response: { requestHeaders: Record<string, string> }) => void,
      ) => void,
    ): void;
  };
}

/**
 * Attach an access token to requests for native top-level file renderer access plugin route.
 *
 * The target origin, the plugin route section, the top-level frame and the rendering page address must match at the
 * same time. If any of them is not satisfied, no token will be added; first delete the request header with the same
 * name and then write it as needed to prevent the caller's own pseudo-token from being taken to other targets.
 *
 * @param session - main process Default session (outbound request interception).
 * @param origin - native service origin.
 * @param rendererPath - Desktop Helper Absolute path to the rendering page.
 * @param token - Access token.
 */
export function installDesktopAuth(session: DesktopSession, origin: string, rendererPath: string, token: string): void {
  const renderer = pathToFileURL(rendererPath).href;
  session.webRequest.onBeforeSendHeaders((details, callback) => {
    const headers = { ...details.requestHeaders };
    // Redirected requests must not take credentials to other targets.
    for (const name of Object.keys(headers)) {
      if (name.toLowerCase() === 'x-dsh-pet-token') delete headers[name];
    }
    try {
      const target = new URL(details.url);
      const frame = details.frame;
      const page = frame ? new URL(frame.url) : undefined;
      if (
        target.origin === origin &&
        target.pathname.startsWith(ROUTE_SEGMENT + '/') &&
        frame?.parent === null &&
        page?.protocol === 'file:' &&
        page.origin === 'null' &&
        page.href.split(/[?#]/, 1)[0] === renderer
      ) {
        headers['X-DSH-Pet-Token'] = token;
      }
    } catch {
      // When frame is missing/destroyed or the address is invalid, the voucher will not be granted.
    }
    callback({ requestHeaders: headers });
  });
}
