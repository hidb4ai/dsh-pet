/**
 * Compression and encoding of conversation pictures: Press a file or canvas into the budget acceptable to the host,
 * and output base64 that can be sent. Pure calculation (size conversion, bytes inversion) is separated from DOM
 * (decoding, canvas), and the former can be measured alone. Budget basis: The host rejects the request body with 1
 * MiB, and base64 is expanded by 4/3, so the upper limit after decoding is 640 KiB. The two small pieces of decoding
 * and base64 encoding ({@link loadImage}, {@link bytesToBase64} ) are also used for uploading the avatar on the
 * settings page. The budget and quality ladder of the avatar are different, but "how to read the file into a picture,
 * how to read into the standard base64" is the only implementation.
 * @module dsh-pet/src/shared/chat/encode
 */
import { type PetImageMediaType, imageMediaTypeOf } from './image-pick.ts';

/** The upper limit of bytes for a single image (after decoding). */
export const IMAGE_MAX_BYTES = 640 * 1024;
/** The upper limit of the long side: No matter how large it is, there is no benefit to "seeing the error text clearly" and it will only occupy the request body. */
export const IMAGE_MAX_SIDE = 2048;
/** Quality ladder: from high to low, stop at the first level when budget is reached. */
export const IMAGE_QUALITIES = [0.85, 0.75, 0.65, 0.55] as const;
/** The long side (pixels) of the preview thumbnail: only used for the 24×24 in the pop-up window. */
const PREVIEW_SIDE = 96;

/** Reverse the number of bytes according to the length of base64 (without re-decoding). */
export function attachmentBytes(base64: string): number {
  const pad = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - pad;
}

/** Shrink to the target size after the upper limit of the long side; do not enlarge. */
export function targetSize(width: number, height: number, maxSide = IMAGE_MAX_SIDE): { width: number; height: number } {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Encoding result: `base64` is the payload to be sent, `previewUrl` is only used for thumbnails. */
export interface EncodedImage {
  readonly base64: string;
  readonly mediaType: PetImageMediaType;
  readonly bytes: number;
  readonly width: number;
  readonly height: number;
  /** Has it been re-encoded (the original image exceeds the limit, or the source is originally a canvas). */
  readonly resized: boolean;
  /** Small size preview (within tens of KB), avoid hanging the data URL of the entire picture on DOM. */
  readonly previewUrl: string;
}

/**
 * Decode the file into `<img>` .
 *
 * Use data URL of `FileReader` instead of `URL.createObjectURL` : CSP of helper on the desktop is
 * `img-src 'self' http: https: data:` , excluding `blob:` . objectURL will be blocked there as onerror (shown as "this
 * file cannot decode the picture", but the browser side is normal).
 *
 * @param file - the picture file selected by the user.
 * @returns decoded picture element.
 * When the @throws file cannot be read or the picture cannot be decoded.
 */
export function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read this file'));
    reader.onload = () => {
      const url = typeof reader.result === 'string' ? reader.result : '';
      if (!url) {
        reject(new Error('Could not read this file'));
        return;
      }
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Could not decode this image'));
      img.src = url;
    };
    reader.readAsDataURL(file);
  });
}

/**
 * bytes → standard base64 (blocked to avoid excessive String.fromCharCode parameters bursting the stack).
 *
 * @param bytes - the raw bytes read into memory.
 * @returns without the data : specification of the prefix base64 .
 */
export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK) as unknown as number[]);
  }
  return btoa(bin);
}

/** Draw the source into a new canvas according to the target size. */
function drawToCanvas(source: CanvasImageSource, size: { width: number; height: number }): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  canvas.getContext('2d')?.drawImage(source, 0, 0, size.width, size.height);
  return canvas;
}

/** Thumbnails: 96 px, JPEG 0.72, a few KB are enough for 24×24 display. */
function previewOf(source: CanvasImageSource, width: number, height: number): string {
  return drawToCanvas(source, targetSize(width, height, PREVIEW_SIDE)).toDataURL('image/jpeg', 0.72);
}

/**
 * Press a canvas into the budget: press the quality ladder to JPEG, and stop when the first level is in the budget.
 *
 * @param canvas - The canvas has been drawn according to the target size (this file and screenshot share this).
 * @returns payload and preview; error thrown when budget cannot be met.
 */
export function encodeCanvas(canvas: HTMLCanvasElement): EncodedImage {
  const { width, height } = canvas;
  const previewUrl = previewOf(canvas, width, height);
  const floor = IMAGE_QUALITIES[IMAGE_QUALITIES.length - 1];
  for (const quality of IMAGE_QUALITIES) {
    const dataUrl = canvas.toDataURL('image/jpeg', quality);
    const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    const bytes = attachmentBytes(base64);
    if (bytes <= IMAGE_MAX_BYTES || quality === floor) {
      return { base64, mediaType: 'image/jpeg', bytes, width, height, resized: true, previewUrl };
    }
  }
  throw new Error('Could not compress the image within the size budget');
}

/**
 * Encode an image file into a sendable attachment.
 *
 * If the original image is small enough, send it as it is (no re-encoding: JPEG. If you compress it again, the image
 * quality will be lost, but the animated image will be preserved); if it exceeds the limit, reduce it to the upper
 * limit of the long side, and press it step by step according to the quality ladder until it is within the budget.
 *
 * @param file - File passed `isImageFile` .
 * @returns load and preview; an error is thrown when the budget cannot be met (the caller prompts the user to change
 * pictures).
 */
export async function encodeImageFile(file: File): Promise<EncodedImage> {
  const mediaType = imageMediaTypeOf(file);
  if (!mediaType) throw new Error('This image cannot be sent');
  const img = await loadImage(file);
  const width = img.naturalWidth || img.width;
  const height = img.naturalHeight || img.height;
  const raw = new Uint8Array(await file.arrayBuffer());
  if (raw.length <= IMAGE_MAX_BYTES && Math.max(width, height) <= IMAGE_MAX_SIDE) {
    return {
      base64: bytesToBase64(raw),
      mediaType,
      bytes: raw.length,
      width,
      height,
      resized: false,
      previewUrl: previewOf(img, width, height),
    };
  }
  const target = targetSize(width, height);
  return encodeCanvas(drawToCanvas(img, target));
}
