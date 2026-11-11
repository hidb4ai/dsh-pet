/**
 * Memory snapshot of desktop "live" (position + orientation).
 *
 * Responsible for narrowing the renderer report and saving a copy of the latest location according to the pet for
 * external reading: one for each window on the desktop, and only one copy for the global location. Reporting is
 * pushing + throttling when changes occur, not polling; the host only stores memory and does not write / state. Not
 * responsible for the web page: The location of the web pet is generated one copy per page, and the read-only service
 * petApi7340 in the page is used. There are no dependencies (pure memory state, empty when the host is restarted), and
 * the field names and coordinate conventions are consistent with the web page. It is always true: there is no TTL in
 * the snapshot, and updatedAt is the only basis for the caller to judge how recent the live stream is. See contracts
 * API.md and openapi.yaml.
 *
 * @module dsh-pet/src/host/pose
 */

/** Orientation (the same word as POST /anim’s facing, shared/state.ts’s PetFacing). */
export type PoseFacing = 'left' | 'right';

/** A live snapshot (the response body of GET /pose is its shallow copy + ok / petId). */
export interface PoseSnapshot {
  /** The normalized abscissa of the pet center (same conventions as POST /position, may be slightly out of bounds when welting). */
  x: number;
  /** The normalized vertical coordinate of the pet center, the conventions are the same as x. */
  y: number;
  /** Orientation. */
  facing: PoseFacing;
  /** The time reported by the renderer (epoch milliseconds), based on which the caller determines how new the live stream is. */
  updatedAt: number;
}

/** Writable snapshot triples (after narrowing). */
export type PoseInput = { x: number; y: number; facing: PoseFacing };

/**
 * Narrow the { x , y , facing } reported by the renderer.
 *
 * Different from the out-of-bounds clamping of / position, there is no range clamping here: when the pet is dragged to
 * the edge of the screen, the center point may be slightly out of bounds, and clamping will make the value read back
 * out of sight; but non-limited numbers (NaN / Infinity) are all rejected, and feeding that kind of value back will
 * only miscalculate the position of the renderer.
 */
export function normalizePoseInput(
  raw: unknown,
): { ok: true; pose: PoseInput } | { ok: false; reason: 'bad-request'; message: string } {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
  if (!o) return { ok: false, reason: 'bad-request', message: '请求体必须是对象：{ x, y, facing }' };
  if (typeof o.x !== 'number' || !Number.isFinite(o.x)) {
    return { ok: false, reason: 'bad-request', message: 'x 必须是有限数字（归一化横坐标）' };
  }
  if (typeof o.y !== 'number' || !Number.isFinite(o.y)) {
    return { ok: false, reason: 'bad-request', message: 'y 必须是有限数字（归一化纵坐标）' };
  }
  if (o.facing !== 'left' && o.facing !== 'right') {
    return { ok: false, reason: 'bad-request', message: 'facing 必须是 left / right' };
  }
  return { ok: true, pose: { x: o.x, y: o.y, facing: o.facing } };
}

/** Live snapshot table (one for each plugin instance; in-process memory state, empty when host restarts). */
export class PoseStore {
  // Using declare + constructor assignment: The class field initializer will downgrade @oxc - project/runtime external
  // helper, and it is an undeclared dependency and will be blocked by prepack validation check (same as ./state, ./
  // playback, ./lock).
  /** petId → Last live broadcast. */
  declare private readonly byPet: Map<string, PoseSnapshot>;
  /** Get the current time (can be injected: single test does not require true waiting time). */
  declare private readonly now: () => number;

  constructor(opts?: { now?: () => number }) {
    this.byPet = new Map();
    this.now = opts?.now ?? Date.now;
  }

  /** Overlay the live view of a pet and return the specified snapshot. */
  set(petId: string, pose: PoseInput): PoseSnapshot {
    const snap: PoseSnapshot = { x: pose.x, y: pose.y, facing: pose.facing, updatedAt: this.now() };
    this.byPet.set(petId, snap);
    return snap;
  }

  /** Read the latest live broadcast; it has never been reported and returns undefined (route returns pose-unavailable). */
  get(petId: string): PoseSnapshot | undefined {
    return this.byPet.get(petId);
  }

  /** Current snapshot number (for testing/observation). */
  count(): number {
    return this.byPet.size;
  }
}
