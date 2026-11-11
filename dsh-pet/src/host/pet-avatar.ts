/**
 * Pet avatar access: `pet/<asset-root>-avatar.<ext>` , which has the same asset root name as `-animation/` and `-memes/` .
 *
 * Do not write the avatar field in the configuration - the ownership is determined by the file itself in the
 * directory. Deleting the file will return to the default logo. The extension depends on the file's magic number, and
 * you don't believe the file name given by the uploader; when changing formats, try your best to clear the old
 * extension, and the detection will still take the latest one based on the modification time, so even if the old file
 * cannot be deleted (Windows is being read), the new avatar will not be pushed back.
 * @module dsh-pet/src/host/pet-avatar
 */
import { existsSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { IMAGE_HEAD_BYTES, MIME, imageExtOf, imageTypeOf, resolveAsset } from './http.ts';

/** Detection order: Under normal circumstances, the same asset root has only one avatar file, and the order only affects the traversal order when multiple copies exist at the same time. */
const AVATAR_EXTS: readonly string[] = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];

/** A pet's custom avatar: absolute file path with its Content-Type. */
export interface PetAvatarFile {
  readonly file: string;
  readonly contentType: string;
}

/**
 * Find a custom avatar for a pet.
 *
 * When multiple copies are stored together, the one with the latest modification time will be used: when the format is
 * changed but the old file is not deleted, the one just uploaded by the user will be displayed.
 *
 * @param avatarDir - `pet/` directory (the file pet directory in `ConfigPaths` ).
 * @param petId - asset root; the caller must first block the invalid character with isValidPetId.
 * @returns avatar file; undefined when not uploaded, default logo in the caller fallback package.
 */
export function petAvatarFile(avatarDir: string, petId: string): PetAvatarFile | undefined {
  let best: PetAvatarFile | undefined;
  let bestMtime = -Infinity;
  for (const ext of AVATAR_EXTS) {
    const file = resolveAsset(avatarDir, petId + '-avatar' + ext);
    if (file === undefined || !existsSync(file)) continue;
    let mtime: number;
    try {
      mtime = statSync(file).mtimeMs;
    } catch {
      continue; // The moment of detection was deleted/no permission to read: As if there is no such thing, continue to the next extension.
    }
    if (mtime > bestMtime) {
      bestMtime = mtime;
      best = { file, contentType: MIME[ext] ?? 'application/octet-stream' };
    }
  }
  return best;
}

/** Save conclusion: Success, or file by reason - the copy and status code are translated from the route layer into HTTP conclusion. */
export type PetAvatarSave = { ok: true } | { ok: false; reason: 'not-image' | 'write-failed' };

/**
 * Overwriting a pet's avatar.
 *
 * @param avatarDir - `pet/` directory.
 * @param petId - asset root; the caller must first block the invalid character with isValidPetId.
 * @param bytes - image bytes that has passed volume verification.
 * @returns saves the conclusion; the file header does not look like a supported picture or the reason is given when
 * writing to disk fails.
 */
export function savePetAvatar(avatarDir: string, petId: string, bytes: Buffer): PetAvatarSave {
  const contentType = imageTypeOf(bytes, Math.min(bytes.length, IMAGE_HEAD_BYTES));
  const ext = contentType === undefined ? undefined : imageExtOf(contentType);
  if (ext === undefined) return { ok: false, reason: 'not-image' };
  const file = resolveAsset(avatarDir, petId + '-avatar' + ext);
  if (file === undefined) return { ok: false, reason: 'write-failed' };
  // When changing the format (png → jpg), try to delete old files: petAvatarFile has been pressed mtime fallback, here we just don’t let the old pictures occupy the disk.
  for (const other of AVATAR_EXTS) {
    if (other === ext) continue;
    const stale = resolveAsset(avatarDir, petId + '-avatar' + other);
    if (stale === undefined) continue;
    try {
      unlinkSync(stale);
    } catch {
      // Does not exist or is occupied by another process: this save should not fail.
    }
  }
  try {
    writeFileSync(file, bytes);
  } catch {
    return { ok: false, reason: 'write-failed' };
  }
  return { ok: true };
}
