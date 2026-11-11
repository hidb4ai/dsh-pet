/**
 * DOM configuration of the dialog pop-up window: input box, upload/screenshot/press and hold three buttons, image
 * thumbnail to be sent, prompt line and error line. Only create elements and connect capabilities, without sending,
 * positioning, or closing; the recording state machine is at chat/hear-control.
 * @module dsh-pet/src/shared/chat/dom
 */
import { type EncodedImage, encodeImageFile } from './encode.ts';
import { createHearControl } from './hear-control.ts';
import { IMAGE_ACCEPT, firstImageFromClipboard, isImageFile } from './image-pick.ts';
import { cameraIcon, micIcon, pictureIcon } from './icons.ts';
import type { ChatAttachment } from './send.ts';
import { CHAT_H_PAD, CHAT_MAX_W, CHAT_MIN_W } from './styles.ts';

/** Prompt the time of automatic closing (ms). */
const HINT_MS = 2200;

/** Elements and behaviors used in pop-up windows; the mounting function is only wired as needed and does not recreate DOM. */
export interface ChatDom {
  readonly root: HTMLDivElement;
  readonly input: HTMLTextAreaElement;
  readonly err: HTMLDivElement;
  readonly shotBtn: HTMLButtonElement;
  /** The input box and root width adapt to the text; call it once after attaching it to the document, and automatically recalculate when inputting. */
  readonly resizeInput: () => void;
  /** Clear the picture to be sent (including the value of file input). */
  readonly clearAttach: () => void;
  /** Put in a picture to be sent (shared by uploading, dragging, and pasting); when the type is not accepted or the encoding fails, it prompts and returns false. */
  readonly setImageFile: (file: File) => Promise<boolean>;
  /** Put in an encoded picture (take this screenshot: there is no File, only base64). */
  readonly setEncoded: (encoded: EncodedImage) => boolean;
  /** The picture currently to be sent; if not undefined. */
  readonly getAttachment: () => ChatAttachment | undefined;
  /** Whether it is encoding: You need to wait for it to end before sending, otherwise the message will miss the picture. */
  readonly isEncoding: () => boolean;
  /** Temporary prompt (not an error), automatically closed after timeout. */
  readonly flash: (text: string) => void;
  /** Open recording from outside (use the shortcut key "Hold and Talk"); give a reason when recording fails, and do nothing while recording. */
  readonly startHear: () => void;
  /** Cleanup from outside (shortcut key to release); nothing will be done when not recording. */
  readonly stopHear: () => void;
  /** Is it really collecting at this moment? The global shortcut key synthesizes an action of "on/off" accordingly. */
  readonly isHearing: () => boolean;
  /** Put away the prompt, stop the ongoing recording and clear the timer; called when closing the pop-up window. */
  readonly dispose: () => void;
}

/** Create an icon button (icon + accessibility label). */
function iconButton(title: string, icon: SVGElement): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'dsh-pet-chat-btn';
  btn.title = title;
  btn.setAttribute('aria-label', title);
  btn.appendChild(icon);
  return btn;
}

/** The width of the input box adapts to the text: the width is based on the measured value, and the height is used to catch the line break after capping. */
function enableAutoResize(input: HTMLTextAreaElement, root: HTMLElement): () => void {
  let measureCtx: CanvasRenderingContext2D | null = null;
  const resize = (): void => {
    const ctx =
      measureCtx ?? (measureCtx = document.createElement('canvas').getContext('2d') as CanvasRenderingContext2D);
    ctx.font = getComputedStyle(input).font; // Get the current calculation style each time (accurate before and after mounting)
    const textW = ctx.measureText(input.value || ' ').width;
    const w = Math.max(CHAT_MIN_W, Math.min(Math.ceil(textW + CHAT_H_PAD), CHAT_MAX_W));
    root.style.width = w + 'px'; // Root width follows → Clamp back still according to actual width
    input.style.height = 'auto';
    input.style.height = Math.max(input.scrollHeight, 22) + 'px';
  };
  input.addEventListener('input', resize);
  return resize;
}

/**
 * Create all the elements of the pop-up window and hang them under `document.body` .
 *
 * @param opts - Optional screenshot implementation (the button only gives a "not supported by the current environment"
 * prompt when not uploading) and identification address
 * (When the recording fails, press and hold the talk button, and click it to give a reason).
 * @returns element reference and behavior (clean attachments, temporary prompts, adaptive, release timer).
 */
