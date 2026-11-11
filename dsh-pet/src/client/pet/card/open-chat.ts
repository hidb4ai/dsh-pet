/**
 * Open the implicit entry point of the conversation: drag and drop on the pet, press L when hovering, and paste a
 * picture when hovering. Only register in the caller lifecycle and remove them all when unmounting; it does not
 * consider itself to be a React component and does not touch the state. The entry point of the menu item is directly
 * connected by the caller, not here.
 * @module dsh-pet/src/client/pet/card/open-chat
 */
import { isChatHotkey, isTypingTarget } from '../../../shared/chat/hotkey.ts';
import { firstImageFromClipboard } from '../../../shared/chat/image-pick.ts';
import { claimFileDragEnter, claimFileDragOver, claimFileDrop } from '../../file-drop.ts';

/** register source. */
export interface OpenChatInput {
  /** Pet stage node; dragging only takes effect on it, leaving drop in other areas to the page itself. */
  readonly stage: HTMLElement | null;
  /** The shortcut key will be responded to only when the hover mark held by the caller is true. */
  readonly isHovered: () => boolean;
  /** Open the conversation; when adding a picture, it will directly enter the pending state. */
  readonly openChat: (image?: File) => void;
}

/**
 * Register drag and drop, shortcut keys and paste.
 *
 * @param input - Stage node, hover determination and opening action.
 * @returns unbinds the function and leaves it to the caller’s effect for cleaning.
 */
export function bindOpenChat(input: OpenChatInput): () => void {
  const { stage, isHovered, openChat } = input;
  const onKeyDown = (e: KeyboardEvent): void => {
    if (!isHovered() || !isChatHotkey(e)) return;
    e.preventDefault();
    openChat();
  };
  const onPaste = (e: ClipboardEvent): void => {
    // If the focus is in the input box, it will be pasted normally. If you grab it, the text will be lost. In that case, there is a pop-up window's own processor.
    if (!isHovered() || isTypingTarget(e.target)) return;
    const file = firstImageFromClipboard(e.clipboardData);
    if (file === undefined) return;
    e.preventDefault();
    openChat(file);
  };
  const onDragOver = (e: DragEvent): void => {
    if (!claimFileDragOver(e)) return;
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  };
  const onDrop = (e: DragEvent): void => {
    const file = claimFileDrop(e);
    if (file !== undefined) openChat(file);
  };
  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('paste', onPaste, true);
  stage?.addEventListener('dragenter', claimFileDragEnter);
  stage?.addEventListener('dragover', onDragOver);
  stage?.addEventListener('drop', onDrop);
  return () => {
    document.removeEventListener('keydown', onKeyDown, true);
    document.removeEventListener('paste', onPaste, true);
    stage?.removeEventListener('dragenter', claimFileDragEnter);
    stage?.removeEventListener('dragover', onDragOver);
    stage?.removeEventListener('drop', onDrop);
  };
}
