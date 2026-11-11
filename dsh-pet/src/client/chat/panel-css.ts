/**
 * CSS text in dialog panel: Only selector and token are written here, no literal color value appears.
 *
 * The size is unified as ./metrics {@link SIZE} (CSS shares a copy with the input box’s automatic height increase). It
 * is separated from styles.ts because this is a pure character string: diff only falls here when changing the style.
 * @module dsh-pet/src/client/chat/panel-css
 */
import { px, SIZE } from './metrics.ts';

/** Panel style (selector prefix `pet-chat` to avoid name collision with DSH or other plugins). */
export const PANEL_CSS = `
.pet-chat-memory-status { flex: none; padding: 8px 10px; border-radius: 8px; background: var(--dsw-alias-bg-module-platform); color: var(--dsw-alias-label-secondary); font-size: 12px; }
.pet-chat-memory-status p { margin: 0 0 4px; }
.pet-chat-memory-status small { font-size: 11px; }
.pet-chat-memory-library > div { max-height: 35vh; overflow: auto; padding: 8px 0; }
.pet-chat-memory-library ul { list-style: none; padding: 0; margin: 8px 0; }
.pet-chat-fact { border-top: 1px solid var(--dsw-alias-border-l2); padding: 10px 0; overflow-wrap: anywhere; }
.pet-chat-fact-actions { display: flex; flex-wrap: wrap; gap: 8px; margin: 6px 0; }
.pet-chat-fact textarea { box-sizing: border-box; width: 100%; min-height: 80px; font: inherit; }
.pet-chat-fact-evidence pre { white-space: pre-wrap; overflow-wrap: anywhere; max-height: 180px; overflow: auto; }
.pet-chat-memory-library button:disabled { cursor: default; opacity: .5; }
.pet-chat-memory-status button { margin-left: 8px; border: 0; background: transparent; color: var(--dsw-alias-state-business-primary); font: inherit; cursor: pointer; }
.pet-chat {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  gap: ${px(SIZE.gapWide)};
  padding: ${px(SIZE.pad)} ${px(SIZE.pad)} ${px(SIZE.padBottom)};
  color: var(--dsw-alias-label-primary);
  font: var(--dsw-font-s-14);
}

.pet-chat-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: ${px(SIZE.gapTight)};
  flex: 0 0 auto;
}

.pet-chat-tab {
  border: 1px solid var(--dsw-alias-border-l2);
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  border-radius: var(--dsw-radius-md);
  padding: ${px(SIZE.tabPadY)} ${px(SIZE.tabPadX)};
  font: var(--dsw-font-xxs-12);
  cursor: pointer;
  transition: background var(--ds-transition-duration-fast) var(--ds-ease-in-out),
    color var(--ds-transition-duration-fast) var(--ds-ease-in-out);
}

.pet-chat-tab:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}

.pet-chat-tab[aria-pressed="true"] {
  background: var(--dsw-alias-bg-multi-select);
  border-color: var(--dsw-alias-border-l3);
  color: var(--dsw-alias-label-primary);
  font-weight: 500;
}

.pet-chat-tools {
  display: flex;
  justify-content: flex-end;
  gap: ${px(SIZE.gapTight)};
  flex: 0 0 auto;
}

/*
 * Persona roller shutter: Push the message list down when expanding, instead of floating on the
 * conversation - persona can be very long, and the floating layer will block the content.
 *    0 fr → 1 fr is the only expansion transition that does not require height measurement; the mezzanine
 * layer is responsible for cropping, and the text layer only places padding and borders.
 *    Otherwise, padding and border are still there when folded, leaving a gap.
 */
.pet-chat-persona {
  display: grid;
  grid-template-rows: 0fr;
  flex: 0 0 auto;
  transition: grid-template-rows var(--ds-transition-duration-fast) var(--ds-ease-in-out);
}

.pet-chat-persona.is-open {
  grid-template-rows: 1fr;
}

.pet-chat-persona-clip {
  min-height: 0;
  overflow: hidden;
}

.pet-chat-persona-body {
  max-height: ${px(SIZE.personaMaxH)};
  overflow-y: auto;
  padding: ${px(SIZE.bubblePadY)} ${px(SIZE.bubblePadX)};
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-module-platform);
  color: var(--dsw-alias-label-primary);
  font: var(--dsw-font-s-14);
  line-height: 1.6;
  /*
   * Persona text has its own line breaks and indents: retain the typesetting, and long words must be able to
   * be separated from URL
   */
  white-space: pre-wrap;
  word-break: break-word;
}

.pet-chat-orphans {
  display: flex;
  align-items: center;
  gap: ${px(SIZE.gap)};
  flex: 0 0 auto;
  padding: ${px(SIZE.gapTight)} ${px(SIZE.tabPadX)};
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-multi-select);
  color: var(--dsw-alias-label-secondary);
  font: var(--dsw-font-xxs-12);
}

.pet-chat-confirm {
  display: flex;
  align-items: center;
  gap: ${px(SIZE.gap)};
  flex: 0 0 auto;
  padding: ${px(SIZE.gapTight)} ${px(SIZE.tabPadX)};
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-interactive-bg-hover-danger);
  color: var(--dsw-alias-label-primary);
  font: var(--dsw-font-xxs-12);
}

.pet-chat-danger {
  flex: 0 0 auto;
  border: none;
  border-radius: var(--dsw-radius-sm);
  background: var(--dsw-alias-state-error-primary);
  color: var(--dsw-alias-label-primary-foreground);
  padding: ${px(SIZE.toolPadY)} ${px(SIZE.tabPadX)};
  font: var(--dsw-font-xxs-12);
  cursor: pointer;
  transition: background var(--ds-transition-duration-fast) var(--ds-ease-in-out);
}

.pet-chat-danger:hover {
  background: var(--dsw-alias-state-error-secondary);
}

.pet-chat-confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: ${px(SIZE.gap)};
}

/*
 * Guide page card icon: The slot given by the framework is only typed according to the icon size, so let
 * logo fill it
 */
.pet-chat-guide-icon {
  width: 100%;
  height: 100%;
  object-fit: contain;
  border-radius: var(--dsw-radius-xs);
  display: block;
}

.pet-chat-tool {
  border: 1px solid var(--dsw-alias-border-l2);
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  border-radius: var(--dsw-radius-sm);
  padding: ${px(SIZE.toolPadY)} ${px(SIZE.toolPadX)};
  font: var(--dsw-font-xxs-12);
  cursor: pointer;
}

.pet-chat-tool:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
}

.pet-chat-tool[aria-pressed="true"] {
  background: var(--dsw-alias-bg-multi-select);
  border-color: var(--dsw-alias-border-l3);
  color: var(--dsw-alias-label-primary);
}

.pet-chat-tool:disabled {
  opacity: 0.5;
  cursor: default;
}

.pet-chat-list {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: ${px(SIZE.listGap)};
  padding-right: ${px(SIZE.hairline)};
}

.pet-chat-older {
  display: flex;
  justify-content: center;
  flex: 0 0 auto;
}

.pet-chat-older-btn {
  border: none;
  border-radius: ${px(SIZE.pill)};
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-secondary);
  padding: ${px(SIZE.pillPadY)} ${px(SIZE.tabPadX)};
  font: var(--dsw-font-xxs-12);
  cursor: pointer;
  transition: background var(--ds-transition-duration-fast) var(--ds-ease-in-out);
}

.pet-chat-older-btn:hover {
  background: var(--dsw-alias-interactive-bg-active);
}

.pet-chat-older-note {
  color: var(--dsw-alias-label-tertiary);
  font: var(--dsw-font-xxs-12);
  padding: ${px(SIZE.pillPadY)} 0;
}

.pet-chat-memory {
  display: flex;
  align-items: center;
  gap: ${px(SIZE.gap)};
  flex: 0 0 auto;
  color: var(--dsw-alias-label-caption);
  font: var(--dsw-font-xxxs-11);
}

/*
 * The line itself is drawn with pseudo elements, and the text is centered: visually it is "a dividing line
 * with an explanation"
 */
.pet-chat-memory::before,
.pet-chat-memory::after {
  content: '';
  flex: 1 1 auto;
  border-top: 1px dashed var(--dsw-alias-border-l3);
}

.pet-chat-memory-note {
  flex: 0 0 auto;
}

.pet-chat-round {
  display: flex;
  align-items: flex-start;
  gap: ${px(SIZE.gap)};
}

/*
 * Multi-selection mode: The whole round is a clickable card; selected will have a light background, and
 * unselected will be transparent (consistent with the selection style of the bean bag)
 */
.pet-chat-round.is-selecting {
  padding: ${px(SIZE.gapTight)} ${px(SIZE.gapWide)};
  border-radius: var(--dsw-radius-md);
  cursor: pointer;
  transition: background var(--ds-transition-duration-fast) var(--ds-ease-in-out);
}

.pet-chat-round.is-selecting:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}

.pet-chat-round.is-selected {
  background: var(--dsw-alias-bg-multi-select);
}

.pet-chat-pick {
  flex: 0 0 auto;
  padding-top: ${px(SIZE.gapTight)};
  opacity: 0.55;
  cursor: pointer;
}

.pet-chat-pick:hover {
  opacity: 1;
}

.pet-chat-round-body {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: ${px(SIZE.gap)};
}

.pet-chat-msg {
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  gap: ${px(SIZE.gap)};
  max-width: 92%;
}

.pet-chat-msg.is-me {
  align-self: flex-end;
  flex-direction: row-reverse;
}

.pet-chat-msg.is-pet {
  align-self: flex-start;
}

.pet-chat-avatar {
  flex: 0 0 auto;
  width: ${px(SIZE.avatar)};
  height: ${px(SIZE.avatar)};
  border-radius: 50%;
  object-fit: cover;
}

.pet-chat-msg.is-pet .pet-chat-avatar {
  border: 1px solid var(--dsw-alias-border-l2);
}

.pet-chat-bubble {
  padding: ${px(SIZE.bubblePadY)} ${px(SIZE.bubblePadX)};
  border-radius: var(--dsw-radius-md);
  word-break: break-word;
  line-height: 1.6;
}

.pet-chat-text {
  white-space: pre-wrap;
}

.pet-chat-msg.is-me .pet-chat-bubble {
  background: var(--dsw-specific-bubble);
  color: var(--dsw-alias-label-primary);
}

.pet-chat-msg.is-pet .pet-chat-bubble {
  background: var(--dsw-alias-bg-module-platform);
  color: var(--dsw-alias-label-primary);
}

.pet-chat-img-btn {
  display: block;
  margin-top: ${px(SIZE.gapTight)};
  padding: 0;
  border: none;
  background: none;
  cursor: zoom-in;
}

.pet-chat-img {
  display: block;
  max-width: ${px(SIZE.imgMaxW)};
  max-height: ${px(SIZE.imgMaxH)};
  border-radius: var(--dsw-radius-sm);
  object-fit: contain;
}

.pet-chat-time {
  display: inline-flex;
  align-items: center;
  gap: ${px(SIZE.gap)};
  margin-top: ${px(SIZE.hairline)};
  font: var(--dsw-font-xxxs-11);
  color: var(--dsw-alias-label-caption);
}

/*
 * The broadcast/action button on the right side of the time: the same font size as the time, relying on
 * transparency and color to convey meaning, and does not occupy additional line height
 */
.pet-chat-speak,
.pet-chat-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: ${px(SIZE.hairline * 12)};
  height: ${px(SIZE.hairline * 12)};
  border: 0;
  padding: 0;
  background: transparent;
  font: inherit;
  line-height: 1;
  color: inherit;
  cursor: pointer;
  opacity: 0.55;
  transition:
    opacity 0.15s,
    color 0.15s;
}

.pet-chat-speak:hover,
.pet-chat-action:hover {
  opacity: 1;
}

/*
 * Action key icon: Inline SVG solid color triangle, the color follows the inline text.
 *    Switching to emoji (▶️) will render it into a colored square, which creates two styles when placed
 * together with the speaker.
 */
.pet-chat-action-icon {
  display: block;
  width: ${px(SIZE.hairline * 5)};
  height: ${px(SIZE.hairline * 5)};
}

/*
 * Generating: Only the upper half of the thin ring is colored, which expresses "generating" by rotating.
 *    The size is the same height as the time text; border-box + flex:none is required: by default
 * content-box will count the stroke outside the size.
 *    When compressed in the flex row, the ring will turn into an ellipse, which looks like a "strange
 * rounded square".
 */
.pet-chat-speak.is-loading {
  opacity: 0.9;
  cursor: default;
}

.pet-chat-speak.is-loading::before {
  content: '';
  box-sizing: border-box;
  flex: none;
  width: ${px(SIZE.spinner)};
  height: ${px(SIZE.spinner)};
  border: 1.5px solid var(--dsw-alias-border-l2);
  border-top-color: var(--dsw-alias-label-secondary);
  border-radius: 50%;
  animation: pet-chat-spin 0.8s linear infinite;
}

/*
 * Playing: Main color + full opacity, clearly distinguished from "playable"
 */
.pet-chat-speak.is-playing {
  opacity: 1;
  color: var(--dsw-alias-state-business-primary);
  cursor: default;
}

/*
 * Failure: Darkening means failure, but you can still click (retry), so the pointer remains in the hand
 * shape
 */
.pet-chat-speak.is-failed {
  opacity: 0.5;
}

@keyframes pet-chat-spin {
  to {
    transform: rotate(360deg);
  }
}

.pet-chat-time.is-pet {
  align-self: flex-start;
  /*
   * Align with the left edge of the pet bubble: make the time clearly belong to the answers of this round,
   * rather than the beginning of the next round of questions
   */
  margin-left: ${px(SIZE.avatar + SIZE.gap)};
}

.pet-chat-time.is-me {
  align-self: flex-end;
}

.pet-chat-hint {
  color: var(--dsw-alias-label-tertiary);
  font: var(--dsw-font-xxs-12);
}

.pet-chat-error {
  color: var(--dsw-alias-state-error-primary);
  font: var(--dsw-font-xxs-12);
}

.pet-chat-composer {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  gap: ${px(SIZE.gapTight)};
  padding: ${px(SIZE.composerPad)} ${px(SIZE.pad)} ${px(SIZE.composerPadBottom)};
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-xl);
  background: var(--dsw-specific-input-major);
  transition: border-color var(--ds-transition-duration-fast) var(--ds-ease-in-out);
}

.pet-chat-composer:focus-within {
  border-color: var(--dsw-alias-state-business-primary);
}

.pet-chat-composer.is-drop-target {
  border-color: var(--dsw-alias-state-business-primary);
}

.pet-chat-preview {
  display: flex;
  align-items: center;
  gap: ${px(SIZE.gap)};
}

.pet-chat-preview-img {
  width: ${px(SIZE.preview)};
  height: ${px(SIZE.preview)};
  object-fit: cover;
  border-radius: var(--dsw-radius-sm);
  border: 1px solid var(--dsw-alias-border-l2);
}

.pet-chat-preview-meta {
  font: var(--dsw-font-xxxs-11);
  color: var(--dsw-alias-label-tertiary);
}

.pet-chat-input {
  width: 100%;
  resize: none;
  border: none;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  padding: 0;
  min-height: ${px(SIZE.inputMinH)};
  max-height: ${px(SIZE.inputMaxH)};
  overflow-y: auto;
  font: var(--dsw-font-s-14);
  outline: none;
}

.pet-chat-input::placeholder {
  color: var(--dsw-alias-label-tertiary);
}

.pet-chat-composer-bar {
  display: flex;
  align-items: center;
  gap: ${px(SIZE.gap)};
}

.pet-chat-attach {
  display: inline-flex;
  align-items: center;
  gap: ${px(SIZE.hairline)};
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: ${px(SIZE.pill)};
  padding: ${px(SIZE.pillPadY)} ${px(SIZE.tabPadX)};
  font: var(--dsw-font-xxs-12);
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  user-select: none;
  transition: background var(--ds-transition-duration-fast) var(--ds-ease-in-out);
}

.pet-chat-attach:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}

.pet-chat-file {
  display: none;
}

.pet-chat-composer-spacer {
  flex: 1 1 auto;
}

.pet-chat-send {
  flex: 0 0 auto;
  width: ${px(SIZE.send)};
  height: ${px(SIZE.send)};
  display: grid;
  place-items: center;
  border: none;
  border-radius: 50%;
  background: var(--dsw-alias-button-info-fill);
  color: var(--dsw-alias-label-primary-foreground);
  cursor: pointer;
  transition: background var(--ds-transition-duration-fast) var(--ds-ease-in-out),
    opacity var(--ds-transition-duration-fast) var(--ds-ease-in-out);
}

.pet-chat-send:hover:not(:disabled) {
  background: var(--dsw-alias-button-info-hover);
}

.pet-chat-send:disabled {
  opacity: 0.45;
  cursor: default;
}

/*
 * Generating: The input text is pressed into a three-level color, and the circle is used to indicate "This
 * sentence has been sent, and we are waiting for a reply."
 *    The input box itself is still editable (you can type the next sentence first), so only the color is
 * changed, not pointer-events : none.
 */
.pet-chat-composer.is-busy .pet-chat-input {
  color: var(--dsw-alias-label-tertiary);
}

/*
 * The circle in the send key: shared with the broadcast button pet-chat-spin, only half a circle arc is
 * drawn.
 *     box-sizing must be border-box, otherwise the 1.5 px stroke will enlarge the 12 px, making it look too
 * big in the 34 px round button.
 */
.pet-chat-send-spinner {
  box-sizing: border-box;
  width: ${px(SIZE.spinner)};
  height: ${px(SIZE.spinner)};
  border: 1.5px solid transparent;
  border-top-color: currentColor;
  border-right-color: currentColor;
  border-radius: 50%;
  animation: pet-chat-spin 0.8s linear infinite;
}

/*
 * Floating prompt bubble: Hang on body and position it with the cursor (see ./ tooltip), not in . pet-chat.
 *    So the fonts and colors are all built-in - bubble has a dark background, and both themes rely on the
 * contrast between the white text and the background to be read.
 */
.pet-chat-tip {
  position: fixed;
  z-index: 2147483000;
  max-width: ${px(SIZE.tipMaxW)};
  padding: ${px(SIZE.tipPadY)} ${px(SIZE.tipPadX)};
  border-radius: var(--dsw-radius-sm);
  background: var(--dsw-alias-tooltip-bg);
  color: var(--dsw-static-neutral-00);
  font: var(--dsw-font-xxs-12);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  pointer-events: none;
  opacity: 0;
  transition: opacity var(--ds-transition-duration-fast) var(--ds-ease-in-out);
}

.pet-chat-tip.is-on {
  opacity: 1;
}
`;
