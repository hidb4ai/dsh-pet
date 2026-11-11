/**
 * Mount and manage the chat input dialog: positioning, closing and sending.
 * Both renderers share this implementation, using injected baseUrl/surface without reading configuration or chat
 * storage.
 * Display replies through /state at pets.<id>.say, ignoring the duplicated text in POST responses. onSent only prompts
 * the caller to poll.
 * @module dsh-pet/src/shared/chat/dialog
 */
import { ROUTE_PATH } from '../constants.ts';
import { createChatDom } from './dom.ts';
import { createCompositionWatch, decideEnter } from './enter.ts';
import type { EncodedImage } from './encode.ts';
import { sendChat, type ChatAttachment } from './send.ts';
import { injectChatCss } from './styles.ts';

/** The dialog pop-up window mounts handle. */
export interface ChatDialogMount {
  /** Root element (under document.body) */
  el: HTMLElement;
  /** Close and clean up (idempotent) */
  close: () => void;
  /** Start recording: The shortcut key "Press and hold to speak" is used when pressed (the microphone is already recording and there is no action when the environment does not support it). */
  startHear: () => void;
  /** cleanup: used when the shortcut key is released (no action when not recording). */
  stopHear: () => void;
  /** Is it really collecting at this moment? */
  isHearing: () => boolean;
  /** Insert an encoded image (use this screenshot shortcut key when the pop-up window is open); return whether to accept it. */
  setEncoded: (encoded: EncodedImage) => boolean;
  /** Put in a picture file (paste, drag and drop when the pop-up window is open); return false when the type is not accepted or the encoding fails. */
  setImageFile: (file: File) => Promise<boolean>;
  /** Display a temporary prompt in the pop-up window (for reasons such as screenshot failure, it will be automatically closed after timeout). */
  flash: (text: string) => void;
}

/** Send elements required for wiring with callback. */
interface SendBinding {
  readonly input: HTMLTextAreaElement;
  readonly err: HTMLElement;
  /** Contains the conversation address of `?pet=&surface=`. */
  readonly url: string;
  readonly isClosed: () => boolean;
  /** Sent successfully (pop-up window has not been closed). */
  readonly onOk: () => void;
  /** Picture to be sent; if not, send plain text. */
  readonly attachment: () => ChatAttachment | undefined;
  /** Is the image still being compressed? If yes, please prompt first. Do not send the image and throw it away. */
  readonly isEncoding: () => boolean;
  /** Non-error prompt ("Picture is still being processed" type). */
  readonly notify: (text: string) => void;
}

/** Click the pop-up window or press Esc to close; return to the unbinding function. */
function bindDismiss(root: HTMLElement, isClosed: () => boolean, onDismiss: () => void): () => void {
  const onPointerDown = (e: MouseEvent): void => {
    if (isClosed() || root.contains(e.target as Node)) return;
    onDismiss();
  };
  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') onDismiss();
  };
  document.addEventListener('mousedown', onPointerDown, true);
  document.addEventListener('keydown', onKeyDown, true);
  return () => {
    document.removeEventListener('mousedown', onPointerDown, true);
    document.removeEventListener('keydown', onKeyDown, true);
  };
}

/** Enter to send: callback after success, write the reason into err line after failure, no forged reply. */
function bindSend(binding: SendBinding): void {
  let sending = false;
  const doSend = (): void => {
    if (binding.isClosed() || sending) return;
    if (binding.isEncoding()) {
      binding.notify('图片还在处理，稍等一下');
      return;
    }
    const text = binding.input.value.trim();
    if (!text) return;
    sending = true;
    binding.input.disabled = true;
    sendChat(binding.url, text, binding.attachment())
      .then((state) => {
        if (state.ok) binding.onOk();
        else {
          binding.err.textContent = '对话失败：' + (state.message ?? state.reason);
          binding.err.style.display = 'block';
        }
      })
      .catch((e) => {
        binding.err.textContent = '对话异常：' + String(e && e.message ? e.message : e);
        binding.err.style.display = 'block';
      })
      .finally(() => {
        sending = false;
        binding.input.disabled = false;
        if (!binding.isClosed()) binding.input.focus();
      });
  };
  // Enter must get out of the way of the input method: the enter in the combination is the screen up key, long pressing the repeated enter should only be swallowed, and a new line should not be inserted.
  const ime = createCompositionWatch();
  binding.input.addEventListener('compositionstart', ime.start);
  binding.input.addEventListener('compositionend', () => ime.end(performance.now()));
  binding.input.addEventListener('keydown', (e) => {
    const action = decideEnter(e, ime, performance.now());
    if (action === 'ignore') return;
    e.preventDefault();
    if (action === 'send') doSend();
  });
}

/**
 * The identification address is deduced from the conversation address: `.../chat` is passed in from both ends, remove
 * the tail segment and replace it with `/voice/hear` .
 *
 * @param baseUrl - Conversation address with mount prefix.
 * @returns Identification address under the same prefix.
 */
