/**
 * The "Pictures" branch of the right-click menu: divide the list of emoticons into two groups: "Pictures included in
 * the conversation" and "Others" according to configuration. It does not read the disk or determine whether the file
 * is still there - that is the host's pool determination; here it is only grouped according to configuration, so the
 * client does not need to connect to the Internet to get the list.
 * @module dsh-pet/src/shared/menu/memes
 */
import type { MenuBranch, MenuLeaf, MenuNode } from './types.ts';

/** Group by: Entry-level three configurations that the merger has blown into each pet. */
export interface MemeGroupSource {
  /** Meme list (name → description); by default, it is processed as an empty pool. */
  readonly memes?: Record<string, string> | undefined;
  /** Conversation graphics switch: There is no "Include Conversation" group when turned off. */
  readonly chatImageEnabled?: boolean | undefined;
  /** The upper limit of the number of dialogue pictures; 0 or non-limited number = no limit. */
  readonly chatImageLimit?: number | undefined;
}

/** Two sets of names: those available for dialogue and the rest. The sum of the two is all available pictures. */
export interface MemeGroups {
  readonly chat: readonly string[];
  readonly other: readonly string[];
}

/**
 * List of available picture names: those with empty descriptions are not counted.
 *
 * The same conventions as the host's pool judgment (`host/memes`'s readMemePool requires the description to be
 * non-empty): the model can recognize this picture only by describing it, and items without description cannot enter
 * the dialogue and whisper even if the file exists. The order preserves the writing order in the configuration.
 */
function usableNames(memes: MemeGroupSource['memes']): string[] {
  if (!memes || typeof memes !== 'object' || Array.isArray(memes)) return [];
  const out: string[] = [];
  for (const [name, desc] of Object.entries(memes)) {
    if (!name.trim()) continue;
    if (typeof desc !== 'string' || desc.trim() === '') continue;
    out.push(name);
  }
  return out;
}

/**
 * Split the available graphs into two groups according to configuration.
 *
 * @param source - entry-level emoticon configuration.
 * @returns conversation group (empty when switch is off) and remaining groups.
 */
export function groupMemes(source: MemeGroupSource): MemeGroups {
  const names = usableNames(source.memes);
  const limit = Math.floor(Number(source.chatImageLimit));
  // Same conventions as host limitPool: 0 / negative number / non-finite number = no limit, take the full amount.
  const unlimited = !Number.isFinite(limit) || limit <= 0;
  const take = source.chatImageEnabled !== true ? 0 : unlimited ? names.length : Math.min(limit, names.length);
  return { chat: names.slice(0, take), other: names.slice(take) };
}

/** Single picture → Menu leaf: Click it to "use this picture to say something"; bring it with the thumbnail address, and the menu will draw a small picture accordingly. */
function memeLeaf(name: string, thumbOf?: (name: string) => string): MenuLeaf {
  const leaf: MenuLeaf = { label: name, action: 'whisper', image: name };
  if (thumbOf) leaf.thumb = thumbOf(name);
  return leaf;
}

/**
 * Meme picture address: `<prefix>/pic/memes/<asset-root>/<name>.png` .
 *
 * The prefixes at both ends are different (the browser is a route prefix, the desktop is an absolute address), and the
 * asset root defaults to `main` - consistent with the ownership semantics of host / pic: asset root = entry key, which
 * determines which directory chain to follow. The name contains Chinese characters and must be encoded in its
 * entirety.
 *
 * @param baseUrl - route prefix or absolute address (without trailing slash).
 * @param assetRoot - entry key (= asset root); default or empty string `main` .
 * @param name - meme name (key in configuration, excluding extension).
 * @returns can be directly used as the complete address of img src.
 */
export function memeThumbUrl(baseUrl: string, assetRoot: string | undefined, name: string): string {
  const root = assetRoot && assetRoot.trim() !== '' ? assetRoot : 'main';
  return baseUrl + '/pic/memes/' + encodeURIComponent(root) + '/' + encodeURIComponent(name) + '.png';
}

/**
 * Create a "Picture" menu branch; return null when no picture is available (the caller does not insert this item
 * accordingly).
 *
 * If the group is empty, it will not appear: When the switch is off, only the "Other" group is left, and only one
 * group will still have this sub-menu - tiling will cause the picture names to be mixed into the "Check
 * Balance/Whisper" column, but it will not be seen that they are accompanying pictures.
 *
 * @param source - entry-level meme configuration.
 * @param thumbOf - Optional: name → thumbnail address. Each item in the menu is given a small picture, and the default
 * is only text.
 * @returns "Pictures → (Pictures included in the dialogue/others)" two-level branch.
 */
export function buildMemeBranch(source: MemeGroupSource, thumbOf?: (name: string) => string): MenuBranch | null {
  const { chat, other } = groupMemes(source);
  const leaf = (name: string): MenuLeaf => memeLeaf(name, thumbOf);
  const groups: MenuNode[] = [];
  if (chat.length > 0) groups.push({ label: '纳入对话的配图', children: chat.map(leaf) });
  if (other.length > 0) groups.push({ label: '其他', children: other.map(leaf) });
  if (groups.length === 0) return null;
  return { label: '配图', children: groups };
}