export function createChatDom(opts: { capture?: () => Promise<EncodedImage>; hearUrl?: string } = {}): ChatDom {
  const root = document.createElement('div');
  root.className = 'dsh-pet-chat';

  const input = document.createElement('textarea');
  input.className = 'dsh-pet-chat-input';
  input.placeholder = '说点什么…';
  input.maxLength = 2000;
  input.rows = 1;

  const err = document.createElement('div');
  err.className = 'dsh-pet-chat-err';
  err.style.display = 'none';

  const hint = document.createElement('div');
  hint.className = 'dsh-pet-chat-hint';
  let hintTimer = 0;
  /** Permanent prompt: It is always displayed during recording and recognition, and is collected by the calling point. */
  const showHint = (text: string): void => {
    window.clearTimeout(hintTimer);
    hint.textContent = text;
    hint.style.display = 'block';
  };
  const hideHint = (): void => {
    window.clearTimeout(hintTimer);
    hint.style.display = 'none';
  };
  const flash = (text: string): void => {
    showHint(text);
    hintTimer = window.setTimeout(hideHint, HINT_MS);
  };

  const pickBtn = iconButton('上传图片', pictureIcon());
  const shotBtn = iconButton('截取当前屏幕', cameraIcon());
  const hearUrl = typeof opts.hearUrl === 'string' ? opts.hearUrl : '';
  const micBtn = iconButton('按住说话', micIcon());
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = IMAGE_ACCEPT;
  fileInput.style.display = 'none';

  const attach = document.createElement('div');
  attach.className = 'dsh-pet-chat-attach';
  const thumb = document.createElement('img');
  thumb.className = 'dsh-pet-chat-thumb';
  thumb.alt = '已选图片';
  const attachX = document.createElement('button');
  attachX.type = 'button';
  attachX.className = 'dsh-pet-chat-attach-x';
  attachX.textContent = '✕';
  attachX.title = '移除图片';
  attachX.setAttribute('aria-label', '移除图片');
  attach.append(thumb, attachX);

  const actions = document.createElement('div');
  actions.className = 'dsh-pet-chat-actions';
  actions.append(pickBtn, shotBtn, micBtn, fileInput, attach);

  root.append(input, actions, hint, err);
  document.body.appendChild(root);

  const resizeInput = enableAutoResize(input, root);

  let attachment: ChatAttachment | undefined;
  let encoding = false;
  let capturing = false;
  const clearAttach = (): void => {
    attachment = undefined;
    attach.dataset.on = '0';
    thumb.removeAttribute('src');
    fileInput.value = '';
  };
  /** Hang up the encoding results: uploading and screenshots share this landing point. */
  const applyEncoded = (encoded: EncodedImage): boolean => {
    if (!root.isConnected) return false; // The pop-up window was closed before the encoding was completed.
    attachment = { mediaType: encoded.mediaType, data: encoded.base64 };
    thumb.src = encoded.previewUrl;
    attach.dataset.on = '1';
    return true;
  };
  const setImageFile = async (file: File): Promise<boolean> => {
    if (!isImageFile(file)) {
      flash('只支持 PNG / JPEG / WebP / GIF');
      return false;
    }
    encoding = true;
    pickBtn.disabled = true;
    try {
      return applyEncoded(await encodeImageFile(file));
    } catch (e) {
      flash('读图失败：' + (e instanceof Error ? e.message : String(e)));
      return false;
    } finally {
      encoding = false;
      pickBtn.disabled = false;
    }
  };

  pickBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const file = fileInput.files && fileInput.files[0];
    if (file) void setImageFile(file);
  });
  attachX.addEventListener('click', clearAttach);
  // Paste pictures: Snipping tools usually put the pictures on the clipboard first, Ctrl + V is two steps less than
  // "save and then select the file". Hang on the root element instead of the input box: the focus may stop on the ✕ /
  // button, and the event will still bubble up here; plain text will not be intercepted.
  root.addEventListener('paste', (e) => {
    const file = firstImageFromClipboard(e.clipboardData);
    if (!file) return;
    e.preventDefault();
    void setImageFile(file);
  });
  // Screenshot: If the implementation is available, capture a frame (the stream will be stopped immediately in the implementation, leaving no long connection); if not, it means the current environment does not support it.
  if (opts.capture) {
    const capture = opts.capture;
    shotBtn.addEventListener('click', () => {
      if (capturing) return;
      capturing = true;
      shotBtn.disabled = true;
      void capture()
        .then((encoded) => applyEncoded(encoded))
        .catch((e) => flash('截屏失败：' + (e instanceof Error ? e.message : String(e))))
        .finally(() => {
          capturing = false;
          shotBtn.disabled = false;
        });
    });
  } else {
    shotBtn.addEventListener('click', () => flash('当前环境不支持截屏，先用上传试试'));
  }

  // Press and hold to speak: The state machine, recording and result points are all at chat/hear-control. Here only the elements and prompt lines are passed over.
  const hear = createHearControl({
    micBtn,
    input,
    hint: { show: showHint, hide: hideHint, flash },
    resizeInput,
    hearUrl,
  });

  resizeInput(); // Use placeholder as initial width

  return {
    root,
    input,
    err,
    shotBtn,
    resizeInput,
    clearAttach,
    setImageFile,
    setEncoded: applyEncoded,
    getAttachment: () => attachment,
    isEncoding: () => encoding || capturing,
    flash,
    startHear: hear.start,
    stopHear: hear.stop,
    isHearing: hear.isHearing,
    dispose: () => {
      window.clearTimeout(hintTimer);
      hear.dispose();
    },
  };
}