function hearUrlOf(baseUrl: string): string {
  return baseUrl.replace(/\/chat$/, '') + '/voice/hear';
}

/** Input parameters of the mounting dialog pop-up window. */
export interface ChatDialogOptions {
  petId: string;
  /** Endpoint base address: The default relative path of the browser, the desktop transmission is absolute URL (file:// page needs to be absolute). */
  baseUrl?: string;
  /** Which end does this pop-up window open on: POST /chat? surface = is required, and the host rejects impossible combinations in advance accordingly. */
  surface: 'web' | 'desktop';
  x: number;
  y: number;
  /** Called after successful sending (the pop-up window has been closed at this time): the reply itself is not sent back from here, and the data only has one outlet / state. */
  onSent?: () => void;
  onClose?: () => void;
  /** The rectangle that the pop-up window is allowed to occupy (local coordinates of the viewport); default = the entire viewport. */
  clamp?: { x: number; y: number; w: number; h: number };
  /** The picture that is carried when opening (drag and drop on the pet to walk); default = empty pop-up window. */
  initialImage?: File;
  /** The encoded image is taken when opening (this is the screenshot shortcut key: there is no File in the screenshot, only base64). */
  initialEncoded?: EncodedImage;
  /** Screen capture implementation: The browser transmits getDisplayMedia frame capture, and the desktop transmits IPC call of preload; default = not supported. */
  capture?: () => Promise<EncodedImage>;
  /**
   * Identification address; the default is `baseUrl` with the tail `/chat` derivation removed (`.../chat` is passed in
   * from both ends). The button does not appear when it is not used (the environment cannot record), see
   * createChatDom.
   */
  hearUrl?: string;
}

/**
 * Mount a dialog input pop-up window (shared at both ends; the position is the viewport coordinates, and it will
 * automatically clip back when it exceeds the clamp rectangle). Input box + two icon buttons for upload/screenshot +
 * image preview (this round only has interface and local preview, encoding and sending are to be accessed). Press
 * Enter to send: After successful sending, the pop-up window is closed and onSent is called. Esc or click the pop-up
 * window to close; if the generation fails, an explicit prompt will be left in the pop-up window. clamp is sent from
 * the caller: "Window ∩ Workspace" is passed to the desktop. When the pet is next to the pet, the pop-up window is
 * still fully displayed and the window moves zero.
 */
export function mountChatDialog(opts: ChatDialogOptions): ChatDialogMount {
  injectChatCss();
  const { petId, surface, x, y, onSent, onClose, clamp } = opts;
  const baseUrl = opts.baseUrl ?? ROUTE_PATH + '/chat';
  // `surface` is required (host verification); this URL is only used for POST sending - GET does not need it for the memory reading path
  const withPet = baseUrl + '?pet=' + encodeURIComponent(petId) + '&surface=' + surface;
  const c =
    clamp && Number.isFinite(clamp.x + clamp.y + clamp.w + clamp.h)
      ? clamp
      : { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight };

  const dom = createChatDom({ capture: opts.capture, hearUrl: opts.hearUrl ?? hearUrlOf(baseUrl) });
  const { root, input, err } = dom;

  /** With the landing point (x, y), it is pinched back beyond the clamp rectangle. */
  const place = (): void => {
    const r = root.getBoundingClientRect();
    root.style.left = Math.max(c.x + 4, Math.min(x, c.x + c.w - r.width - 4)) + 'px';
    root.style.top = Math.max(c.y + 4, Math.min(y, c.y + c.h - r.height - 4)) + 'px';
  };

  let closed = false;
  let unbindDismiss = (): void => {};
  const close = (): void => {
    if (closed) return;
    closed = true;
    unbindDismiss();
    dom.dispose();
    dom.clearAttach();
    root.remove();
    if (onClose) onClose();
  };
  unbindDismiss = bindDismiss(root, () => closed, close);
  bindSend({
    input,
    err,
    url: withPet,
    isClosed: () => closed,
    onOk: () => {
      close();
      if (onSent) onSent();
    },
    attachment: () => dom.getAttachment(),
    isEncoding: () => dom.isEncoding(),
    notify: (text) => dom.flash(text),
  });
  // The wiring of the screenshot button is in dom (dependency injection capture), which is only responsible for sending and closing.

  dom.resizeInput(); // Measure again after append (the style is now in effect)
  place();
  if (opts.initialImage) void dom.setImageFile(opts.initialImage);
  if (opts.initialEncoded) dom.setEncoded(opts.initialEncoded);
  input.focus();
  return {
    el: root,
    close,
    startHear: dom.startHear,
    stopHear: dom.stopHear,
    isHearing: dom.isHearing,
    setEncoded: dom.setEncoded,
    setImageFile: dom.setImageFile,
    flash: dom.flash,
  };
}
