import { ROUTE_PATH } from './constants.ts';
/**
 * Whisper’s display view: text → bubble row data, as well as graphic nodes and styles. Not responsible for data
 * retrieval, generation and failure determination - the host side writes pets .< id >. say into / state after
 * generation, and both ends only read from the polling state. Does not depend on React; only map node construction
 * uses DOM.
 * @module dsh-pet/src/shared/whisper
 */

/**
 * Parsed whisper result: success (sentence + optional image) or failure (explicit reason, no forged text). This shape
 * is retained because bubble row rendering branches according to it, and it is also used to express the reason when
 * the host side fails.
 */
export type WhisperState =
  | { ok: true; text: string; image?: string; ts: number }
  | { ok: false; reason: 'provider-missing' | 'generate-error'; message?: string };

/** whisper bubble row data: one sentence (role : ' label ' single row, reuse balance bubble's universal row rendering). */
export type WhisperBubbleRow = { role: 'label'; text: string };

/** whisper text → bubble line (both ends share the same line data). */
export function whisperBubbleView(state: WhisperState): WhisperBubbleRow[] {
  if (state.ok) return [{ role: 'label', text: state.text }];
  const msg =
    state.reason === 'provider-missing'
      ? '当前对话未配置模型，碎碎念不可用'
      : '碎碎念生成失败' + (state.message ? '：' + state.message : '');
  return [{ role: 'label', text: msg }];
}

/**
 * The emoticon picture URL has the same spelling as the video: `<base>/pic/memes/<asset-root>/<name>.png` (both the asset root
 * and name need to be encoded). The asset root is used to express which pet this picture belongs to: when
 * `pet/<asset-root>-memes/` exists, this category only recognizes its own directory, otherwise it will go to the user
 * directory and assets/memes in the package; if assetRoot is empty, it will return to the two-stage form, and unmarked
 * pets and old hosts can still get the picture. base already contains the / dsh-pet-7340 prefix (consistent with
 * assetBase in the video), and it must not be spelled again in the function, otherwise the desktop image will be
 * broken. The desktop page is loaded at file://, and the relative path will be resolved into file:/// and will
 * inevitably fail, so the desktop transmits the absolute base address.
 */
export function memeImageUrl(name: string, base = ROUTE_PATH, assetRoot = ''): string {
  const root = String(assetRoot ?? '').trim();
  const prefix = root ? '/pic/memes/' + encodeURIComponent(root) : '/pic/memes';
  return base + prefix + '/' + encodeURIComponent(name) + '.png';
}

/** bubble picture class (shared at both ends, see MEME_BUBBLE_CSS for the style). */
export const MEME_IMG_CLASS = 'pet-bub-img';
/** With picture bubble class: Cancel min-width and let the bubble fit the width of the picture (otherwise, leave a large blank next to the picture). */
export const MEME_BUBBLE_CLASS = 'has-img';

/**
 * bubble illustration style - the same portion is injected into both ends. The size is anchored on the font size: --m
 * = bubble text final font size --f (each shell is injected according to shared/fonts.ts's resolveFontPx), the font
 * size increases and the image becomes larger simultaneously; --f falls back to pet width × 0.0455 when not injected.
 * Coefficient = 0.34 ÷ 0.0455 ≈ 7.4725, the default 462 px pet / 21 px font size is equivalent to a fixed 0.34 × pet
 * width. max-width:100 % is fallback: after turning off followPet and reducing the font size, fixed-width images will
 * pop bubbles.
 */
export const MEME_BUBBLE_CSS = [
  '.pet-bub-img{--m:var(--f,calc(var(--dsh-pet-size,var(--pet-size,462px))*0.0455));display:block;' +
    'width:calc(var(--m)*7.4725);max-width:100%;height:auto;border-radius:calc(var(--m)*0.5714);' +
    'margin:0 auto calc(var(--m)*0.3736);object-fit:cover;pointer-events:none;user-select:none}',
  '.pet-bubble.has-img,.dsh-pet-bubble.has-img{min-width:0}',
  // Voice status subscript: shared by both ends; absolutely positioned at the lower right corner of the bubble, does not participate in text layout, and does not support the height of the bubble.
  '.dsh-pet-voice-badge{position:absolute;right:calc(var(--f,21px)*0.25);bottom:calc(var(--f,21px)*0.15);' +
    'width:calc(var(--f,21px)*0.66);height:calc(var(--f,21px)*0.66);display:flex;align-items:center;' +
    'justify-content:center;font-size:calc(var(--f,21px)*0.5);line-height:1;opacity:.65;pointer-events:none}',
  // Loading state: Only the upper half of the circle is a thin ring with color, which expresses "rotating" by rotating.
  '.dsh-pet-voice-badge.is-loading::before{content:"";width:calc(var(--f,21px)*0.5);height:calc(var(--f,21px)*0.5);' +
    'border:1.5px solid rgba(43,43,43,.22);border-top-color:rgba(43,43,43,.7);border-radius:50%;' +
    'animation:dsh-pet-voice-spin .8s linear infinite}',
  '@keyframes dsh-pet-voice-spin{to{transform:rotate(360deg)}}',
  // Failed state: mute the speaker, press a little transparency - you can read "this sentence was not pronounced", but do not grab the text.
  '.dsh-pet-voice-badge.is-failed{opacity:.5}',
].join('');

/** Inject only once (skip if the page already has the same tag). */
let memeCssInjected = false;
export function injectMemeBubbleCss(): void {
  if (memeCssInjected || typeof document === 'undefined') return;
  memeCssInjected = true;
  if (document.querySelector('style[data-plugin-css="dsh-pet/meme-bubble"]') !== null) return;
  const tag = document.createElement('style');
  tag.dataset.plugin = 'dsh-pet';
  tag.dataset.pluginCss = 'dsh-pet/meme-bubble';
  tag.textContent = MEME_BUBBLE_CSS;
  document.head.appendChild(tag);
}

/**
 * Generate a bubble image node (both ends share the same rendering); return null to indicate that there is no image
 * this time, and the caller takes the pure text path.
 * @param name - image name (key to configure memes), default or blank → null.
 * @param base - Contains the host base address of / dsh-pet-7340 (same rules as video): browser default, desktop
 * passes BASE.
 * @param assetRoot - asset root (= entry of the pet key), which determines which meme directory link the
 * picture will be fetched from.
 */
export function createMemeImage(name?: string, base = ROUTE_PATH, assetRoot = ''): HTMLImageElement | null {
  const key = String(name ?? '').trim();
  if (!key) return null;
  injectMemeBubbleCss();
  const img = document.createElement('img');
  img.className = MEME_IMG_CLASS;
  img.src = memeImageUrl(key, base, assetRoot);
  img.alt = key;
  return img;
}

/**
 * Generate an external address map node (the asset is hosted by a third party and only the address is given). Shares
 * class and style with createMemeImage, the only difference is src: directly use the given address, no emoticon path
 * is required, and base is not required. The choice of one of the two forms is guaranteed by the host, and the
 * consumer is distinguished by field name, and startsWith (' http ') sniffing is not performed; the address is empty →
 * null.
 */
export function createMemeImageFromUrl(url?: string): HTMLImageElement | null {
  const href = String(url ?? '').trim();
  if (!href) return null;
  injectMemeBubbleCss();
  const img = document.createElement('img');
  img.className = MEME_IMG_CLASS;
  img.src = href;
  img.alt = '';
  return img;
}
