/**
 * Upload avatar on the settings page: shrink the selected image to the long side. 512. Convert base64 and POST to the
 * host for overwriting and writing.
 *
 * Do not reuse the compression link of the dialogue drawing: the long side of the dialogue drawing is compressed into
 * JPEG according to 640 KiB / 2048 to save the request body. The avatar is a small square image, and the transparent
 * background must be maintained, so here only the sides are reduced and unified into PNG, without a quality ladder.
 * Encoding and submission are divided into two functions: encoding requires canvas, and if there is no test
 * environment, the network branch can be tested alone.
 * @module dsh-pet/src/client/settings/avatar-upload
 */
import { ROUTE_PATH } from '../../shared/constants.ts';
import { bytesToBase64, loadImage } from '../../shared/chat/encode.ts';

/** The upper limit of the long side of the avatar (px): The chat panel is displayed as 28 px, 512 is clear enough, and any larger size will just occupy the request body. */
export const AVATAR_MAX_SIDE_PX = 512;

/** Upload result: success, or failure copy that can be directly displayed to the user. */
export type AvatarUpload = { ok: true } | { ok: false; message: string };

/**
 * Press the image file into the upper limit of the long side and convert it to the specification base64.
 *
 * If it is within the range, upload it as it is (no re-encoding: transparent, animated images, and high DPI will not
 * be deleted); only if it exceeds the limit, the edges will be reduced and unified into PNG - using JPEG will fill the
 * transparent area with a black background. When the animation exceeds the limit, only the first frame is left, which
 * is the inherent cost of scaling.
 *
 * @param file - the image file selected by the user.
 * @returns specification base64 with media type.
 * @throws cannot decode the picture, or the browser cannot get the 2 D canvas.
 */
export async function encodeAvatarFile(file: File): Promise<{ base64: string; mediaType: string }> {
  const img = await loadImage(file);
  const width = img.naturalWidth || img.width;
  const height = img.naturalHeight || img.height;
  if (Math.max(width, height) <= AVATAR_MAX_SIDE_PX) {
    return { base64: bytesToBase64(new Uint8Array(await file.arrayBuffer())), mediaType: file.type || 'image/png' };
  }
  const scale = AVATAR_MAX_SIDE_PX / Math.max(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new Error('The browser cannot resize this image');
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL('image/png');
  return { base64: dataUrl.slice(dataUrl.indexOf(',') + 1), mediaType: 'image/png' };
}

/**
 * Send the encoded avatar to the host (overwriting the old image).
 *
 * @param assetRoot - the asset root to which the pet belongs; the file pet uses the directory prefix, and the built-in
 * one uses `main` (the host will reject it).
 * @param base64 - Specification base64 (without the `data:` prefix).
 * @param fetchImpl - Injected fetch, used as a stand-in for testing; not passed in production, take the global fetch.
 * @returns success, or failure text given by host/network.
 */
export async function postAvatar(
  assetRoot: string,
  base64: string,
  fetchImpl: typeof fetch = fetch,
): Promise<AvatarUpload> {
  const res = await fetchImpl(ROUTE_PATH + '/pet-avatar?root=' + encodeURIComponent(assetRoot), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ base64 }),
  });
  const raw = (await res.json().catch(() => null)) as { ok?: unknown; message?: unknown } | null;
  if (!res.ok || raw === null) return { ok: false, message: '上传失败（HTTP ' + res.status + '）' };
  if (raw.ok !== true) return { ok: false, message: typeof raw.message === 'string' ? raw.message : '上传失败' };
  return { ok: true };
}

/**
 * Upload a pet's avatar (encoding + submission).
 *
 * @param assetRoot - the asset root to which the pet belongs.
 * @param file - the image file selected by the user.
 * @returns on success, or failure text given by encoding /host/network.
 */
export async function uploadPetAvatar(assetRoot: string, file: File): Promise<AvatarUpload> {
  const { base64 } = await encodeAvatarFile(file);
  return postAvatar(assetRoot, base64);
}
