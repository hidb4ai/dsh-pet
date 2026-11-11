/**
 * Pure decision-making layer for position/throw instructions (`POST /dsh-pet-7340/position`,
 * `POST /dsh-pet-7340/throw` ).
 *
 * The same division of labor as ./anim: only determine whether it should be accepted and what it should be, without
 * touching HTTP or S. It can be completely offline and single tested. Not responsible for kinematics: throw the
 * existing startThrow of reuse renderer, and the three paths of position also have existing kinematics. Only parameter
 * verification and coordinate clamping are left in this layer. Must always be true: `?pet=` is required and must
 * really exist, and will never be returned to the first one in the list by default. See contracts API.md and
 * openapi.yaml.
 * @module dsh-pet/src/host/motion-cue
 */

import { flattenPetList } from './config.ts';

/** Classification of acceptance failure (route is exposed to the caller as it is, the same vocabulary as ./anim). */
export type MotionFailure = 'bad-request' | 'pet-required' | 'unknown-pet';

/**
 * Motion mode of position command (choose one from three). The union with the same name as shared/state.ts is two
 * copies (host is not import src/shared), and both sides must be changed together when changing.
 */
export type PositionMode = 'instant' | 'spring' | 'line';

/** Valid mode set: Check and error information share one. */
export const POSITION_MODES: readonly PositionMode[] = ['instant', 'spring', 'line'];

/** Position decision conclusion: If passed, the final content to be written into S will be given (`duration` is `null` = this mode does not take time). */
export type PositionDecision =
  | { ok: true; petId: string; x: number; y: number; mode: PositionMode; duration: number | null }
  | { ok: false; reason: MotionFailure; message: string };

/** Throw decision conclusion. */
export type ThrowDecision =
  { ok: true; petId: string; angle: number; power: number } | { ok: false; reason: MotionFailure; message: string };

/** Clamped to 0~1: the valid range of normalized coordinates, clamping out of bounds instead of rejecting (the value after clamping is returned in the response). */
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** Limited numbers are narrowed: character strings, Boolean, NaN, Infinity are not counted (this is also the case in the configuration). */
const finite = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** The mode is narrowed: only three literals are recognized (uppercase and lowercase, blank, and non-character strings are not counted). If not recognized, `null` is returned. */
const positionMode = (v: unknown): PositionMode | null =>
  typeof v === 'string' && (POSITION_MODES as readonly string[]).includes(v) ? (v as PositionMode) : null;

/**
 * Target pet resolution (same conventions as ./anim, ./broadcast): `?pet=` is required and must actually exist. Two
 * types of failures are reported separately: not given → `pet-required` ; given but not → `unknown-pet` in the
 * configuration.
 */
function resolvePet(
  cfg: Record<string, Record<string, unknown>>,
  requested: string,
): { ok: true; petId: string } | { ok: false; reason: MotionFailure; message: string } {
  const petId = String(requested ?? '').trim();
  if (!petId) return { ok: false, reason: 'pet-required', message: 'pet 必填：要指定操作哪只桌宠' };
  if (!flattenPetList(cfg).some((p) => String(p.id) === petId)) {
    return { ok: false, reason: 'unknown-pet', message: '没有这只桌宠：' + petId };
  }
  return { ok: true, petId };
}

/**
 * Check the external location request into a conclusion.
 *
 * `x` / `y` are the normalized coordinates (0~1) of the pet center: the front-end persistent position `customPos`
 * stores the center, and the caller does not need to know how old the pet is. `duration` is only required by the
 * `line` mode (non-negative finite number, `0` = immediately available), and the other two modes are not looked at if
 * given - the caller often reuses the entire body template, and reporting an error will only force them to delete
 * fields. Verification sequence: x/y → mode → duration → Pet analysis; the parameter is the caller’s fault, correct it
 * first.
 *
 * @param args - Positioning parameters: `requested` is the original value of `?pet=` (empty string → `pet-required` );
 * `mode` is required
 * (`instant` / `spring` / `line` ); `duration` Required for `line` mode only (milliseconds).
 */
export function decidePosition(args: {
  cfg: Record<string, Record<string, unknown>>;
  /** The original value of `?pet=` (required: empty string → `pet-required`) */
  requested: string;
  x: unknown;
  y: unknown;
  /** Required: `instant` / `spring` / `line` */
  mode?: unknown;
  /** Required only for `line` mode: travel time (milliseconds), non-negative finite number, `0` = immediately in place */
  duration?: unknown;
}): PositionDecision {
  const x = finite(args.x);
  if (x === null) return { ok: false, reason: 'bad-request', message: 'x 必须是有限数字' };
  const y = finite(args.y);
  if (y === null) return { ok: false, reason: 'bad-request', message: 'y 必须是有限数字' };

  const mode = positionMode(args.mode);
  if (mode === null) {
    return { ok: false, reason: 'bad-request', message: 'mode 必须是 instant / spring / line' };
  }
  let duration: number | null = null;
  if (mode === 'line') {
    const d = finite(args.duration);
    if (d === null || d < 0) {
      return { ok: false, reason: 'bad-request', message: 'line 模式的 duration 必须是非负有限数字（毫秒）' };
    }
    duration = d;
  }

  const pet = resolvePet(args.cfg, args.requested);
  if (!pet.ok) return pet;

  return { ok: true, petId: pet.petId, x: clamp01(x), y: clamp01(y), mode, duration };
}

/**
 * Decision conclusion → Write the load of the S leaf. The non-`line` mode does not have `duration` : the leaf shape
 * itself is semantic (with `duration` it means "walking in a straight line according to time"), and it saves the front
 * end from reading a field that is always `0` .
 */
export const positionLeafData = (d: {
  x: number;
  y: number;
  mode: PositionMode;
  duration: number | null;
}): Record<string, unknown> =>
  d.duration === null ? { x: d.x, y: d.y, mode: d.mode } : { x: d.x, y: d.y, mode: d.mode, duration: d.duration };

/**
 * Check the external throwing request into a conclusion.
 *
 * `angle` unit degree, `0` = straight right, counterclockwise is positive (screen coordinate y is downward, so "throw
 * up" is written as 90); there is no angle normalization here - when the front end is converted to vx/vy, sin/cos is
 * true for any real number. `power` is the force magnification (`1.0` = 1200. Before px/s soft clamp speed, the actual
 * initial velocity will be suppressed to about 1021 by the existing soft upper limit). There is no dead zone: when the
 * drag is released, if it is lower than 500 px/s, it is considered "gently letting go", which is the drag semantics;
 * the interface is a clear command, no matter how small it is, it will be ignored.
 *
 * @param args - Throwing parameters: `requested` is the original value of `?pet=` (empty string → `pet-required` );
 * `angle` unit degree;
 * `power` is the force multiplier, which must be greater than 0.
 */
export function decideThrow(args: {
  cfg: Record<string, Record<string, unknown>>;
  /** The original value of `?pet=` (required: empty string → `pet-required`) */
  requested: string;
  angle: unknown;
  power: unknown;
}): ThrowDecision {
  const angle = finite(args.angle);
  if (angle === null) return { ok: false, reason: 'bad-request', message: 'angle 必须是有限数字' };
  const power = finite(args.power);
  if (power === null || power <= 0) {
    return { ok: false, reason: 'bad-request', message: 'power 必须是大于 0 的有限数字' };
  }

  const pet = resolvePet(args.cfg, args.requested);
  if (!pet.ok) return pet;

  return { ok: true, petId: pet.petId, angle, power };
}
