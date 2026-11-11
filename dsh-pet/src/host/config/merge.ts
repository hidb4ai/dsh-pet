/**
 * Configuration merging: Stack built-in defaults, user layers and file pets into finished configurations.
 *
 * No disk reading, no disk writing; input is a parsed object, and output is a new object with fields filled in. This
 * must always be true: only defaults are filled in and explicit values are not overwritten; unknown fields are not
 * transparently transmitted.
 * @module dsh-pet/src/host/config/merge
 */
import { CORNER_SET, GLOBAL_DEFAULT_KEYS, isValidPetId, PET_DISPLAY_SET, warnOnce } from './constants.ts';
import { isValidSizePercent, SIZE_PERCENT_DEFAULT, SIZE_PERCENT_MIN } from '../../shared/pet-size.ts';
import { topFieldValid } from './validate.ts';

/**
 * Merge base for file pet entries: built-in default + whitelist fields use user layer values instead. These fields are
 * user-level cost/preference/environment/tempo parameters, not category attributes. The user should change them once
 * on the settings page so that all pets (including pet pack) will take effect. The semantics are still "type can be
 * overwritten": if the top level of the type file writes its own value, it will be overwritten by overlay; if the user
 * layer writes but invalid value, it will be skipped directly.
 */
export function packBase(
  base: Record<string, unknown>,
  mainOverlay: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!mainOverlay) return base;
  let out: Record<string, unknown> | undefined;
  for (const key of GLOBAL_DEFAULT_KEYS) {
    const own = mainOverlay[key];
    if (own === undefined || !topFieldValid(key, own)) continue;
    out ??= { ...base };
    out[key] = own;
  }
  return out ?? base;
}

/** An overlay file → complete entries: top-level field-by-field merge (not written/invalid → built-in default + warning), pets by instance */
export function mergeEntry(
  base: Record<string, unknown>,
  overlay: Record<string, unknown> | undefined,
  label: string,
  basePets: Record<string, unknown>[],
  seenIds: Set<string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(base)) {
    if (key === 'pets') {
      out.pets = mergePets(basePets, overlay?.[key], label, seenIds);
      continue;
    }
    const own = overlay ? overlay[key] : undefined;
    // Structural normality: The overlay layer (especially the user layer written in the settings page) does not write
    // the top-level fields → If it is missing, it will default silently, no warning; only "explicitly written but
    // invalid" will warning (true exception, default value fallback)
    if (own === undefined) {
      out[key] = base[key];
      continue;
    }
    if (!topFieldValid(key, own)) {
      warnOnce(`${label}:${key}`, `Entry ${label}: invalid ${key}; using its default`);
      out[key] = base[key];
      continue;
    }
    out[key] = own;
  }
  return out;
}

/** pets array merge: file not written/empty → default list; merge instance by instance (missing fields → built-in default pets [0], silent). */
function mergePets(
  basePets: Record<string, unknown>[],
  raw: unknown,
  label: string,
  seenIds: Set<string>,
): Record<string, unknown>[] {
  const basePet: Record<string, unknown> = basePets[0] ?? {};
  if (!Array.isArray(raw) || raw.length === 0) {
    warnOnce(`${label}:pets`, `Entry ${label}: pets missing or empty; using the default pet list`);
    return basePets;
  }
  const out: Record<string, unknown>[] = [];
  for (const item of raw) {
    const pet = mergePet(basePet, item, label, seenIds);
    if (pet) out.push(pet);
  }
  if (out.length === 0) {
    warnOnce(
      `${label}:pets`,
      `Entry ${label}: all pets rejected for invalid, duplicate or conflicting IDs; using the default list`,
    );
    return basePets;
  }
  return out;
}

/** The pet instance field takes a number; missing → silently takes the default (structural normality); explicitly written but invalid → warning + default */
function petNumber(own: unknown, def: unknown, min: number, label: string, field: string, id: string): number {
  const n = Number(own);
  if (own !== undefined && own !== null && Number.isFinite(n) && n >= min) return n;
  // Missing = normal (file pets can write-only id/name and other small fields), silently default; explicitly written but invalid is a true exception
  if (own !== undefined && own !== null) {
    warnOnce(`${label}:${field}:${id}`, `Pet ${id}: invalid ${field}; using its default`);
  }
  return Number(def);
}

/**
 * Instance level sizePercent: The key is dropped only after writing a valid value; the key is not dropped by default
 * or out of bounds, and the rendering side is processed according to the default value. Do not fill in the default
 * value - filling in will make "untouched" become an explicit value when saving, the configuration file will grow out
 * of thin air, and the shape will be inconsistent when there is no user layer.
 */
function petSizePercentField(own: unknown, def: unknown, label: string, id: string): { sizePercent?: number } {
  const value = own ?? def;
  if (value === undefined || value === null) return {};
  if (isValidSizePercent(value)) return { sizePercent: value };
  warnOnce(
    `${label}:sizePercent:${id}`,
    `Pet ${id}: sizePercent must be a number >= ${SIZE_PERCENT_MIN}; using ${SIZE_PERCENT_DEFAULT}`,
  );
  return {};
}

