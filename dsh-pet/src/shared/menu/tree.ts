/**
 * Menu tree construction: Create levels from the animation list and third-party register items, and perform mirror
 * animation filtering.
 *
 * Do not touch DOM; the input is configuration and register data, and the output is a pure object tree. This must
 * always be true: the same input must result in the same tree, and the hierarchical order is stable.
 * @module dsh-pet/src/shared/menu/tree
 */
import { DISPLAY_HOTKEY_HINTS, DISPLAY_ORDER } from '../display-hotkey.ts';
import { type Animations, type Category, type PetDisplay } from '../types.ts';
import type { MenuBranch, MenuLeaf, MenuMoreItem, MenuNode } from './types.ts';

/**
 * Menu actions that are still allowed when sleeping: maintenance classes, "wake it up" itself, and third-party menu
 * items. It is up to the third party to decide what it wants to do - when it really drives the pet, it will occupy the
 * lock adjustment interface, and the host gate will be judged at that layer (lock priority). Blocking it first in the
 * renderer is equivalent to making the third-party entry point in "More" invalid when sleeping.
 */
const SLEEP_ALLOWED_ACTIONS: readonly string[] = ['sleep', 'wake', 'home', 'set-display', 'reload', 'third-party'];

/** Whether this menu action is allowed when sleeping (shared by both ends: dialogue pop-up window, to-do panel, action playback request are all renderer behaviors, and the host gate cannot block them). */
export const isSleepAllowedAction = (action: string | undefined): boolean =>
  action !== undefined && SLEEP_ALLOWED_ACTIONS.includes(action);

/** Menu copy for four display positions; the keys are elements of {@link DISPLAY_ORDER}, and the order is based on that side. */
const DISPLAY_LABELS: Readonly<Record<PetDisplay, string>> = {
  web: '仅网页',
  desktop: '仅桌面',
  both: '两者',
  none: '都不',
};

/**
 * "Display position" submenu: Inject the same copy at both ends, and the copy text is consistent with the display
 * position drop-down box on the settings page. Writing one copy on each end will inevitably drift, and this item is
 * semantically symmetrical: the desktop side uses it to send the pet away, and the browser side uses it to send it to
 * the desktop. "Neither" is a one-way door (the recovery entry point is the settings page), and the other three values
 * can be changed back from one end. The right keycap is derived from the same sequence of `1` - `4` numeric keys. To
 * change the sequence, only change {@link DISPLAY_ORDER} .
 */
export const displayMenuBranch = (): MenuBranch => ({
  label: '显示位置',
  children: DISPLAY_ORDER.map((display, index): MenuLeaf => ({
    label: DISPLAY_LABELS[display],
    action: 'set-display',
    display,
    hint: DISPLAY_HOTKEY_HINTS[index],
  })),
});

/** Third-party menu items are unified under this first-level menu (the host's own menu items are not included here). */
export const MORE_MENU_LABEL = '更多';

/**
 * Read the third-party menu items to be displayed on the local side from sections.menu.data of / state. target will be
 * accepted only if it is equal to the local identity or both; when target is missing or unknown, it will be processed
 * as both - the old host does not have this field, and would rather display it on both ends than let a third-party
 * menu in use disappear out of thin air. Snapshots come from the network, and fields are treated as "may not exist":
 * bad entries are silently discarded, and a single piece of data cannot crash the menu.
 */
export function readMenuItems(data: unknown, surface: 'web' | 'desktop'): MenuMoreItem[] {
  if (!data || typeof data !== 'object') return [];
  const items = (data as { items?: unknown }).items;
  if (!Array.isArray(items)) return [];
  const out: MenuMoreItem[] = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    // End filter: only recognize three literals, the rest (missing/badly written) will be treated as both
    const rawTarget = rec.target;
    const target = rawTarget === 'web' || rawTarget === 'desktop' || rawTarget === 'both' ? rawTarget : 'both';
    if (target !== 'both' && target !== surface) continue;
    const owner = rec.owner;
    const label = rec.label;
    if (typeof owner === 'string' && owner !== '' && typeof label === 'string' && label !== '') {
      out.push({ owner, label });
    }
  }
  return out;
}

