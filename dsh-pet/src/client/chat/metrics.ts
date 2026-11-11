/**
 * Dimension constants for panels: The only source shared by CSS and JS.
 *
 * The size does not write literals (the specification requires shared constants); the maximum height of the input box
 * has to be read by the automatic height-growing script, so it is placed here instead of writing one copy in the CSS
 * character string.
 * @module dsh-pet/src/client/chat/metrics
 */

/** Panel size and spacing (px). */
export const SIZE = {
  pad: 12,
  padBottom: 10,
  gap: 8,
  gapTight: 6,
  gapWide: 10,
  listGap: 20,
  avatar: 28,
  imgMaxW: 220,
  imgMaxH: 180,
  preview: 48,
  hairline: 2,
  /** The diameter of the circle in the generation of the broadcast button; it is the same height as the time text of 11 px, and does not overwhelm the text. */
  spinner: 12,
  tabPadY: 3,
  tabPadX: 12,
  toolPadY: 2,
  toolPadX: 10,
  bubblePadY: 8,
  bubblePadX: 12,
  composerPad: 10,
  composerPadBottom: 6,
  inputMinH: 44,
  inputMaxH: 140,
  send: 34,
  pillPadY: 4,
  pill: 999,
  /** The padding (vertical and horizontal) of the floating prompt bubble; consistent with the data-tip bubble on the settings page. */
  tipPadY: 6,
  tipPadX: 10,
  /** The maximum width of the floating prompt bubble: omit it if it cannot fit in one line, and do not perform line breaks (line breaks will cause the width to jump with the position). */
  tipMaxW: 260,
  /** The maximum height of the text in the persona roller blind: There is no upper limit for the length of persona. If it exceeds the length, it will scroll inside this area. */
  personaMaxH: 200,
} as const;

/** The upper limit of the input box’s automatic height (px); if it exceeds, it will scroll internally. */
export const INPUT_MAX_HEIGHT = SIZE.inputMaxH;

/** numerical value → px character string. */
export const px = (value: number): string => value + 'px';
