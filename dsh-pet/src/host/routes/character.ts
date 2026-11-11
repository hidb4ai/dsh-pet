/**
 * Character reference picture: `GET /character?root=<asset-root>` , press asset to return a picture bytes.
 *
 * Separately become an endpoint without combining `/pic` : The definition of pic is notification icons and emoticons.
 * Documents and directories will be distorted after character images are mixed in. The attribution follows the naming
 * of the avatar (`<asset-root>-character.<ext>`), with the user directory taking priority and fallback in the package. No
 * pictures are generated: only "What does it mean to look like this character" is delivered, and the picture
 * production and billing are all handled by the caller.
 * @module dsh-pet/src/host/routes/character
 */
import { join } from 'node:path';
import { isValidPetId } from '../config.ts';
import { MIME, resolveExisting } from '../http.ts';
import { PACKAGE_ROOT } from '../paths.ts';
import type { PetRouteDeps, RouteInput } from './types.ts';
import type { RouteResult } from '../http.ts';

/** assets root in the package: The character diagram is tiled here according to `<asset-root>-character.<ext>`, on the same layer as `logo.png`. */
const PACKAGE_ASSETS_DIR = join(PACKAGE_ROOT, 'assets');

/** Detection order: Normally there is only one copy. The order only affects which copy is taken when multiple copies coexist. */
const CHARACTER_EXTS: readonly string[] = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];

/** Hit character graph: absolute path vs. Content-Type pushed by extension. */
interface CharacterFile {
  readonly file: string;
  readonly contentType: string;
}

/**
 * Role map field: undefined is returned for misses, and response is returned for hits.
 *
 * There is no verification method, which is consistent with the `/logo` , `/thumb` , and `/pic` families: the asset
 * endpoint only looks at the path. To do method verification, add the entire family together. Written as the forward
 * branch of `rest === 'character'` instead of the reverse guard: scripts/check-openapi.mjs collects the route
 * implemented by the host according to this literal. The reverse writing method will cause the path in the document to
 * be false positive as "does not exist in the implementation".
 */
export async function handleCharacterRoutes(deps: PetRouteDeps, input: RouteInput): Promise<RouteResult | undefined> {
  if (input.rest !== 'character') return undefined;

  // The parameter is called root instead of pet: what is required here is the asset root (directory prefix), not pets []. id (same as / logo and / pet-avatar).
  const assetRoot = (input.url.searchParams.get('root') ?? '').trim();
  if (assetRoot === '') {
    return { kind: 'text', status: 400, body: 'dsh-pet: expected /dsh-pet-7340/character?root=<素材根>' };
  }
  // The asset root is an identifier and not a path fragment: the delimiter/reserved character is rejected and is earlier than any path concatenate.
  if (!isValidPetId(assetRoot)) return { kind: 'text', status: 400, body: 'dsh-pet: invalid asset root' };

  const found = findCharacter(deps.petConfigDir, assetRoot);
  if (found === undefined) return { kind: 'text', status: 404, body: 'dsh-pet: character not found' };
  return { kind: 'file', file: found.file, contentType: found.contentType };
}

/**
 * Resolve the character image from `pet/` first, then bundled assets.
 *
 * Try only allowlisted extensions; scanning user directories could mistake unrelated files for character artwork.
 * @param petDir - Directory containing pet-pack asset roots.
 * @param assetRoot - Validated asset root.
 * @returns The matching file, or undefined if none exists.
 */
function findCharacter(petDir: string, assetRoot: string): CharacterFile | undefined {
  const name = assetRoot + '-character';
  // The directory is in the outer layer and the extension is in the inner layer: any copy in the user directory precedes the package to prevent the user's webp from being pushed out by png in the package.
  for (const dir of [petDir, PACKAGE_ASSETS_DIR]) {
    for (const ext of CHARACTER_EXTS) {
      const hit = resolveExisting(dir, name + ext);
      if (hit !== undefined) return { file: hit, contentType: MIME[ext] ?? 'application/octet-stream' };
    }
  }
  return undefined;
}
