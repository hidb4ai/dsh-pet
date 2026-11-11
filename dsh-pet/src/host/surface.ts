/**
 * Determination of "Which end is this pet displayed on?": the alignment, visibility of `?surface=` , and which end
 * should read this sentence.
 *
 * Responsible for turning "necessarily impossible" into an explicit failure (pet-not-displayed + actual display) in
 * advance. It is pure logic and can be tested offline. We are not responsible for distributing content on a
 * face-to-face basis: the instructions are still written into the same leaf, and the content at both ends is still
 * exactly the same; if you want to broadcast different content at both ends, use two pets to express it. There are no
 * dependencies; only the host is used, so there is no need to write a copy with src/shared. Always true: surface is
 * required (any is an explicit way of saying "don't care which end", not omitted); `web` / `desktop` / `both` still
 * rejects `display: none` , and only `any` is allowed - consumers such as dialogue windows who do not see the
 * rendering results use `any` .
 *
 * @module dsh-pet/src/host/surface
 */

/** The renderer expected by caller (four values of `?surface=`). */
export type Surface = 'web' | 'desktop' | 'both' | 'any';

/** Valid value, verification and text share one copy. */
export const SURFACES: readonly Surface[] = ['web', 'desktop', 'both', 'any'];

/** Default/invalid prompt text. */
export const SURFACE_TEXT = 'surface 必填：web / desktop / both / any';

/** The value is narrowed: only four literals are recognized. Uppercase and lowercase, blank, and non-character strings are not counted. If they are not recognized, null will be returned. */
export function normalizeSurface(v: unknown): Surface | null {
  return typeof v === 'string' && (SURFACES as readonly string[]).includes(v) ? (v as Surface) : null;
}

/**
 * Does the pet’s display meet the caller’s expectations?
 *
 * `any` does not look at the display mode (including none): the caller does not look at the rendering results. The
 * remaining three values are narrowed according to display; invalid display will not be satisfied (configuration
 * verification will block it, here it is only defended).
 */
export function displayCovers(want: Surface, display: string): boolean {
  switch (want) {
    case 'any':
      return display === 'web' || display === 'desktop' || display === 'both' || display === 'none';
    case 'web':
      return display === 'web' || display === 'both';
    case 'desktop':
      return display === 'desktop' || display === 'both';
    case 'both':
      return display === 'both';
  }
}

/** Which end of a conversation should be pronounced; the combination with the same name as src/shared/state is two copies (host is not import src/shared), and both sides should be changed together when changing. */
export type VoiceTarget = 'web' | 'desktop';

/**
 * Is the pet's display visible on either end; `none` = not displayed at all.
 *
 * Just looking at the configuration has nothing to do with "whether anyone is watching at this moment" - the host has
 * no way of knowing and should not rely on guessing.
 * @param display - The display value for the pet instance.
 */
export function isDisplayed(display: string): boolean {
  return displayCovers('web', display) || displayCovers('desktop', display);
}

/**
 * Choose which side should read this sentence: Desktop priority, only when the desktop is not displayed will you
 * return to the web page.
 *
 * Desktop priority is a usability judgment rather than a preference: as long as helper is running on the desktop,
 * there will be a window, and the web page may be closed at any time. In turn, "the command is sent to a non-existent
 * consumer" will often appear.
 * @param display - The display value of the pet instance.
 * @returns One end of the word; when both ends are not displayed, `null` (the caller should use {@link isDisplayed} to
 * block it before generating).
 */
export function pickVoiceSurface(display: string): VoiceTarget | null {
  if (displayCovers('desktop', display)) return 'desktop';
  if (displayCovers('web', display)) return 'web';
  return null;
}

/**
 * Change `?surface=` in the request to "Which side should you read it from?"
 *
 * `web` / `desktop` is a specific end and is implemented as it is; `both` is "I am on both ends" and `any` is "I don't
 * care which end". Both are not enough to specify the consumer of one end. Return to `undefined` and hand over the
 * caller to deduce according to display.
 * @param want - A request surface that has been narrowed by {@link normalizeSurface} .
 * @returns is one end of the thought; when it cannot be determined, it is `undefined` .
 */
export function voiceTargetOfSurface(want: Surface): VoiceTarget | undefined {
  return want === 'web' || want === 'desktop' ? want : undefined;
}
