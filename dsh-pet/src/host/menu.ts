/**
 * Third-party right-click menu register table (process memory state, DSH will clear when restarting, not persist to
 * disk).
 *
 * The register party uses its own owner register menu item, and then uses the same owner to check "whether my item has
 * been clicked and on which pet it was clicked on"; it is not responsible for menu rendering and click hits (filter by
 * target on both ends and then spell "more" by yourself). It must always be true: register is the overall coverage of
 * the owner level, and the menu item lifecycle is consistent with the plugin; clicking is a latch, not a queue (you
 * can only see it once after clicking twice); querying is clear (reading means consumption, no confirmation or
 * re-investment); one owner should only have one consumer, and the two processes will check and compete for each other
 * at the same time. See the constants below for limits; see API.md and openapi.yaml for contracts.
 * @module dsh-pet/src/host/menu
 */

/** owner maximum length. */
const OWNER_MAX = 64;
/** The upper limit of the length of a single menu item label (panel width 150–240 px, any longer will be truncated by ellipses). */
const LABEL_MAX = 32;
/** Upper limit of menu items per owner. */
const ITEMS_MAX = 20;
/** Global owner upper limit. */
const OWNERS_MAX = 32;
/** The upper limit of long polling wait (same magnitude as / state: the caller can hang for this long at most at one time). */
export const MENU_WAIT_MAX_MS = 10_000;

/** Control character (line breaks, tabs, etc. will mess up the menu layout and will be rejected). */
// eslint-disable-next-line no-control-regex -- Reject ASCII controls and DEL in menu labels to protect layout.
const CONTROL_CHARS = /[\x00-\x1f\x7f]/;

/** A menu item snapshot (sections.menu written into / state, both ends spell "more" accordingly). */
export interface MenuItemSnapshot {
  owner: string;
  label: string;
  /** On which end should this item appear: Each end is filtered according to its own end (shared/menu of readMenuItems) */
  target: MenuTarget;
}

/** On which side the menu items are displayed. */
export type MenuTarget = 'web' | 'desktop' | 'both';

/** Valid target value. */
const MENU_TARGETS: ReadonlySet<string> = new Set<string>(['web', 'desktop', 'both']);

/** Default target = Display both ends (= behavior before adding this field). */
const DEFAULT_TARGET: MenuTarget = 'both';

/** Reason for register/clear failure: `reason` is entered into the response body as it is, and the value is constrained by the failure entity of the route layer. */
export type MenuFailure =
  | 'bad-request'
  | 'invalid-owner'
  | 'invalid-labels'
  | 'invalid-label'
  | 'invalid-target'
  | 'too-many-items'
  | 'too-many-owners';

/** register result: business failure returns `{ ok:false, reason, message }` (HTTP 200) according to plugin conventions, not 400. */
export type MenuRegisterResult = { ok: true } | { ok: false; reason: MenuFailure; message: string };

/** Verify a display character string: it must be string, trim followed by non-empty, not over-long, and no control character. */
function displayText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (text === '' || text.length > max || CONTROL_CHARS.test(text)) return null;
  return text;
}

/** In-process register table of third-party menu items: register, clear, click to report, long polling query. */
export class MenuRegistry {
  // Use declare + constructor assignment (without class field initializer): the class field will be downgraded to @oxc
  // - project/runtime external helper, and it is an undeclared dependency and will be blocked by prepack validation
  // check (same agreement with src/host/state.ts).
  /** owner → { target , items }; items = label → trigger its petId ( null = not triggered) */
  declare private readonly owners: Map<string, { target: MenuTarget; items: Map<string, string | null> }>;
  /** owner → long polling wakeup callback hanging on the owner */
  declare private readonly waiters: Map<string, Set<() => void>>;

  constructor() {
    this.owners = new Map();
    this.waiters = new Map();
  }

  /**
   * register (overall coverage): `{ owner, labels: string[], target?: 'web' | 'desktop' | 'both' }` .
   *
   * The coverage granularity is the entire owner: the register side uses a complete list to describe "what I have now"
   * every time. There is no need to care about what was registered last time, and no zombie items that have been
   * offline will be left. `target` is optional, defaults to `both` (old caller has zero changes), and is overwritten
   * together with labels.
   */
  register(raw: unknown): MenuRegisterResult {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { ok: false, reason: 'bad-request', message: 'body 必须是 { owner, labels, target? }' };
    }
    const body = raw as Record<string, unknown>;
    const owner = displayText(body.owner, OWNER_MAX);
    if (owner === null) {
      return { ok: false, reason: 'invalid-owner', message: `owner 必须是 1–${OWNER_MAX} 字符的字符串（禁控制字符）` };
    }

    const rawLabels = body.labels;
    if (!Array.isArray(rawLabels) || rawLabels.length === 0) {
      return { ok: false, reason: 'invalid-labels', message: 'labels 必须是非空数组' };
    }
    if (rawLabels.length > ITEMS_MAX) {
      return { ok: false, reason: 'too-many-items', message: `每个 owner 最多 ${ITEMS_MAX} 项` };
    }

    const labels: string[] = [];
    for (const rawLabel of rawLabels) {
      const label = displayText(rawLabel, LABEL_MAX);
      if (label === null) {
        return {
          ok: false,
          reason: 'invalid-label',
          message: `每个 label 必须是 1–${LABEL_MAX} 字符的字符串（禁控制字符）`,
        };
      }
      if (!labels.includes(label)) labels.push(label); // Same as deduplicate in owner (retain the position of the first occurrence)
    }

