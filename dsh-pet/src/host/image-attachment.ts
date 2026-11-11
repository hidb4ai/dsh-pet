/**
 * Analysis of the input parameters of the conversation picture: convert the `attachment` of the online JSON into bytes
 * that can be directly received by the attachment service. Do not do IO, do not touch the attachment service - persist
 * to disk and authoritative verification (decoding authenticity, pixel upper limit). At the route layer, this module
 * is only responsible for shape, media type whitelist and base64 normalization.
 * @module dsh-pet/src/host/image-attachment
 */

/** The image media type whitelist is consistent with the set accepted by the host attachment service. */
export type PetImageMediaType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';

/** A picture that has been persisted to disk: only declare the fields used by pet, and do not quote the type package of @deepseek-ai/dsh-attachment. */
export interface PetImageRef {
  readonly attachmentId: string;
  readonly mediaType: PetImageMediaType;
  readonly bytes: number;
  readonly width: number;
  readonly height: number;
}

/** Minimum information required to locate an image that has been persisted to disk: the object path is determined only by attachmentId. */
export interface PetImageLocator {
  readonly attachmentId: string;
}

/** Minimum shape of attachment service: DSH host provided, standalone mode missing. */
export interface PetImageSink {
  /** The upper limit of bytes for a single image at the deployment level; if it is missing, it will be considered as no limit (the service will still authoritatively verify it internally). */
  readonly imageLimits?: { readonly maxImageBytes?: number };
  /** Verify and persist a batch of pictures, returning references in the same order as the input parameters. */
  saveImages(inputs: readonly { data: Uint8Array; mediaType: PetImageMediaType }[]): Promise<readonly PetImageRef[]>;
  /** Absolute path on host file backend; non-file backend does not provide this method (the image fetch endpoint returns 404 accordingly). */
  imageHostPath?(ref: PetImageLocator): string | undefined;
}

/** Analysis conclusion; when failed, message directly serves as the copy of bad-request. */
export type ParsedImage =
  | { readonly ok: true; readonly mediaType: PetImageMediaType; readonly bytes: Uint8Array }
  | { readonly ok: false; readonly message: string };

/** Allowed media types; order used for error copy, keeping a fact with host attachment service's whitelist. */
const MEDIA_TYPES: readonly PetImageMediaType[] = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

/** base64 character upper limit: The upper limit of the request body is 1 MiB, leaving a margin for the text and JSON structures. */
const MAX_BASE64_CHARS = 900_000;

/**
 * Parse `attachment` in the request body.
 *
 * @param raw - Unchecked raw value.
 * @returns specifies the bytes and media type resolved by base64; if it fails, it will provide a copy that can be sent
 * directly.
 */
export function parseImageAttachment(raw: unknown): ParsedImage {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, message: 'attachment 必须是对象' };
  }
  const { mediaType, data } = raw as Record<string, unknown>;
  if (typeof mediaType !== 'string' || !MEDIA_TYPES.includes(mediaType as PetImageMediaType)) {
    return { ok: false, message: `attachment.mediaType 必须是 ${MEDIA_TYPES.join(' / ')} 之一` };
  }
  if (typeof data !== 'string' || data === '') {
    return { ok: false, message: 'attachment.data 必须是非空 base64 字符串' };
  }
  if (data.length > MAX_BASE64_CHARS) {
    return { ok: false, message: 'attachment.data 过长（请压缩或降低分辨率）' };
  }
  // Buffer decoding will silently discard invalid characters, so use "recoding must be consistent with the original
  // text" to confirm that it is indeed the standard base64; otherwise `"abc!!!"` will be secretly decoded into other
  // bytes, and the caller thinks A is sent, but the model sees B.
  const decoded = Buffer.from(data, 'base64');
  if (decoded.length === 0 || decoded.toString('base64') !== data) {
    return { ok: false, message: 'attachment.data 不是合法的 base64' };
  }
  return { ok: true, mediaType: mediaType as PetImageMediaType, bytes: new Uint8Array(decoded) };
}