/**
 * "More": a fixed container for third-party menu items; when there are no third-party items, null is returned, and the
 * empty "More" does not appear in the menu.
 *
 * The level is determined only by whether label has the same name: label is the only one among all third-party items →
 * directly tiled (`更多 / 弹弓`); label has the same name → each owner occupies a submenu (`更多 / owner / label`), which is
 * used to distinguish items with the same name. Duplicate names can only span owner (label within the same owner press
 * Map deduplicate, see the register table of host/menu), the sub-item is still the original label - click to report (
 * owner , label ) is exactly the same as when tiled, and there is no need to bifurcate when clicking on both ends.
 */
export function buildMoreBranch(items: readonly MenuMoreItem[]): MenuBranch | null {
  const labelCount = new Map<string, number>();
  for (const item of items) labelCount.set(item.label, (labelCount.get(item.label) ?? 0) + 1);
  const children: MenuNode[] = [];
  // owner → The submenu of the owner with the same name; when it encounters its duplicated item for the first time, insert children in the current order (maintaining the register order)
  const branches = new Map<string, MenuBranch>();
  for (const item of items) {
    if ((labelCount.get(item.label) ?? 0) === 1) {
      children.push({ label: item.label, action: 'third-party', owner: item.owner });
      continue;
    }
    let branch = branches.get(item.owner);
    if (branch === undefined) {
      branch = { label: item.owner, children: [] };
      branches.set(item.owner, branch);
      children.push(branch);
    }
    branch.children.push({ label: item.label, action: 'third-party', owner: item.owner });
  }
  return children.length > 0 ? { label: MORE_MENU_LABEL, children } : null;
}

/** Event name → classification label (event name itself is used when there is no mapping). */
const EVENT_LABELS: Record<string, string> = {
  balance: '余额档位',
  whisper: '碎碎念',
  workStatus: '工作状态',
};

/** Wrap the animation name into leaves. */
export const leaf = (anim: string): MenuLeaf => ({ label: anim, anim });

/** The menu tree is deduced from the resolved value animations configuration: first-level "action" → second-level classification → third-level animation name; empty pools and empty categories are automatically omitted. */
export function buildMenuTree(animations: Animations): MenuNode[] {
  const groups: MenuNode[] = [];
  const pools: Array<[string, string[]]> = [
    ['待机', animations.idle],
    ['转向', animations.turn],
    ['拖拽', animations.drag],
    ['点击回应', animations.clicks],
    ['移动', animations.moves.actions.map((m) => m.name)],
  ];
  for (const [label, pool] of pools) {
    if (pool.length) groups.push({ label, children: pool.map(leaf) });
  }
  // Random action classification: noMirror classification can still be used for playback request. When the playback end is facing right, it is forced to face left (see isNoMirrorAnimation)
  const cats = (animations.categories ?? []).filter((c) => c.actions.length > 0);
  for (const c of cats) {
    groups.push({ label: c.id, children: c.actions.map(leaf) });
  }
  // Event animation: Each event has a category, not from a random chain; the array slots are flattened to each leaf, and the candidates can be previewed by playback request.
  const events = animations.events ?? {};
  for (const key of Object.keys(events)) {
    const pool = events[key] ?? [];
    const names: string[] = [];
    for (const slot of pool) {
      if (typeof slot === 'string') names.push(slot);
      else names.push(...slot);
    }
    if (names.length) groups.push({ label: EVENT_LABELS[key] ?? key, children: names.map(leaf) });
  }
  if (!groups.length) return [];
  return [{ label: '动作', children: groups }];
}

/** Does the animation belong to the noMirror category (text category): When mirroring to the right, force it to the left before the playback request to avoid text mirroring. */
export function isNoMirrorAnimation(categories: Category[], anim: string): boolean {
  return (categories ?? []).some((c) => c.noMirror === true && c.actions.includes(anim));
}
