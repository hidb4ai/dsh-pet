/**
 * In-page mirroring of third-party menus: Which menu items are on this page and which item is clicked? Press owner to
 * separate the keys. The shape is consistent with host registry. No long polling: read and consume, return the same
 * result as `GET /menu/events` , the consumer does not need to change the parsing when calling. Page-level status, not
 * shared between tabs; `/state` has no items before the first shot, and any owner is considered unknown.
 * @module dsh-pet/src/client/menu-service
 */

/** A click mapping of owner: label → which pet was clicked (null = not clicked). */
export type MenuMarks = Record<string, string | null>;

/** Reading result: Same shape as the response body of `GET /menu/events`. */
export type MenuEventsResult = { ok: true; events: MenuMarks } | { ok: false; reason: 'unknown-owner' };

/** owner → List of label visible on this page (source is sections.menu snapshot of / state). */
const labels = new Map<string, string[]>();

/** owner → Click latch for each item (click the same item twice, leaving only the last one, consistent with host). */
const marks = new Map<string, Map<string, string | null>>();

/**
 * Replace the menu items on this page with the latest snapshot (the only call point is pet/multi where the menu
 * snapshot is updated).
 *
 * @param items - Third-party menu items visible on this end; overwrites the entire menu and does not retain the last
 * item.
 */
export function setMenuItems(items: readonly { owner: string; label: string }[]): void {
  labels.clear();
  for (const item of items) {
    const list = labels.get(item.owner);
    if (list === undefined) labels.set(item.owner, [item.label]);
    else if (!list.includes(item.label)) list.push(item.label);
  }
  // The latch follows the item: the mark of the offline item is no longer readable to prevent owner from reading the last remnant after re-registering.
  for (const [owner, entry] of marks) {
    const list = labels.get(owner);
    if (list === undefined) {
      marks.delete(owner);
      continue;
    }
    for (const label of [...entry.keys()]) {
      if (!list.includes(label)) entry.delete(label);
    }
  }
}

/**
 * Record a click (called when renderer dispatches third-party items).
 *
 * Even if owner hasn't been taken into the snapshot yet, take note of it: `/state` may be taken a little late, and if
 * you throw it away, you won't be able to get it again.
 *
 * @param owner - register party identity.
 * @param label - the name of the item being clicked.
 * @param pet - Which pet was clicked on.
 */
export function setMenuClick(owner: string, label: string, pet: string): void {
  let entry = marks.get(owner);
  if (entry === undefined) {
    entry = new Map();
    marks.set(owner, entry);
  }
  entry.set(label, pet);
}

/**
 * Read and consume: Return the result with the same shape as `GET /menu/events` . After reading, all marks are cleared
 * to null.
 *
 * @param owner - register party identity.
 * @returns The items visible on this page and their click results; this owner is `unknown-owner` when there are no
 * items on this page.
 */
export function takeMenuEvents(owner: string): MenuEventsResult {
  const list = labels.get(owner);
  if (list === undefined) return { ok: false, reason: 'unknown-owner' };
  const entry = marks.get(owner);
  const events: MenuMarks = {};
  for (const label of list) {
    events[label] = entry?.get(label) ?? null;
    entry?.set(label, null);
  }
  return { ok: true, events };
}

/** clear menu image of this page; for testing. */
export function resetMenuEvents(): void {
  labels.clear();
  marks.clear();
}
