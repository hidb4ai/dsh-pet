/**
 * Picture retrieval: Read the picture reference recorded in the conversation memory back into a picture that can be
 * displayed by the browser.
 *
 * It only verifies the id shape and gives the reference to the host attachment service to calculate the path - the
 * plugin itself does not spell any file path, so path traversal is impossible. The ownership is not verified (id is a
 * content hash and cannot be guessed, the service only listens to loopback), and no scaling is performed (original
 * image + cache header, enough). The attachment object is named according to sha256 and has no extension, so the type
 * can only be determined from the file header and cannot be guessed from the file name.
 * @module dsh-pet/src/host/routes/attachment
 */
import { closeSync, existsSync, openSync, readSync } from 'node:fs';
import { IMAGE_HEAD_BYTES, imageTypeOf } from '../http.ts';
import type { PetImageLocator, PetImageSink } from '../image-attachment.ts';
import type { PetRouteDeps, RouteInput } from './types.ts';
import type { RouteResult } from '../http.ts';

/** The valid shape of the attachment id (the same rule as the host attachment service): `sha256:` + 64-bit lowercase hex. */
const ATTACHMENT_ID = /^sha256:[a-f0-9]{64}$/;

/** Image retrieval field: undefined is returned for misses, and response is returned for hits. */
export async function handleAttachmentRoutes(deps: PetRouteDeps, input: RouteInput): Promise<RouteResult | undefined> {
  const { method, rest, url } = input;
  if (rest === 'attachment') {
    if (method !== 'GET') return { kind: 'text', status: 405, body: 'dsh-pet: method not allowed' };
    const id = url.searchParams.get('id') ?? '';
    if (!ATTACHMENT_ID.test(id)) return { kind: 'text', status: 400, body: 'dsh-pet: invalid attachment id' };
    const sink = deps.optionalService('attachments') as PetImageSink | undefined;
    // There is no attachment service in standalone mode: image acquisition is not available directly (the same downgrade conventions as the image capabilities of POST /chat)
    const file = locate(sink, id);
    if (file === undefined) return { kind: 'text', status: 404, body: 'dsh-pet: attachment not found' };
    const contentType = sniffImageType(file);
    if (contentType === undefined) {
      return { kind: 'text', status: 404, body: 'dsh-pet: attachment is not a displayable image' };
    }
    return { kind: 'file', file, contentType };
  }
  return undefined;
}

/** Use the attachment service to locate the object; if the service is missing, the backend is not a file, the reference is invalid, or the object has been cleared, undefined will be returned. */
function locate(sink: PetImageSink | undefined, id: string): string | undefined {
  if (typeof sink?.imageHostPath !== 'function') return undefined;
  try {
    const file: string | undefined = sink.imageHostPath({ attachmentId: id } as PetImageLocator);
    return file !== undefined && existsSync(file) ? file : undefined;
  } catch {
    // Invalid reference/backend rejection: To the client, it means "the image does not exist" and does not leak the internal error copy.
    return undefined;
  }
}

/** Determine the image type based on the file header; only recognize the four types saved by the attachment service, and return undefined if it cannot be read or recognized. */
function sniffImageType(file: string): string | undefined {
  try {
    const fd = openSync(file, 'r');
    try {
      const head = Buffer.alloc(IMAGE_HEAD_BYTES);
      return imageTypeOf(head, readSync(fd, head, 0, IMAGE_HEAD_BYTES, 0));
    } finally {
      closeSync(fd);
    }
  } catch {
    return undefined; // Cleaned up at the moment of reading / Insufficient permissions: also treated as non-existent
  }
}
