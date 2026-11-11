/**
 * Throwing physics: Throwing initial velocity estimation, gravity integration, boundary rebound and inter-screen
 * crossing.
 *
 * Does not handle pointer events and rendering; the input is coordinates and dt, and the output is the next frame
 * state. The impact is uniformly handed over to contact.ts and decomposed according to the normal direction of the
 * contact surface: normal rebound and tangential friction. This must always be true: the same input must result in the
 * same output, and both ends (browser and desktop) feel the same.
 * @module dsh-pet/src/shared/physics/throw
 */
import { type PhysicsParams, type Rect } from '../types.ts';
import { indexAtPoint, nearestIndex, rectBottom, rectRight } from '../displays.ts';
import { DEFAULT_PHYSICS, MAX_STEP_DT, SUBSTEP_MAX, SUBSTEP_PX } from './constants.ts';
import { type ContactEdge, isRestingOnContacts, resolveContact } from './contact.ts';

/** One trajectory sampling (t = performance.now() timestamp ms; x/y = pointer absolute coordinates px). */
export interface DragSample {
  t: number;
  x: number;
  y: number;
}

/** Throwing boundary: the allowed activity range of the upper left corner of the bounding box (the same set of body edge semantics as left/top of the browser root and the desktop window position). */
export interface ThrowBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Current state of the projectile (upper left corner of bounding box px + speed px/s). */
export interface ThrowState {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/** Calculate the throwing collision boundary from W/H/size: the body (sideAllow retracted inside the box) will only bounce when it touches the edge of the screen. */
export const throwBounds = (o: { W: number; H: number; size: number; sideAllow: number }): ThrowBounds => {
  const h = (o.size * 9) / 16;
  return { minX: -o.sideAllow, minY: 0, maxX: o.W - o.size + o.sideAllow, maxY: o.H - h };
};

/** Same as throwBounds, but based on any rectangle of the work area (the origin does not have to be 0); area is the same bit by bit when taking the entire viewport. */
export const throwBoundsIn = (area: Rect, size: number, sideAllow: number): ThrowBounds => {
  const h = (size * 9) / 16;
  return {
    minX: area.x - sideAllow,
    minY: area.y,
    maxX: rectRight(area) - size + sideAllow,
    maxY: rectBottom(area) - h,
  };
};

/**
 * Throwing space: one set of AABB for each screen, instead of one large AABB for the entire desktop. In an irregular
 * multi-screen layout, the bounding rectangle contains holes. Using it as a border will cause pets to fly into
 * invisible areas (see shared/displays.ts).
 */
export interface ThrowSpace {
  /** Allowable range of the upper left corner of the bounding box on a screen-by-screen basis (same order as areas) */
  bounds: ThrowBounds[];
  /** Screen-by-screen workspace (rebound and ownership determination; strips removed from the taskbar are not included in this list) */
  areas: Rect[];
  /**
   * Screen-by-screen complete panel (including taskbar area, same sequence as areas): Use the panel to detect whether
   * there are adjacent screens on the cross-border side - when the taskbar is located at the screen seam, there will
   * be a strip between the work areas that does not belong to any workArea. If detected by the work area, the seam
   * will be regarded as a wall. Default = areas (the two are equivalent in single screen).
   */
  panels: Rect[];
  /** Pet bounding box width */
  size: number;
  /** The amount of shrinkage of the body relative to the left and right sides of the bounding box */
  sideAllow: number;
}

/** Construct the throwing space from the workspace list (equivalent to throwBounds when using a single screen). */
export const throwSpace = (o: { areas: Rect[]; panels?: Rect[]; size: number; sideAllow: number }): ThrowSpace => ({
  bounds: o.areas.map((a) => throwBoundsIn(a, o.size, o.sideAllow)),
  areas: o.areas,
  panels: o.panels && o.panels.length === o.areas.length ? o.panels : o.areas, // Panels missing or out of order: degraded workspace
  size: o.size,
  sideAllow: o.sideAllow,
});

/** Which screen should the pet currently belong to: the screen where the center of the body is located, and when it falls into a hole, the closest one will be taken. */
export const screenOfBox = (space: ThrowSpace, x: number, y: number): number => {
  const cx = x + space.size / 2;
  const cy = y + (space.size * 9) / 16 / 2;
  const hit = indexAtPoint(space.areas, cx, cy);
  return hit >= 0 ? hit : nearestIndex(space.areas, cx, cy);
};

/** The edge hit in this step and the impact speed. */
export interface ThrowHit {
  /** Which side did it hit? */
  edge: ContactEdge;
  /** Absolute value of normal velocity before impact (px/s): Vibration intensity and extrusion intensity are calculated according to this. */
  speed: number;
}

/** Plane gravity vector (px/s²): The somatosensory mode assigns the direction of gravity to the posture of the phone, and the default is still vertically downward. */
export interface GravityVector {
  readonly gx: number;
  readonly gy: number;
}

/**
 * Projectile single-step integration and boundary rebound. The return value carries two flags: bounced = Whether this
 * step hits the edge or lands,
 * atRest = All contact surfaces are attached and the tangential speed is low, the caller should stop the cycle;
 * contacts = The edge contacted in this step. physics takes the physical parameters of the resolved value
 * configuration. If missing, the default value fallback is used; gravity covers the gravity direction and size
 * (default is vertical downward).
 */
export const throwStep = (
  s: ThrowState,
  dtRaw: number,
  b: ThrowBounds,
  physics: PhysicsParams = DEFAULT_PHYSICS,
  gravity?: GravityVector,
): ThrowState & { bounced: boolean; atRest: boolean; hit: ThrowHit | null; contacts: ContactEdge[] } => {
  const dt = Math.min(Math.max(dtRaw, 0), MAX_STEP_DT);
  const g: GravityVector = gravity ?? { gx: 0, gy: physics.gravity };
  let { x, y, vx, vy } = s;
  vx += g.gx * dt;
  vy += g.gy * dt;
  x += vx * dt;
  y += vy * dt;
  let bounced = false;
  let hit: ThrowHit | null = null;
  const contacts: ContactEdge[] = [];
  /** When two sides (corners) are hit in the same step, hit will retain the heavier one (the feel is only calculated based on the main impact), and contacts will be retained in full. */
  const record = (edge: ContactEdge, speed: number): void => {
    contacts.push(edge);
    if (hit === null || speed > hit.speed) hit = { edge, speed };
  };
  if (x < b.minX) {
    record('left', Math.abs(vx));
    x = b.minX;
    const out = resolveContact({ vx, vy }, 'left', physics, dt);
    vx = out.vx;
    vy = out.vy;
    bounced = true;
  } else if (x > b.maxX) {
    record('right', Math.abs(vx));
    x = b.maxX;
    const out = resolveContact({ vx, vy }, 'right', physics, dt);
    vx = out.vx;
    vy = out.vy;
    bounced = true;
  }
  if (y < b.minY) {
    // ceilingBounce = false: No boundary at the top, no clamping or bouncing - the pet flies out of the top of the screen and falls back by gravity (y remains out of bounds)
    if (physics.ceilingBounce) {
      record('ceiling', Math.abs(vy));
      y = b.minY;
      const out = resolveContact({ vx, vy }, 'ceiling', physics, dt);
      vx = out.vx;
      vy = out.vy;
      bounced = true;
    }
  } else if (y >= b.maxY) {
    record('floor', Math.abs(vy));
    y = b.maxY;
    const out = resolveContact({ vx, vy }, 'floor', physics, dt);
    vx = out.vx;
    vy = out.vy;
    bounced = true;
  }
  return { x, y, vx, vy, bounced, atRest: isRestingOnContacts(contacts, { vx, vy }), hit, contacts };
};

/**
 * Multi-screen throwing step: The physics is the same as throwStep. The difference is that the boundary is taken from
 * the screen where the center of the body is. After crossing the boundary, ask if there is a screen on the side of the
 * boundary. If there are other screens on the cross-border side, let it go as it is (no clamping or bouncing, it will
 * naturally fly across the screen or fall to the next screen). If there is nothing, just press that side to bounce.
 * Use the complete panel instead of the workspace for detection: When the taskbar is located at the seam between the
 * upper and lower screens, there will be a strip between workArea. If you detect by the workspace, the seam will be
 * used as a wall, and pets will never be able to get through. The detection point is the first pixel outside the edge
 * of the current panel, and the bottom of the panel is the bottom of the physical screen. When released, the position
 * is not changed and the current screen is not recorded. The next frame is repositioned by the center of the body -
 * AABB on two adjacent screens leaves a 2 × sideAllow wide overlapping blind area in the gap. If it is changed to "cut
 * the screen when crossing the boundary", it will jump frame by frame in the blind area. lockScreen ≥ 0 means locking
 * the screen (confineToScreen): the border always takes this screen and skips detection of adjacent screens. The
 * screen seam is like a hole as a wall; if the index crosses the border (unplug the monitor during flight), it will
 * return without locking, so as not to use a non-existent screen as a border.
 */
export const throwStepRegion = (
  s: ThrowState,
  dtRaw: number,
  space: ThrowSpace,
  physics: PhysicsParams = DEFAULT_PHYSICS,
  lockScreen = -1,
  gravity?: GravityVector,
): ThrowState & {
  screen: number;
  bounced: boolean;
  atRest: boolean;
  hit: ThrowHit | null;
  contacts: ContactEdge[];
} => {
  const dt = Math.min(Math.max(dtRaw, 0), MAX_STEP_DT);
  const g: GravityVector = gravity ?? { gx: 0, gy: physics.gravity };
  let { x, y, vx, vy } = s;
  vx += g.gx * dt;
  vy += g.gy * dt;
  x += vx * dt;
  y += vy * dt;
  if (space.areas.length === 0) {
    return { x, y, vx, vy, screen: -1, bounced: false, atRest: false, hit: null, contacts: [] };
  }

  const h = (space.size * 9) / 16;
  let bounced = false;
  let hit: ThrowHit | null = null;
  const contacts: ContactEdge[] = [];
  /** When hitting two sides in the same step, hit will keep the heavier one, which has the same conventions as {@link throwStep}; contacts will keep all of them. */
  const record = (edge: ContactEdge, speed: number): void => {
    contacts.push(edge);
    if (hit === null || speed > hit.speed) hit = { edge, speed };
  };
  // Locked screen (confineToScreen): The index is out of bounds (unplugging the monitor during the flight causes the number of screens to decrease), which means it is not locked.
  const locked = Number.isInteger(lockScreen) && lockScreen >= 0 && lockScreen < space.areas.length;
  /** Which screen should be used? AABB/Workspace/Panel: When locked, it will always be the locked screen, otherwise it will be the screen where the center of the body is. */
  const pick = (i: number): number => (locked ? lockScreen : i);

  // Horizontal: The boundary comes from the screen where the center of the body is. Whether to release or not depends on whether there are pixels at the same height outside the seam.
  let cur = screenOfBox(space, x, y);
  let b = space.bounds[pick(cur)];
  let a = space.areas[pick(cur)];
  const pa = space.panels[pick(cur)] || a;
  const cy = y + h / 2;
  if (x < b.minX) {
    if (locked || indexAtPoint(space.panels, pa.x - 1, cy) < 0) {
      record('left', Math.abs(vx));
      x = b.minX;
      const out = resolveContact({ vx, vy }, 'left', physics, dt);
      vx = out.vx;
      vy = out.vy;
      bounced = true;
    }
  } else if (x > b.maxX) {
    if (locked || indexAtPoint(space.panels, rectRight(pa), cy) < 0) {
      record('right', Math.abs(vx));
      x = b.maxX;
      const out = resolveContact({ vx, vy }, 'right', physics, dt);
      vx = out.vx;
      vy = out.vy;
      bounced = true;
    }
  }

  // Portrait: If the landscape is pinched back, the center of the body may have changed the screen and repositioned it.
  cur = screenOfBox(space, x, y);
  b = space.bounds[pick(cur)];
  a = space.areas[pick(cur)];
  const pa2 = space.panels[pick(cur)] || a;
  const cx = x + space.size / 2;
  if (y < b.minY) {
    // ceilingBounce = false: No border at the top, no clamping or bouncing - the pet flies out of the top of the screen and falls back by gravity
    if (physics.ceilingBounce && (locked || indexAtPoint(space.panels, cx, pa2.y - 1) < 0)) {
      record('ceiling', Math.abs(vy));
      y = b.minY;
      const out = resolveContact({ vx, vy }, 'ceiling', physics, dt);
      vx = out.vx;
      vy = out.vy;
      bounced = true;
    }
  } else if (y >= b.maxY) {
    // There is a screen below (a desktop arranged up and down) ⇒ It is not on the ground and continues to fall down
    if (locked || indexAtPoint(space.panels, cx, rectBottom(pa2)) < 0) {
      record('floor', Math.abs(vy));
      y = b.maxY;
      const out = resolveContact({ vx, vy }, 'floor', physics, dt);
      vx = out.vx;
      vy = out.vy;
      bounced = true;
    }
  }

  cur = pick(screenOfBox(space, x, y));
  return {
    x,
    y,
    vx,
    vy,
    screen: cur,
    bounced,
    atRest: isRestingOnContacts(contacts, { vx, vy }),
    hit,
    contacts,
  };
};

/**
 * How many steps should be accumulated in one frame (integer ≥ 1). N = 1 is the normal state: the displacement of one
 * frame of ordinary throwing is much less than 8 px; only when the slingshot is pulled very far and the initial
 * velocity is several thousand px/s, multiple steps can be taken. Otherwise, if one frame spans hundreds of px, the
 * landing and rebound frames will be skipped. dt is clamped by MAX_STEP_DT first (same internal origin as throwStep)
 * to ensure that the number of steps is the actual time to be accumulated.
 */
export const throwSubsteps = (vx: number, vy: number, dt: number): number => {
  const travel = Math.hypot(vx, vy) * Math.min(Math.max(dt, 0), MAX_STEP_DT);
  if (!(travel > SUBSTEP_PX)) return 1;
  return Math.min(SUBSTEP_MAX, Math.ceil(travel / SUBSTEP_PX));
};