    if (!this.owners.has(owner) && this.owners.size >= OWNERS_MAX) {
      return { ok: false, reason: 'too-many-owners', message: `最多 ${OWNERS_MAX} 个 owner` };
    }
    // target Optional: Do not write / null = both (the old caller does not need to change a word when it only passes
    // owner + labels); if written, it must be one of the three literals - invalid values only report an error and do
    // not guess, lest the third party thinks that the register is successful but cannot see the menu.
    const rawTarget = body.target;
    let target: MenuTarget = DEFAULT_TARGET;
    if (rawTarget !== undefined && rawTarget !== null) {
      if (typeof rawTarget !== 'string' || !MENU_TARGETS.has(rawTarget)) {
        return {
          ok: false,
          reason: 'invalid-target',
          message: 'target 只能是 web / desktop / both（不写 = both）',
        };
      }
      target = rawTarget as MenuTarget;
    }
    this.owners.set(owner, { target, items: new Map(labels.map((label) => [label, null] as const)) });
    return { ok: true };
  }

  /**
   * Clear all the menu items of a owner (including the unremoved trigger mark on it).
   *
   * Idempotent: owner does not exist → `removed: 0` , it is still considered successful, and the caller should not see
   * errors when it retries to log out. The long polling hanging on the owner will be woken up, and owner cannot be
   * found after waking up → route back to `unknown-owner` .
   */
  clear(rawOwner: unknown): { ok: true; removed: number } | { ok: false; reason: MenuFailure; message: string } {
    const owner = displayText(rawOwner, OWNER_MAX);
    if (owner === null) {
      return { ok: false, reason: 'invalid-owner', message: `owner 必须是 1–${OWNER_MAX} 字符的字符串（禁控制字符）` };
    }
    const entry = this.owners.get(owner);
    if (!entry) return { ok: true, removed: 0 };
    const removed = entry.items.size;
    this.owners.delete(owner);
    const waiters = this.waiters.get(owner);
    this.waiters.delete(owner);
    if (waiters) for (const wake of [...waiters]) wake();
    return { ok: true, removed };
  }

  /** Full snapshot (written into state; order = register order + list order, the rendering order at both ends is consistent with it). */
  snapshot(): MenuItemSnapshot[] {
    const out: MenuItemSnapshot[] = [];
    for (const [owner, entry] of this.owners) {
      for (const label of entry.items.keys()) out.push({ owner, label, target: entry.target });
    }
    return out;
  }

  /**
   * renderer reports a click: mark the item as "clicked by petId" and wake up the long polling hanging on owner.
   *
   * `delivered = false` (item does not exist: the menu has just been overwritten and has not been registered yet) is
   * not an error - the renderer takes the previous tick / state snapshot. The menu has changed at this time, which is
   * a normal race condition, and the route still returns 200.
   */
  click(raw: unknown): { ok: true; delivered: boolean } {
    const body = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    const owner = typeof body.owner === 'string' ? body.owner : '';
    const label = typeof body.label === 'string' ? body.label : '';
    const pet = typeof body.pet === 'string' ? body.pet.trim() : '';
    const entry = this.owners.get(owner);
    if (!entry || !entry.items.has(label) || pet === '') return { ok: true, delivered: false };
    entry.items.set(label, pet);
    const waiters = this.waiters.get(owner);
    if (waiters) for (const wake of [...waiters]) wake();
    return { ok: true, delivered: true };
  }

  /**
   * Query trigger: Return `{ label: petId | null }` full mapping, and return clear these marks.
   *
   * `waitMs > 0` and there is no trigger at the moment → suspend and wait (it will wake up if it is clicked, times
   * out, or overwritten). After timeout, it will return to the mapping of all null as usual. owner does not exist →
   * null (route returns 404, and the caller knows to re-register accordingly).
   */
  async poll(owner: string, waitMs: number): Promise<Record<string, string | null> | null> {
    const entry = this.owners.get(owner);
    if (!entry) return null;

    if (waitMs > 0 && !hasFired(entry.items)) {
      await new Promise<void>((resolve) => {
        const set = this.waiters.get(owner) ?? new Set<() => void>();
        this.waiters.set(owner, set);
        const hold: { timer?: ReturnType<typeof setTimeout> } = {};
        let settled = false;
        const finish = (): void => {
          if (settled) return;
          settled = true;
          if (hold.timer !== undefined) clearTimeout(hold.timer);
          set.delete(finish);
          if (set.size === 0 && this.waiters.get(owner) === set) this.waiters.delete(owner);
          resolve();
        };
        hold.timer = setTimeout(finish, Math.min(waitMs, MENU_WAIT_MAX_MS));
        set.add(finish);
      });
    }

    // It may be completely overwritten during the waiting period (register new labels) - retrieval, do not take the result of the old Map
    const current = this.owners.get(owner);
    if (!current) return null;
    const out: Record<string, string | null> = {};
    for (const [label, pet] of current.items) {
      out[label] = pet;
      current.items.set(label, null); // Read and consume
    }
    return out;
  }
}

/** Has any item in this owner been clicked currently? */
function hasFired(items: Map<string, string | null>): boolean {
  for (const pet of items.values()) if (pet !== null) return true;
  return false;
}