/** The pet instance field is Boolean; missing → silently defaults; explicitly written but invalid → warning + default */
function petBool(own: unknown, def: unknown, label: string, field: string, id: string): boolean {
  if (typeof own === 'boolean') return own;
  if (own !== undefined && own !== null) {
    warnOnce(`${label}:${field}:${id}`, `Pet ${id}: invalid ${field}; using its default`);
  }
  return Boolean(def);
}

/** The pet instance field takes the whitelist enumeration; missing → silently takes the default; explicitly written but invalid → warning + default */
function petEnum(
  own: unknown,
  set: ReadonlySet<string>,
  def: unknown,
  label: string,
  field: string,
  id: string,
): string {
  if (typeof own === 'string' && set.has(own)) return own;
  if (own !== undefined && own !== null) {
    warnOnce(`${label}:${field}:${id}`, `Pet ${id}: invalid ${field}; using its default`);
  }
  return typeof def === 'string' ? def : '';
}

/** One instance → resolved value instance (id must be its own and globally unique; other fields are not written/invalid → default + warning) */
function mergePet(
  base: Record<string, unknown>,
  raw: unknown,
  label: string,
  seenIds: Set<string>,
): Record<string, unknown> | null {
  const p = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const id = typeof p.id === 'string' ? p.id.trim() : '';
  if (!isValidPetId(id) || seenIds.has(id)) {
    warnOnce(
      `${label}:id:${id || '(空)'}`,
      `Entry ${label}: pet ID ${id || '(empty)'} is invalid, duplicated or already present; skipping this instance`,
    );
    return null;
  }
  seenIds.add(id);
  // name: missing/empty → processed as the pet id (established rules: repeatable, not inheriting the default name)
  const rawName = typeof p.name === 'string' ? p.name.trim() : '';
  const name = rawName || id;
  if (!rawName) warnOnce(`${label}:name:${id}`, `Pet ${id}: name missing; using its ID`);

  // position: Merge subfield by subfield (missing → silently default; explicitly written but invalid → warning + default)
  const basePos = base.position && typeof base.position === 'object' ? (base.position as Record<string, unknown>) : {};
  const ownPos = p.position && typeof p.position === 'object' ? (p.position as Record<string, unknown>) : {};

  return {
    id,
    name,
    size: petNumber(p.size, base.size, 1, label, 'size', id),
    ...petSizePercentField(p.sizePercent, base.sizePercent, label, id),
    balanceEnabled: petBool(p.balanceEnabled, base.balanceEnabled, label, 'balanceEnabled', id),
    whisperEnabled: petBool(p.whisperEnabled, base.whisperEnabled, label, 'whisperEnabled', id),
    workStatusEnabled: petBool(p.workStatusEnabled, base.workStatusEnabled, label, 'workStatusEnabled', id),
    fixedEnabled: petBool(p.fixedEnabled, base.fixedEnabled, label, 'fixedEnabled', id),
    display: petEnum(p.display, PET_DISPLAY_SET, base.display, label, 'display', id),
    position: {
      corner: petEnum(ownPos.corner, CORNER_SET, basePos.corner, label, 'position.corner', id),
      marginX: petNumber(ownPos.marginX, basePos.marginX, -Infinity, label, 'position.marginX', id),
      marginY: petNumber(ownPos.marginY, basePos.marginY, -Infinity, label, 'position.marginY', id),
    },
    // Instance-level persona (optional): only non-empty character strings are released; / empty string / pure blank /
    // null → the key does not appear in the result (fallback is done by the consumer: petPersona of ./persona, if the
    // instance level cannot be obtained, take the top level of the entry); non-character strings → warning + ignore.
    // The effective value is deliberately not filled in here: the default value of persona is the entry it belongs to.
    // Once each instance is filled in, / pet-display writeback will solidify the "following entry" into an explicit
    // override - after the user changes the entry persona, these instances will no longer change.
    ...petPersonaField(p.whisperPrompt, label, id),
  };
}

/**
 * Merging of instance-level whisperPrompt: non-empty character string is written → brought out as it is; otherwise, an
 * empty object is returned (the key does not appear). Explicitly writing non-character strings
 * (numbers/objects/booleans) is considered a configuration error → an warning will be issued once and ignored (fallback
 * entry), the same conventions as petNumber.
 */
function petPersonaField(own: unknown, label: string, id: string): { whisperPrompt?: string } {
  if (typeof own === 'string') {
    // Empty string / pure blank = nothing written (the input box submitted after clearing the input box on the setting page is '', which is a valid state and does not warning)
    return own.trim() === '' ? {} : { whisperPrompt: own };
  }
  if (own !== undefined && own !== null) {
    warnOnce(`${label}:whisperPrompt:${id}`, `Pet ${id}: invalid whisperPrompt; inheriting the entry persona`);
  }
  return {};
}
