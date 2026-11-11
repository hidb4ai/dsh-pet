/**
 * Selection and local preview of conversation pictures: Determine whether it is a picture and read data URL as a
 * thumbnail. No compression, no encoding, no sending over the Internet - the step of actually sending the image is
 * added when accessing, and the budget logic will also fall here.
 * @module dsh-pet/src/shared/chat/image-pick
 */

/** Image type consistent with host attachment service whitelist. */
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;

/** Image media type. */
export type PetImageMediaType = (typeof IMAGE_TYPES)[number];

/** The accept value of `<input type=file>` maintains the same fact as {@link IMAGE_TYPES}. */
export const IMAGE_ACCEPT = IMAGE_TYPES.join(',');

/** Extension fallback: Drag and drop or some system sources do not give `file.type`. */
const IMAGE_EXT: Record<string, PetImageMediaType> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
};

/**
 * Image media type of the file: Use it if the declared type is in the whitelist, otherwise fallback according to the
 * extension.
 *
 * @param file - Files selected, dragged or pasted by the user.
 * @returns is a type in the whitelist; if not recognized, undefined is returned.
 */
export function imageMediaTypeOf(file: File): PetImageMediaType | undefined {
  const declared = String(file.type || '').toLowerCase();
  if ((IMAGE_TYPES as readonly string[]).includes(declared)) return declared as PetImageMediaType;
  const ext = String(file.name || '')
    .split('.')
    .pop()
    ?.toLowerCase();
  return ext === undefined ? undefined : IMAGE_EXT[ext];
}

/**
 * Is this file a sendable image?
 *
 * @param file - Files selected or dragged in by the user.
 * The declared type @returns is in the whitelist, or true when the extension hits the fallback table.
 */
export function isImageFile(file: File): boolean {
  return imageMediaTypeOf(file) !== undefined;
}

/** Whether the drag and drop will carry the file this time (deciding whether dragover or preventDefault). */
export function dragHasFiles(e: { readonly dataTransfer: DataTransfer | null }): boolean {
  const types = e.dataTransfer?.types;
  if (!types) return false;
  return Array.from(types).includes('Files');
}

/** The first sendable picture in the dragged file; undefined is not returned. */
export function firstImageFile(dataTransfer: DataTransfer | null): File | undefined {
  const files = dataTransfer?.files;
  if (!files) return undefined;
  for (const file of Array.from(files)) {
    if (isImageFile(file)) return file;
  }
  return undefined;
}

/** Structural subset of clipboard data: only files and items are required, and the test can feed fake objects. */
export interface ClipboardLike {
  readonly files?: ArrayLike<File> | null;
  readonly items?: ArrayLike<{ readonly kind: string; getAsFile(): File | null }> | null;
}

/**
 * The first sendable picture in the clipboard.
 *
 * First look at `files` (the screenshot tool and resource manager will fill in the file when copying it), and then go
 * back to `items` : Some sources only put the image into items (`kind === 'file'`), and read-only files will appear as
 * "sticky and unresponsive" without reporting an error.
 *
 * @param data - clipboardData or a subset of its structure that pastes events.
 * @returns first image; plain text paste returns undefined (the caller does not intercept the default behavior
 * accordingly).
 */
export function firstImageFromClipboard(data: ClipboardLike | null | undefined): File | undefined {
  if (!data) return undefined;
  const files = data.files;
  if (files) {
    for (const file of Array.from(files)) {
      if (isImageFile(file)) return file;
    }
  }
  const items = data.items;
  if (!items) return undefined;
  for (const item of Array.from(items)) {
    if (item.kind !== 'file') continue;
    const file = item.getAsFile();
    if (file && isImageFile(file)) return file;
  }
  return undefined;
}
