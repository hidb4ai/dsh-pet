/**
 * Upload pet avatar: `POST /pet-avatar?root=<asset-root>` , body is `{ base64 }` .
 *
 * Why use base64 instead of original bytes: The host request body is decoded according to utf8 (see readBody of
 * http.ts), and the binary naked stream is destroyed at the decoding point; JSON also allows this endpoint to share
 * the same set of wrong conclusions with other write endpoints. Only verify the "document avatar image + within the
 * budget", no cropping or re-encoding - the size and quality are guaranteed from the front end to the long side 512.
 * @module dsh-pet/src/host/routes/avatar
 */
import { isValidPetId } from '../config.ts';
import { savePetAvatar } from '../pet-avatar.ts';
import { failResult, invalidJson, methodNotAllowed, okResult, payloadTooLarge } from './result.ts';
import type { PetRouteDeps, RouteInput } from './types.ts';
import type { RouteResult } from '../http.ts';

/** The upper limit of decoded bytes: request body 1 MiB is the upper limit of base64 text, and it naturally does not exceed 768 KiB after decoding. */
const MAX_AVATAR_BYTES = 768 * 1024;

/**
 * Avatar upload field: undefined is returned if not hit, and response is returned if hit.
 *
 * Written as the forward branch of `rest === 'pet-avatar'` instead of the reverse guard: scripts/check-openapi.mjs
 * collects the route implemented by the host according to this literal. The reverse writing method will cause the path
 * in the document to be false positive as "does not exist in the implementation".
 */
export async function handleAvatarRoutes(deps: PetRouteDeps, input: RouteInput): Promise<RouteResult | undefined> {
  if (input.rest === 'pet-avatar') return acceptUpload(deps, input);
  return undefined;
}

/**
 * One upload is accepted.
 *
 * @param deps - route layer dependency (only the file pet directory is used).
 * @param input - Parsed request (method, URL, request body).
 * @returns success, or business/agreement failure by reason.
 */
async function acceptUpload(deps: PetRouteDeps, input: RouteInput): Promise<RouteResult> {
  if (input.method !== 'POST') return methodNotAllowed();

  // The parameter is called root instead of pet: what is required here is the asset root (directory prefix), not pets []. id (see PetIdQuery of openapi).
  const assetRoot = (input.url.searchParams.get('root') ?? '').trim();
  if (assetRoot === '') return failResult('bad-request', '缺少 root 参数（素材根）');
  // The asset root is an identifier and not a path fragment: the delimiter/reserved character is rejected and is earlier than any path concatenate.
  if (!isValidPetId(assetRoot)) return failResult('bad-request', '素材根不合法');
  // pet / pet pack only: The built-in entries use the plugin default logo, and do not accept writing (main files should not be left in pet /).
  if (assetRoot === 'main') return failResult('bad-request', '内置条目不能换头像：main 不写入 pet/ 目录');

  let raw: unknown;
  try {
    raw = JSON.parse(input.body ?? '');
  } catch {
    return invalidJson();
  }
  const base64 = typeof raw === 'object' && raw !== null ? (raw as { base64?: unknown }).base64 : undefined;
  if (typeof base64 !== 'string' || base64 === '') return failResult('bad-request', 'base64 必须是非空字符串');

  // Buffer decoding will silently discard invalid characters, so use "re-encoding must be consistent with the original text" to confirm that it is canonical base64.
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.length === 0 || bytes.toString('base64') !== base64) return failResult('bad-request', 'base64 不合法');
  if (bytes.length > MAX_AVATAR_BYTES) return payloadTooLarge('头像超过 768 KiB');

  const saved = savePetAvatar(deps.petConfigDir, assetRoot, bytes);
  if (!saved.ok) {
    return saved.reason === 'not-image'
      ? failResult('unsupported', '只支持 PNG / JPEG / WebP / GIF')
      : failResult('internal-error', '头像写入失败');
  }
  return okResult({ ok: true });
}
