/**
 * Container format detection of animation assets: decide whether to use `.mov` (HEVC-alpha) or `.webm` (VP9-alpha) for
 * this session. Only WebKit (Safari / WKWebView) of macOS and iOS need mov - `canPlayType` cannot be judged: Safari
 * can decode VP9 webm but will discard alpha , showing a black background; "can be decoded" and "transparent is still
 * there" are two different things, the latter does not have Web API to query. The judgment results are cached once per
 * session, and the extension will not change back and forth during operation.
 * @module dsh-pet/src/client/pet/animation/media
 */
import { ANIMATION_EXT } from '../../../shared/constants.ts';

/** The extension has been decided in this session, `null` = Not yet decided. */
let resolvedExt: string | null = null;

/**
 * Whether mov is required first: macOS and WebKit of iOS are required; the rest are processed as Chromium/Firefox.
 *
 * @returns returns true when HEVC-alpha is required.
 */
export function prefersMov(): boolean {
  const ua = navigator.userAgent;
  // All browsers on iOS (including CriOS / FxiOS / EdgiOS) are WebKit, and alpha is also discarded; it must be ranked
  // before the exclusion below, otherwise FxiOS will be misjudged as native support.
  if (/iPhone|iPad|iPod/i.test(ua)) return true;
  // Chromium, including Electron, and Firefox support VP9 alpha natively and do not require MOV assets.
  if (/Chrome|Chromium|Edg|OPR|Firefox|FxiOS/i.test(ua)) return false;
  return /Mac/i.test(navigator.platform || ua); // The rest are processed as WebKit and limited to macOS.
}

/**
 * Get the animation extension (including dots) used in this session. Explicit constants take precedence, otherwise
 * they are judged by renderer. The host will return `.webm` with the same name for the missing `.mov` , so here we
 * just focus on "which one you want".
 *
 * @returns `.mov` or `.webm` .
 */
export function thumbExt(): string {
  if (resolvedExt === null) {
    // The static type of ANIMATION_EXT is narrowed to '. webm', but the user will change it to . mov; this explicit
    // intention can only be expressed by reading string, otherwise TS will be judged as constant inequality.
    const explicit: string = ANIMATION_EXT;
    resolvedExt = explicit === '.mov' || prefersMov() ? '.mov' : '.webm';
  }
  return resolvedExt;
}
