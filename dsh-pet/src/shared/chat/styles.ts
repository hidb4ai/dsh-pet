/**
 * The style and size parameters of the dialog pop-up window: Inject the same CSS at both ends. Only static character
 * strings and constants are placed, DOM is not created, and runtime status is not read.
 * @module dsh-pet/src/shared/chat/styles
 */

/**
 * Pop-up window style. An adaptive input box (untitled) + a row of icon buttons (upload/screenshot/press and hold to
 * talk) + optional picture preview; initial 160 px, widened with input, capped at 340 px, and then folded to increase
 * height; press Enter to send, Esc or click to close. The width is measured by text JS overwriting the root element
 * width.
 */
export const CHAT_CSS = [
  '.dsh-pet-chat{position:fixed;z-index:2147483001;width:160px;max-width:80vw;',
  'background:rgba(255,255,255,.98);border:1px solid rgba(0,0,0,.12);border-radius:10px;',
  'box-shadow:0 10px 32px rgba(0,0,0,.22);color:#2b2b2b;font-size:14px;line-height:1.5;',
  // The font is the same as desktop pet bubble (the top is a soft candy body, and both ends have been injected with
  // @font - face). The style is consistent and not formal. The font family uses the global configuration variable --
  // dsh-pet-font-family: The pop-up window is hung under body and cannot be inherited from the pet root container. It
  // is injected into documentElement from both ends. The font size remains fixed at 14 px: font.size in the
  // configuration only works on bubbles and floating prompts.
  "font-family:var(--dsh-pet-font-family,'ShangshouSoftCandy','Yuanti SC','YouYuan','幼圆','Comic Sans MS','PingFang SC','Microsoft YaHei',sans-serif);",
  'user-select:none}',
  '.dsh-pet-chat *{box-sizing:border-box}',
  '.dsh-pet-chat-input{display:block;width:100%;border:none;outline:none;background:transparent;',
  'padding:8px 11px 9px;font-size:14px;line-height:1.45;color:#2b2b2b;font-family:inherit;',
  'resize:none;overflow:hidden;white-space:pre-wrap;overflow-wrap:anywhere}',
  '.dsh-pet-chat-input::placeholder{color:rgba(43,43,43,.45)}',
  '.dsh-pet-chat-input:disabled{opacity:.55}',
  // Operation line: Upload / screenshot / press and hold the three icon buttons to speak (no borders, only displayed when hovering)
  '.dsh-pet-chat-actions{display:flex;align-items:center;gap:6px;padding:0 8px 7px}',
  '.dsh-pet-chat-btn{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;',
  'border:none;border-radius:6px;background:transparent;color:rgba(43,43,43,.62);font-size:14px;line-height:1;',
  'cursor:pointer;transition:background .15s,color .15s}',
  '.dsh-pet-chat-btn:hover{background:rgba(0,0,0,.06);color:rgba(43,43,43,.9)}',
  '.dsh-pet-chat-btn:disabled{opacity:.45;cursor:default}',
  '.dsh-pet-chat-btn svg{display:block}',
  // Microphone: During recording, the red background is always on + breathing, telling the user that it is "listening". Status is written on data-hear by dom.
  '.dsh-pet-chat-btn[data-hear="recording"]{color:#e5484d;background:rgba(229,72,77,.14)}',
  '.dsh-pet-chat-btn[data-hear="recording"]:hover{background:rgba(229,72,77,.2);color:#e5484d}',
  '.dsh-pet-chat-btn[data-hear="recording"] svg{animation:dsh-pet-hear-pulse 1s ease-in-out infinite}',
  '@keyframes dsh-pet-hear-pulse{0%,100%{opacity:1}50%{opacity:.4}}',
  // Selected image: a small image to the right of the two buttons, not occupying an extra line
  '.dsh-pet-chat-attach{display:none;align-items:center;gap:4px;margin-left:2px}',
  '.dsh-pet-chat-attach[data-on="1"]{display:inline-flex}',
  '.dsh-pet-chat-thumb{width:24px;height:24px;object-fit:cover;border-radius:4px;',
  'border:1px solid rgba(0,0,0,.1);flex:0 0 auto;background:rgba(0,0,0,.06)}',
  '.dsh-pet-chat-attach-x{border:none;background:transparent;color:rgba(43,43,43,.45);cursor:pointer;',
  'font-size:12px;line-height:1;padding:2px 3px;border-radius:4px}',
  '.dsh-pet-chat-attach-x:hover{background:rgba(0,0,0,.08);color:rgba(43,43,43,.85)}',
  '.dsh-pet-chat-hint{display:none;color:rgba(43,43,43,.55);font-size:12px;padding:0 12px 8px}',
  '.dsh-pet-chat-err{color:#d94f3d;font-size:12px;padding:0 12px 8px;white-space:pre-wrap;overflow-wrap:anywhere}',
].join('');

/** Input box width adaptive parameters: initial small width, increases with text, wraps and increases after capping. */
export const CHAT_MIN_W = 160;
export const CHAT_MAX_W = 340;
/** Input box horizontal padding compensation (11×2) */
export const CHAT_H_PAD = 22;

let chatCssInjected = false;

/** Inject the pop-up window style into the document once; repeated mounting will not insert it repeatedly. */
export function injectChatCss(): void {
  if (chatCssInjected || typeof document === 'undefined') return;
  chatCssInjected = true;
  const tag = document.createElement('style');
  tag.dataset.plugin = 'dsh-pet';
  tag.dataset.pluginCss = 'dsh-pet/chat';
  tag.textContent = CHAT_CSS;
  document.head.appendChild(tag);
}
