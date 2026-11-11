/**
 * The external exit of the dialog pop-up window: mount, send, style and two types. After splitting into styles / icons
 * / send / image-pick / dom / dialog / hear-hold, this file is only exported again, so that `shared/index.ts`
 * (packaged into window.PetShared) and the browser entry point can each take what they need.
 * @module dsh-pet/src/shared/chat
 */
export type { ChatDialogMount, ChatDialogOptions } from './dialog.ts';
export { mountChatDialog } from './dialog.ts';
export type { EncodedImage } from './encode.ts';
export type { HearHold, HearHoldHooks } from './hear-hold.ts';
export { createHearHold, isHearHotkey } from './hear-hold.ts';
export { dragHasFiles, firstImageFile, firstImageFromClipboard, isImageFile } from './image-pick.ts';
export { CAPTURE_HOTKEY_HINT, CHAT_HOTKEY_HINT, isCaptureHotkey, isChatHotkey, isTypingTarget } from './hotkey.ts';
export type { ChatSendState, ChatAttachment } from './send.ts';
export { sendChat } from './send.ts';
export { CHAT_CSS } from './styles.ts';
